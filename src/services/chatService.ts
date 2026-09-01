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

export type ChatErrorCode = CommonErrorCode | 'TOO_LONG' | 'EMPTY_MESSAGE' | 'NOT_A_MEMBER';

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
 * Posts a photo: the object path, not a URL and not a caption.
 *
 * `messages_payload_matches_type` allows an `image` row to carry `content` as
 * well, but nothing sends one — the composer has no caption field, and adding
 * an argument for a payload no caller can produce would be inventing a feature
 * in a type signature. A member wanting to say something about a photo sends
 * the photo and then a message, which is what every chat app trains them to do.
 *
 * The path has already been through `chatMediaService.uploadChatImage`, so the
 * object exists before the row that names it. That order is the same one
 * `createTask` uses for its announcement, and for the same reason: a row
 * pointing at nothing is worse than an object nothing points at, which the
 * 10-day media sweep collects anyway.
 */
export async function sendImageMessage(
  familyId: string,
  mediaPath: string,
): Promise<ChatResult<ChatMessage>> {
  const path = mediaPath.trim();

  if (!path) return fail('EMPTY_MESSAGE', 'errors.chat.mediaMissing');

  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('messages')
      .insert({
        family_id: familyId,
        sender_id: auth.user.id,
        message_type: 'image',
        media_url: path,
      })
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    return ok(toChatMessage(data));
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
