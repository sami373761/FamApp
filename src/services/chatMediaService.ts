/**
 * Photos in the family chat: pick one, shrink it, put it in the bucket, and
 * hand back a URL something can actually render.
 *
 * This is the read path `chat-media` never had. The bucket is **private**, so
 * `messages.media_url` stores an object *path* and not a URL — nothing can load
 * it without a signed URL, which is why an image message rendered as a grey
 * placeholder until this file existed.
 *
 * Three things here are decided by the schema rather than by preference, and
 * none of them is free to change on this side alone:
 *
 *   * **The object key is `<family_id>/<user_id>/<message_id>.webp`.** Not
 *     `<family_id>/<message_id>.webp` — `chat-media: upload to own path` checks
 *     `foldername[1]` against the caller's family *and* `foldername[2]` against
 *     `auth.uid()`, so a two-segment key is refused by RLS however tidy it
 *     looks. The same convention is what `chat-media: delete own or admin`
 *     reads to tell your objects from everyone else's, what the `cleanup-media`
 *     Edge Function walks, and what the `messages.media_url` column comment
 *     already documents. The *last* segment is the id of the message the object
 *     belongs to (see `newMessageId`), so an object and its row name each other
 *     in both directions rather than only one.
 *   * **WebP.** The bucket's `allowed_mime_types` carries `image/webp`, and the
 *     re-encode is the security barrier as much as the size one: decoding a
 *     picked file and writing fresh pixels out drops every EXIF block, colour
 *     profile and trailing byte the original carried, so a payload smuggled
 *     behind an image header does not survive being turned back into an image.
 *     WebP over JPEG for the bytes — the same 1080px frame lands roughly a
 *     third smaller at a visually equivalent quality, and every source the
 *     picker can hand over (HEIC from an iPhone camera, PNG from a screenshot)
 *     re-encodes into it on all three targets: `SDImageWebPCoder` on iOS,
 *     Skia on Android, `canvas.toBlob('image/webp')` on web.
 *   * **10 MB ceiling**, from `storage.buckets.file_size_limit`. A 1080px WebP
 *     at 0.75 lands around 150–200 KB — two orders of magnitude under it, which
 *     is the point of compressing before the upload rather than reporting a
 *     refusal after one.
 *
 * **Cancelling is not a failure.** `pickAndCompressImage` resolves to `null`
 * data with no error when the user backs out of the picker — the alternative, a
 * `CANCELLED` code, would have every caller writing a branch that suppresses an
 * "error" the user caused on purpose.
 *
 * Nothing here decides who is *allowed* to send a photo. The Gold gate is the
 * chat sheet's, and it is a UI courtesy in exactly the way `canActOnTask` is:
 * `messages: send as self` does not read the family's tier, so a photo message
 * from a free family would be accepted by the database. Making the gate real
 * means a trigger reading `private.is_family_premium()`, not a change here.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import {
  errorFrom,
  fail,
  guarded,
  ok,
  type CommonErrorCode,
  type ServiceError,
  type ServiceResult,
} from '@/services/result';
import { supabase } from '@/services/supabase';

export type MediaErrorCode =
  | CommonErrorCode
  /** The user refused the library or the camera. Undoable in system settings. */
  | 'PERMISSION_DENIED'
  /** No camera on this target — the browser's is not used by `expo-image-picker`. */
  | 'UNSUPPORTED'
  /** Decoding, resizing or re-encoding failed; the file is not usable. */
  | 'PROCESSING_FAILED'
  /** Storage refused the object, or the transfer did not complete. */
  | 'UPLOAD_FAILED'
  /** RLS: the key's family segment is not the family this caller belongs to. */
  | 'NOT_A_MEMBER'
  /** The object is gone — the 10-day media sweep is the ordinary reason. */
  | 'NOT_FOUND';

export type MediaServiceError = ServiceError<MediaErrorCode>;
export type MediaResult<T> = ServiceResult<T, MediaErrorCode>;

export type PickSource = 'library' | 'camera';

/**
 * What the picker handed back, untouched.
 *
 * The original file, at its original size and in whatever format the library
 * held it — so it is a *preview* source and nothing else. Nothing uploads one:
 * it has not been through the re-encode that is this service's security
 * barrier, so treating it as sendable would be the one mistake that matters.
 * `compressImage` is what turns it into a `PickedImage`.
 *
 * It exists as a separate type because the confirmation step needs something to
 * show before the user has agreed to send anything, and doing the re-encode up
 * front would spend it on every photo that gets cancelled.
 */
