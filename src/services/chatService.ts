/**
 * Family chat.
 *
 * Reads are scoped by RLS to the caller's family, so `family_id` here is a
 * filter for the index rather than a security boundary. Writes go straight to
 * the table: `messages: send as self` already pins `sender_id` to `auth.uid()`,
 * and the 500-character ceiling and payload/type agreement are check
 * constraints, not client rules.
 *
 * Text messages are swept after 30 days and images after 10 by `pg_cron`, so a
 * quiet family legitimately reads back an empty list.
 *
 * An `image` row stores the object *path* in `media_url`, never a URL — the
 * `chat-media` bucket is private, and turning a path into something renderable
 * is `chatMediaService`'s job, not this one's.
 */

import type { PostgrestError } from '@supabase/supabase-js';

import type { Database } from '@/data/database.types';
import { dayKey } from '@/data/format';
import type { ChatDay, ChatMessage, MessageType } from '@/data/types';
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

type MessageRow = Database['public']['Tables']['messages']['Row'];

export type ChatErrorCode =
  | CommonErrorCode
  | 'TOO_LONG'
  | 'EMPTY_MESSAGE'
  | 'NOT_A_MEMBER'
  /** A delete matched no row: not the caller's message, or already gone. */
  | 'NOT_ALLOWED';

export type ChatServiceError = ServiceError<ChatErrorCode>;
export type ChatResult<T> = ServiceResult<T, ChatErrorCode>;

/** Mirrors the `messages_content_length` check constraint. */
export const MAX_MESSAGE_LENGTH = 500;

/** One screenful and then some; older messages are aged out server-side anyway. */
const PAGE_SIZE = 200;

const MESSAGE_TYPES: readonly MessageType[] = ['text', 'image', 'system'];

function toServiceError(error: PostgrestError): ChatServiceError {
  const message = error.message ?? '';
  const cause = error;

  if (/messages_content_length/.test(message)) {
    return errorFrom('TOO_LONG', { key: 'errors.chat.tooLong', vars: { max: MAX_MESSAGE_LENGTH } }, cause);
  }
  if (error.code === '42501' || /row-level security/i.test(message)) {
    return errorFrom('NOT_A_MEMBER', 'errors.chat.notMember', cause);
  }
  if (error.code === '28000') {
    return errorFrom('NOT_AUTHENTICATED', 'errors.notAuthenticated', cause);
  }

  return errorFrom('UNKNOWN', 'errors.unknown', cause);
}

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    // The column is varchar(20) with a check constraint, so anything unexpected
    // is a schema drift rather than user data — read it as plain text.
    type: MESSAGE_TYPES.find((candidate) => candidate === row.message_type) ?? 'text',
    content: row.content,
    mediaUrl: row.media_url,
    createdAt: row.created_at,
  };
}

/** Oldest first, so the chat renders top-to-bottom without reversing. */
export async function listMessages(familyId: string): Promise<ChatResult<ChatMessage[]>> {
  return guarded(async () => {
    // Newest-first on the wire so the limit keeps the *recent* page, then
    // flipped for display. `messages_family_time_idx` covers this exactly.
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (error) return { data: null, error: toServiceError(error) };

    return ok(data.map(toChatMessage).reverse());
  });
}

export async function sendMessage(familyId: string, content: string): Promise<ChatResult<ChatMessage>> {
  const text = content.trim();

  if (!text) return fail('EMPTY_MESSAGE', 'errors.chat.empty');
  if (text.length > MAX_MESSAGE_LENGTH) {
    return fail('TOO_LONG', { key: 'errors.chat.tooLong', vars: { max: MAX_MESSAGE_LENGTH } });
  }

  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('messages')
      .insert({
        family_id: familyId,
        sender_id: auth.user.id,
        message_type: 'text',
        content: text,
      })
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    return ok(toChatMessage(data));
  });
}

/**
 * Posts a photo: the object path, and optionally the caption typed under it.
 *
 * `messages_payload_matches_type` always allowed an `image` row to carry
 * `content` as well; until the confirmation step existed nothing could produce
 * one, because there was no moment between choosing a photo and sending it in
 * which to type. Now there is, so the column is finally written — and it is one
 * row rather than a photo followed by a text message, which is what keeps the
 * caption attached to its picture instead of merely near it.
 *
 * An empty or whitespace-only caption is stored as NULL rather than as `''`:
 * "no caption" is the absence of one, and a blank string would make
 * `message.content ? …` render an empty line under the photo.
 *
 * The path has already been through `chatMediaService.uploadChatImage`, so the
 * object exists before the row that names it. That order is the same one
 * `createTask` uses for its announcement, and for the same reason: a row
 * pointing at nothing is worse than an object nothing points at, which the
 * 10-day media sweep collects anyway.
 *
 * `messageId` is supplied rather than left to `gen_random_uuid()` because the
 * object was already named after it — `chatMediaService.newMessageId()` decides
 * it once and both writes use it, which is what lets an object and its row be
 * joined from either side. Writing the primary key from the client is safe here
 * in the way it would not be for a column anyone trusts: `messages: send as
 * self` still pins `sender_id` to `auth.uid()` and `family_id` to the caller's
 * own family, so a chosen id buys nothing, and a chosen id that collides is a
 * duplicate-key error rather than a write onto somebody else's row.
 */
