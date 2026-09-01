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
 *   * **The object key is `<family_id>/<user_id>/<uuid>.jpg`.** Not
 *     `<family_id>/<uuid>.jpg` — `chat-media: upload to own path` checks
 *     `foldername[1]` against the caller's family *and* `foldername[2]` against
 *     `auth.uid()`, so a two-segment key is refused by RLS. The same convention
 *     is what `chat-media: delete own or admin` reads to tell your objects from
 *     everyone else's, and what the `cleanup-media` Edge Function walks.
 *   * **JPEG.** The bucket's `allowed_mime_types` is the five image types, and
 *     the retention sweep matches on the row, not the extension; JPEG is picked
 *     because it is the one format every source (HEIC from an iPhone camera,
 *     PNG from a screenshot) can be re-encoded into at a predictable size.
 *   * **10 MB ceiling**, from `storage.buckets.file_size_limit`. A 1080px JPEG
 *     at 0.7 lands two orders of magnitude under it, which is the point of
 *     compressing before the upload rather than reporting a refusal after one.
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

/** A picked, resized, re-encoded image — held in memory, never on the row. */
export type PickedImage = {
  /** Cache-directory file the manipulator wrote; a local preview can use it. */
  uri: string;
  /** JPEG bytes, base64. What `uploadChatImage` sends. */
  base64: string;
  width: number;
  height: number;
};

export const BUCKET = 'chat-media';

/**
 * Long edge cap and JPEG quality.
 *
 * 1080 is a phone screen at 3× on the widest bubble the chat draws, so nothing
 * on screen is ever upscaled, and it is small enough that the base64 round trip
 * below stays a few hundred kilobytes rather than the ten megabytes a modern
 * camera hands over.
 */
const MAX_IMAGE_WIDTH = 1080;
const JPEG_QUALITY = 0.7;

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
 * Opens the picker, then resizes and re-encodes whatever comes back.
 *
 * Resizing is conditional: an image already narrower than the cap is passed
 * through the manipulator for the re-encode alone, because widening it to 1080
 * would spend bytes inventing detail that was never in the file.
 *
 * `quality: 1` on the picker is deliberate — its own compression would be a
 * *second* lossy pass over an image this then re-encodes at 0.7, and two passes
 * cost quality without saving anything.
 */
export async function pickAndCompressImage(
  source: PickSource = 'library',
): Promise<MediaResult<PickedImage | null>> {
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

    try {
      let context = ImageManipulator.manipulate(asset.uri);

      if (!asset.width || asset.width > MAX_IMAGE_WIDTH) {
        context = context.resize({ width: MAX_IMAGE_WIDTH });
      }

      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        compress: JPEG_QUALITY,
        format: SaveFormat.JPEG,
        base64: true,
      });

      if (!saved.base64) return fail('PROCESSING_FAILED', 'errors.media.processingFailed');

      return ok<PickedImage | null, MediaErrorCode>({
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
 * The object's own name.
 *
 * Not a real UUID: Hermes has no `crypto.randomUUID` and no `getRandomValues`,
 * and the `uuid` package in `node_modules` is a build-time dependency of an
 * Expo config plugin rather than something the app may import. A timestamp plus
 * 64 bits of `Math.random` is enough here because the key only has to be unique
 * *within one member's folder* — collisions would need the same person, in the
 * same millisecond, drawing the same two randoms.
 */
function objectName(): string {
  const random = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');

  return `${Date.now().toString(36)}-${random()}${random()}`;
}

/**
 * Puts the compressed image in the bucket and hands back the path to store.
 *
 * The path — never a URL. `messages.media_url` outlives today's project ref and
 * today's signing scheme, the same reason `profiles.avatar_config` stores a
 * memoji seed rather than a `tapback.co` link.
 *
 * `upsert: false`: a key collision should surface as a failure rather than
 * quietly overwriting a photo somebody else in the family is looking at.
 */
export async function uploadChatImage(
  familyId: string,
  image: PickedImage,
): Promise<MediaResult<string>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    // Three segments, in this order. See the RLS policies quoted at the top.
    const path = `${familyId}/${auth.user.id}/${objectName()}.jpg`;
    const bytes = decodeBase64(image.base64);

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes.buffer as ArrayBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) return { data: null, error: toServiceError(error) };

    return ok(path);
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