export type PickedAsset = {
  uri: string;
  /** Zero when the picker does not report it; `compressImage` copes. */
  width: number;
  height: number;
};

/** A picked, resized, re-encoded image — held in memory, never on the row. */
export type PickedImage = {
  /** Cache-directory file the manipulator wrote; a local preview can use it. */
  uri: string;
  /** WebP bytes, base64. What `uploadChatImage` sends. */
  base64: string;
  width: number;
  height: number;
};

export const BUCKET = 'chat-media';

/** The one content type this service writes; see the WebP note at the top. */
const IMAGE_MIME = 'image/webp';
const IMAGE_EXTENSION = 'webp';

/**
 * Long edge cap and WebP quality.
 *
 * 1080 is a phone screen at 3× on the widest bubble the chat draws, so nothing
 * on screen is ever upscaled, and it is small enough that the base64 round trip
 * below stays a couple of hundred kilobytes rather than the ten megabytes a
 * modern camera hands over. 0.75 is the quality at which a photographic frame
 * of that width lands in the 150–200 KB band without visible artefacts on the
 * gradients — sky, skin — that give a lossy encoder the most trouble.
 */
const MAX_IMAGE_WIDTH = 1080;
const IMAGE_QUALITY = 0.75;

/**
 * How long a signed URL is good for, and how early the cache gives up on one.
 *
 * An hour is long enough that scrolling back through a day of chat re-signs
 * nothing, and the 60-second skew means a URL is never handed to `expo-image`
 * with less time left than the request itself might take.
 */
const SIGNED_URL_TTL_SECONDS = 3600;
const SIGNED_URL_SKEW_MS = 60_000;

function toServiceError(error: { message?: string; name?: string }): MediaServiceError {
  const message = error.message ?? '';

  if (/row-level security|not authorized|Unauthorized/i.test(message)) {
    return errorFrom('NOT_A_MEMBER', 'errors.media.notMember', error);
  }
  if (/not found|does not exist|Object not found/i.test(message)) {
    return errorFrom('NOT_FOUND', 'errors.media.notFound', error);
  }
  if (/exceeded the maximum allowed size|Payload too large/i.test(message)) {
    return errorFrom('UPLOAD_FAILED', 'errors.media.tooLarge', error);
  }

  return errorFrom('UPLOAD_FAILED', 'errors.media.uploadFailed', error);
}

/* -------------------------------------------------------------------------- */
/* Picking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Asks for the one permission this source needs, and reports a refusal as a
 * refusal.
 *
 * Both requests are no-ops on web — the browser's file input carries its own
 * consent — so a granted-by-default response there is the honest answer rather
 * than a permission that was never checked.
 */
async function ensurePermission(source: PickSource): Promise<MediaServiceError | null> {
  const response =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (response.granted) return null;

  return errorFrom(
    'PERMISSION_DENIED',
    source === 'camera' ? 'errors.media.cameraDenied' : 'errors.media.libraryDenied',
  );
}

/**
 * Opens the picker and hands back the original file, unmodified.
 *
 * **Picking and compressing are two calls because a photo is confirmed in
 * between.** The chat shows what was picked, takes an optional caption and
 * waits for "Send" — so the re-encode belongs *after* that, not here: doing it
 * up front would spend a full decode-and-encode on every photo somebody looks
 * at and thinks better of. Nothing here is uploadable, which is the reason the
 * return type is `PickedAsset` and not `PickedImage`.
 *
 * `quality: 1` is deliberate — the picker's own compression would be a *second*
 * lossy pass over an image `compressImage` re-encodes anyway, and two passes
 * cost quality without saving anything. `exif: false` keeps the metadata out of
 * memory as well as off the wire; GPS in a holiday photo is the family's
 * location by another route.
 */
export async function pickImage(
  source: PickSource = 'library',
): Promise<MediaResult<PickedAsset | null>> {
  if (source === 'camera' && Platform.OS === 'web') {
    return fail('UNSUPPORTED', 'errors.media.cameraUnsupported');
  }

  return guarded(async () => {
    const denied = await ensurePermission(source);

    if (denied) return { data: null, error: denied };

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: false,
            quality: 1,
            exif: false,
          });

    // Backing out of the picker is an answer, not a failure.
    if (result.canceled) return ok(null);

    const asset = result.assets[0];

    if (!asset?.uri) return fail('PROCESSING_FAILED', 'errors.media.processingFailed');

    return ok<PickedAsset | null, MediaErrorCode>({
      uri: asset.uri,
      width: asset.width ?? 0,
      height: asset.height ?? 0,
    });
  });
}