export async function sendImageMessage(
  familyId: string,
  messageId: string,
  mediaPath: string,
  caption?: string | null,
): Promise<ChatResult<ChatMessage>> {
  const path = mediaPath.trim();

  if (!path) return fail('EMPTY_MESSAGE', 'errors.chat.mediaMissing');

  const content = caption?.trim() || null;

  // The same ceiling a text message answers to, checked here for the same
  // reason: `messages_content_length` would refuse the row, and refusing after
  // the object is already in the bucket costs an upload to say so.
  if (content && content.length > MAX_MESSAGE_LENGTH) {
    return fail('TOO_LONG', { key: 'errors.chat.tooLong', vars: { max: MAX_MESSAGE_LENGTH } });
  }

  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('messages')
      .insert({
        id: messageId,
        family_id: familyId,
        sender_id: auth.user.id,
        message_type: 'image',
        media_url: path,
        content,
      })
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    return ok(toChatMessage(data));
  });
}

/**
 * Deletes one message, and reports a refusal that Postgres does not.
 *
 * **A DELETE blocked by RLS is not an error — it deletes nothing and succeeds.**
 * `messages: delete own or admin` is a `using` clause, so a row the caller may
 * not touch simply fails to match, and PostgREST returns 204 with no complaint.
 * Trusting that would report somebody else's message as deleted and then have
 * it reappear on the next refresh, so the delete asks for the row back with
 * `.select()` and an empty array is read as the refusal it is.
 *
 * That one branch cannot distinguish "not yours" from "already gone" — both
 * match nothing — and it does not need to: `NOT_ALLOWED` carries a message
 * saying the message could not be deleted, and a row that has already been
 * swept or removed on another device is in exactly the state the caller wanted.
 *
 * The **object** behind an image message is not this function's business.
 * `chatMediaService.deleteChatImage` is called after this returns, by
 * `FamilyContext`, in that order and never the reverse — see the note there.
 */
export async function deleteMessage(messageId: string): Promise<ChatResult<string>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)
      .select('id');

    if (error) return { data: null, error: toServiceError(error) };
    if (!data || data.length === 0) {
      return fail('NOT_ALLOWED', 'errors.chat.deleteRefused');
    }

    return ok(messageId);
  });
}

/**
 * Posts an app-generated message — today, only the announcement of a task
 * created from Chat.
 *
 * `system` rather than `text` because the app composed it, not the user, and
 * because the Home feed folds text messages into "Anna: …" lines that would
 * read as something typed. `sender_id` is still the caller: the RLS insert
 * policy pins it to `auth.uid()`, and attributing the announcement to whoever
 * created the task is also what makes the avatar beside it correct.
 *
 * The 500-character ceiling and the payload/type agreement are the same check
 * constraints `sendMessage` answers to.
 */
export async function sendSystemMessage(
  familyId: string,
  content: string,
): Promise<ChatResult<ChatMessage>> {
  const text = content.trim();

  if (!text) return fail('EMPTY_MESSAGE', 'errors.chat.systemEmpty');
  if (text.length > MAX_MESSAGE_LENGTH) {
    return fail('TOO_LONG', { key: 'errors.chat.tooLong', vars: { max: MAX_MESSAGE_LENGTH } });
  }

  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('messages')
      .insert({
        family_id: familyId,
        sender_id: auth.user.id,
        message_type: 'system',
        content: text,
      })
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    return ok(toChatMessage(data));
  });
}

/**
 * Groups an already-ordered list into calendar days.
 *
 * Pure, and not a service concern in itself — it lives here so the chat screen
 * never has to know that a day boundary is derived rather than stored. It
 * hands back the day's *date*, not a label: "Today" is a translation, and this
 * runs without knowing which language the groups will be read in.
 */
export function groupByDay(messages: ChatMessage[]): ChatDay[] {
  const days: ChatDay[] = [];

  for (const message of messages) {
    const key = dayKey(message.createdAt);
    const current = days[days.length - 1];

    if (current?.key === key) {
      current.messages.push(message);
    } else {
      days.push({ key, date: message.createdAt, messages: [message] });
    }
  }

  return days;
}