/**
 * Resizes and re-encodes a picked file into the bytes that get uploaded.
 *
 * **The re-encode is not optional and is not only about size.** The asset is
 * decoded to pixels and written back out as a fresh WebP, so nothing of the
 * original container survives the trip: no EXIF, no colour profile, no appended
 * payload riding behind a valid image header, and no file that was never an
 * image at all — that one fails to decode and is reported as
 * `PROCESSING_FAILED` rather than being handed to Storage to think about.
 *
 * Resizing is conditional: an image already narrower than the cap is passed
 * through the manipulator for the re-encode alone, because widening it to 1080
 * would spend bytes inventing detail that was never in the file. The re-encode
 * still happens in that case — it is the barrier, so it never gets skipped, and
 * a `width` the picker did not report (0) resizes rather than assuming small.
 */
export async function compressImage(asset: PickedAsset): Promise<MediaResult<PickedImage>> {
  return guarded(async () => {
    try {
      let context = ImageManipulator.manipulate(asset.uri);

      if (!asset.width || asset.width > MAX_IMAGE_WIDTH) {
        context = context.resize({ width: MAX_IMAGE_WIDTH });
      }

      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        compress: IMAGE_QUALITY,
        format: SaveFormat.WEBP,
        base64: true,
      });

      if (!saved.base64) return fail('PROCESSING_FAILED', 'errors.media.processingFailed');

      return ok<PickedImage, MediaErrorCode>({
        uri: saved.uri,
        base64: saved.base64,
        width: saved.width,
        height: saved.height,
      });
    } catch (cause) {
      return fail('PROCESSING_FAILED', 'errors.media.processingFailed', cause);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Uploading                                                                  */
/* -------------------------------------------------------------------------- */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(256);

  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    table[BASE64_ALPHABET.charCodeAt(index)] = index;
  }

  return table;
})();

/**
 * base64 → bytes, by hand.
 *
 * Hermes has no `atob` and React Native ships no `Buffer`, and the usual answer
 * — `base64-arraybuffer`, which Supabase's own React Native guide reaches for —
 * would be a dependency added to a `package.json` that already carries a long
 * list of unused ones. Twenty lines is the cheaper trade. The bytes are what
 * `supabase.storage.upload` wants: an RN `Blob` from `fetch('file://…')` is the
 * classic way to upload a zero-byte object.
 */
function decodeBase64(input: string): Uint8Array {
  // Padding and whitespace are dropped here, so the byte count comes from what
  // is *left*: every 4 characters carry 3 bytes, and a trailing group of 2 or 3
  // characters carries 1 or 2 — which is what the floor already says. Taking a
  // separate padding count off as well would truncate the tail of every image
  // whose length is not a multiple of 3.
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));

  let byte = 0;

  for (let index = 0; index < clean.length; index += 4) {
    const chunk =
      (BASE64_LOOKUP[clean.charCodeAt(index)] << 18) |
      (BASE64_LOOKUP[clean.charCodeAt(index + 1)] << 12) |
      (BASE64_LOOKUP[clean.charCodeAt(index + 2)] << 6) |
      BASE64_LOOKUP[clean.charCodeAt(index + 3)];

    if (byte < bytes.length) bytes[byte++] = (chunk >> 16) & 0xff;
    if (byte < bytes.length) bytes[byte++] = (chunk >> 8) & 0xff;
    if (byte < bytes.length) bytes[byte++] = chunk & 0xff;
  }

  return bytes;
}

/**
 * The id a photo message will be inserted under, decided **before** either
 * write happens.
 *
 * Naming the object after the row it belongs to is what makes the pair
 * recoverable from either end: `cleanup-media` walks objects and the retention
 * sweep walks rows, and with a shared id an orphan on one side names its
 * counterpart on the other instead of being a filename nothing can be joined
 * back to. It also lets the upload and the insert be ordered without a round
 * trip between them — the insert does not have to wait to be told what to call
 * itself — which is what the chat screen's "upload, then post" sequence needs.
 *
 * Shaped as a v4 UUID because `messages.id` is a `uuid` column; a value
 * Postgres would reject is not an option, so this is a format requirement
 * rather than a preference. The **randomness** is `Math.random`, which is not:
 * Hermes has neither `crypto.randomUUID` nor `crypto.getRandomValues`, and the
 * `uuid` in `node_modules` belongs to an Expo config plugin rather than to the
 * app, so the alternative is a dependency on a `package.json` that already
 * carries too many. That is an acceptable trade *here* and would not be
 * everywhere: this id is not a secret and guessing one grants nothing — RLS
 * decides who may read a message, never the difficulty of naming it — so what
 * it has to survive is accidental collision, and 122 bits of it does.
 */
export function newMessageId(): string {
  const hex = (bytes: number) =>
    Array.from({ length: bytes }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');

  // Version 4, variant 1: the two nibbles RFC 4122 pins are written in rather
  // than drawn, so the value is a well-formed v4 and not merely random hex.
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);

  return `${hex(4)}-${hex(2)}-4${hex(2).slice(1)}-${variant}${hex(2).slice(1)}-${hex(6)}`;
}

/**
 * Puts the compressed image in the bucket and hands back the path to store.
 *
 * The path — never a URL. `messages.media_url` outlives today's project ref and
 * today's signing scheme, the same reason `profiles.avatar_config` stores a
 * memoji seed rather than a `tapback.co` link.
 *
 * `messageId` comes from `newMessageId()` and is the same value the caller then
 * inserts the row under, which is what ties the object to its message. It is
 * the caller's to generate rather than this function's to invent, because the
 * insert needs it too and a value returned from here would arrive too late to
 * be the row's primary key.
 *
 * `upsert: false`: a key collision should surface as a failure rather than
 * quietly overwriting a photo somebody else in the family is looking at.
 */
export async function uploadChatImage(
  familyId: string,
  messageId: string,
  image: PickedImage,
): Promise<MediaResult<string>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    // Three segments, in this order. See the RLS policies quoted at the top.
    const path = `${familyId}/${auth.user.id}/${messageId}.${IMAGE_EXTENSION}`;
    const bytes = decodeBase64(image.base64);

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes.buffer as ArrayBuffer, {
        contentType: IMAGE_MIME,
        upsert: false,
      });

    if (error) return { data: null, error: toServiceError(error) };

    return ok(path);
  });
}

/**
 * Removes the object behind a deleted photo message.
 *
 * **Called after the row is gone, never before, and its failure is not the
 * caller's problem.** The two orders fail differently and only one of them is
 * survivable: dropping the object first and then failing to delete the row
 * leaves a message pointing at nothing, which is a broken photo for the whole
 * family; dropping the row first and then failing here leaves an object nobody
 * can reach, which is invisible and which the 10-day `cleanup-media` sweep
 * collects on its own. That is the same argument the upload makes in reverse,
 * where the object is written before the row that names it.
 *
 * `chat-media: delete own or admin` decides whether this is allowed, and it
 * reads the *path* — `foldername[2]` against `auth.uid()` — so an admin
 * moderating somebody else's photo is covered by the policy's second arm and a
 * member deleting their own by the first. A refusal comes back as an error and
 * is deliberately not escalated: the message is already gone, which is what the
 * user asked for.
 *
 * `forgetSignedMediaUrl` runs regardless, so a cached URL for an object that no
 * longer exists cannot be handed to `expo-image` afterwards.
 */
export async function deleteChatImage(path: string): Promise<MediaResult<null>> {
  forgetSignedMediaUrl(path);

  return guarded(async () => {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);

    if (error) return { data: null, error: toServiceError(error) };

    return ok(null);
  });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

type SignedEntry = { url: string; expiresAt: number };

/**
 * Signed URLs, kept for as long as they are good for.
 *
 * Module-level rather than per component: the chat list unmounts and remounts
 * bubbles as it scrolls, and a cache that died with the component would sign
 * the same object again on every pass. Bounded by the message page size (200)
 * and by the 10-day media sweep, so it is not a leak worth evicting from.
 */
const signedUrls = new Map<string, SignedEntry>();

/** Drops one path's cached URL — used when `expo-image` reports the URL dead. */
export function forgetSignedMediaUrl(path: string): void {
  signedUrls.delete(path);
}

/**
 * A temporary URL for a private object.
 *
 * Signing is a network call, so a cache hit is what keeps a scroll from firing
 * one per bubble. The stored entry expires `SIGNED_URL_SKEW_MS` early: a URL
 * handed out with two seconds left would 400 halfway through the image request
 * and read as a broken photo.
 */
export async function getSignedMediaUrl(path: string): Promise<MediaResult<string>> {
  const cached = signedUrls.get(path);

  if (cached && cached.expiresAt > Date.now()) return ok(cached.url);

  return guarded(async () => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (error) return { data: null, error: toServiceError(error) };
    if (!data?.signedUrl) return fail('NOT_FOUND', 'errors.media.notFound');

    signedUrls.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000 - SIGNED_URL_SKEW_MS,
    });

    return ok(data.signedUrl);
  });
}
