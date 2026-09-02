/**
 * Quick polls in the family chat.
 *
 * Two tables and one rule worth restating at the top: **a poll hangs off a
 * message, and the message is the question.** `chat_polls.message_id` names an
 * ordinary `text` row whose content is what was asked, which is why the chat
 * can draw the card in place of that line and why losing the poll leaves the
 * question sitting in the conversation exactly as its author typed it.
 *
 * That is the same shape `tasks.source_message_id` has, with the one difference
 * that matters: a task names FamApp's own announcement, because a member's line
 * is theirs and redrawing it as a card would take their words out of the chat.
 * A poll names the member's line, because the question *is* their words.
 *
 * `options` is a jsonb array of two to four strings, validated server-side by
 * `private.poll_options_valid()`, and it is never edited — there is no update
 * policy on `chat_polls` at all. A vote is a *position* in that array, so
 * re-wording or re-ordering one would silently re-label answers people had
 * already given.
 *
 * Voting is an upsert on `(poll_id, user_id)`: casting, changing your mind and
 * taking it back are one row inserted, updated and deleted. Not having voted is
 * the absence of a row, which is why there is no abstain value to store.
 *
 * Reads are family-wide and writes are the author's own, which is exactly what
 * the RLS policies allow — the same split `messages` and `saved_places` use.
 */

import type { PostgrestError } from '@supabase/supabase-js';

import type { Database } from '@/data/database.types';
import type { ChatPoll, PollVote } from '@/data/types';
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

type PollRow = Database['public']['Tables']['chat_polls']['Row'];
type VoteRow = Database['public']['Tables']['chat_poll_votes']['Row'];

export type PollErrorCode =
  | CommonErrorCode
  | 'INVALID_QUESTION'
  /** Fewer than two options, more than four, or one that is blank or too long. */
  | 'INVALID_OPTIONS'
  | 'NOT_A_MEMBER'
  /** The poll is gone — its message was deleted or swept while the sheet was open. */
  | 'NOT_FOUND';

export type PollServiceError = ServiceError<PollErrorCode>;
export type PollResult<T> = ServiceResult<T, PollErrorCode>;

/** Mirrors `chat_polls_question_length`. */
export const MAX_POLL_QUESTION_LENGTH = 200;
/** Mirrors the per-option cap inside `private.poll_options_valid()`. */
export const MAX_POLL_OPTION_LENGTH = 60;
/** Mirrors the array-length bounds in that same function. */
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 4;

function toServiceError(error: PostgrestError): PollServiceError {
  const message = error.message ?? '';
  const cause = error;

  if (/chat_polls_options_valid/.test(message)) {
    return errorFrom(
      'INVALID_OPTIONS',
      { key: 'errors.poll.optionsInvalid', vars: { min: MIN_POLL_OPTIONS, max: MAX_POLL_OPTIONS } },
      cause,
    );
  }
  if (/chat_polls_question_length/.test(message)) {
    return errorFrom(
      'INVALID_QUESTION',
      { key: 'errors.poll.questionTooLong', vars: { max: MAX_POLL_QUESTION_LENGTH } },
      cause,
    );
  }
  // `unique (poll_id, user_id)` losing a race with this device's own upsert, or
  // with the same account voting from two phones at once. Neither is worth its
  // own code: the vote that landed is a vote, and the socket delivers it.
  if (error.code === '23505') {
    return errorFrom('UNKNOWN', 'errors.poll.voteFailed', cause);
  }
  // The poll's own triggers raise P0001 with sentences they wrote themselves —
  // "That poll no longer exists.", "That poll has no option 3." — and like
  // every other database message those pass through as text rather than being
  // parsed for their numbers.
  if (error.code === 'P0001') {
    return errorFrom('NOT_FOUND', { text: message }, cause);
  }
  if (error.code === '42501' || /row-level security/i.test(message)) {
    return errorFrom('NOT_A_MEMBER', 'errors.poll.notMember', cause);
  }
  if (error.code === '28000') {
    return errorFrom('NOT_AUTHENTICATED', 'errors.notAuthenticated', cause);
  }

  return errorFrom('UNKNOWN', 'errors.unknown', cause);
}

/**
 * `options` is `Json` to the type generator, because the column is jsonb with
 * its shape enforced by a function rather than by a type. Narrowing it here
 * rather than casting is what stops a row this build cannot draw — an array of
 * numbers, an object, a poll written by a later migration with five answers —
 * reaching a card that would render blank buttons.
 *
 * Returns null for anything that fails, and the caller drops the row: a poll
 * whose options cannot be read is not a poll that can be voted in, and showing
 * the question with no answers would be worse than showing the plain message.
 */
function toPollOptions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < MIN_POLL_OPTIONS || value.length > MAX_POLL_OPTIONS) return null;
  if (!value.every((option) => typeof option === 'string' && option.trim().length > 0)) return null;

  return value as string[];
}

export function toChatPoll(row: PollRow): ChatPoll | null {
  const options = toPollOptions(row.options);

  if (!options) return null;

  return {
    id: row.id,
    messageId: row.message_id,
    question: row.question,
    options,
    createdById: row.created_by,
    createdAt: row.created_at,
  };
}

export function toPollVote(row: VoteRow): PollVote {
  return {
    id: row.id,
    pollId: row.poll_id,
    memberId: row.user_id,
    optionIndex: row.option_index,
    createdAt: row.created_at,
  };
}

/**
 * Every poll in the family.
 *
 * Not paged and not joined to `messages`: the chat already holds the last 200
 * messages, and a poll whose question is older than that has no line to be
 * drawn in place of — it simply never renders. `chat_polls` is bounded by that
 * same retention from the other side, since the row cascades when its message
 * is swept.
 */
export async function listPolls(familyId: string): Promise<PollResult<ChatPoll[]>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('chat_polls')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true });

    if (error) {
      const failure = toServiceError(error);

      return {
        data: null,
        error:
          failure.code === 'UNKNOWN'
            ? errorFrom('UNKNOWN', 'errors.poll.loadFailed', error)
            : failure,
      };
    }

    // A row this build cannot read is dropped rather than guessed at — see
    // `toPollOptions`. The question survives as the plain message it always was.
    return ok(data.flatMap((row) => toChatPoll(row) ?? []));
  });
}

/** Every vote in the family, for every poll. Counted client-side per poll. */
export async function listPollVotes(familyId: string): Promise<PollResult<PollVote[]>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('chat_poll_votes')
      .select('*')
      .eq('family_id', familyId);

    if (error) {
      const failure = toServiceError(error);

      return {
        data: null,
        error:
          failure.code === 'UNKNOWN'
            ? errorFrom('UNKNOWN', 'errors.poll.loadFailed', error)
            : failure,
      };
    }

    return ok(data.map(toPollVote));
  });
}

export type NewPollInput = {
  familyId: string;
  /** The message whose content is this question — written first, by the caller. */
  messageId: string;
  question: string;
  options: string[];
};

/**
 * Attaches a poll to a message that already exists.
 *
 * The message has to come first because `message_id` references it, and that
 * order is safe here in a way it deliberately is not for a task: a message with
 * no poll behind it is somebody asking a question, whereas an announcement with
 * no task behind it is a claim about a row that never existed. So `createTask`
 * writes its row first and this writes its row second, and both are right.
 *
 * Blank options are dropped rather than rejected — an untouched fourth field is
 * not an error, it is three options — but the count is re-checked afterwards so
 * a form that somehow submitted one answer fails here rather than at the
 * constraint.
 */
export async function createPoll(input: NewPollInput): Promise<PollResult<ChatPoll>> {
  const question = input.question.trim();
  const options = input.options.map((option) => option.trim()).filter(Boolean);

  if (!question) return fail('INVALID_QUESTION', 'errors.poll.questionEmpty');
  if (question.length > MAX_POLL_QUESTION_LENGTH) {
    return fail('INVALID_QUESTION', {
      key: 'errors.poll.questionTooLong',
      vars: { max: MAX_POLL_QUESTION_LENGTH },
    });
  }
  if (options.length < MIN_POLL_OPTIONS || options.length > MAX_POLL_OPTIONS) {
    return fail('INVALID_OPTIONS', {
      key: 'errors.poll.optionsInvalid',
      vars: { min: MIN_POLL_OPTIONS, max: MAX_POLL_OPTIONS },
    });
  }
  if (options.some((option) => option.length > MAX_POLL_OPTION_LENGTH)) {
    return fail('INVALID_OPTIONS', {
      key: 'errors.poll.optionTooLong',
      vars: { max: MAX_POLL_OPTION_LENGTH },
    });
  }

  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('chat_polls')
      .insert({
        family_id: input.familyId,
        message_id: input.messageId,
        question,
        options,
        created_by: auth.user.id,
      })
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    const poll = toChatPoll(data);

    if (!poll) return fail('UNKNOWN', 'errors.poll.createFailed');

    return ok(poll);
  });
}

/**
 * Casts or changes this member's vote.
 *
 * An upsert on `(poll_id, user_id)`, because changing your mind is the same row
 * moving rather than a second one — the unique constraint says so, and the tally
 * would be wrong if it were not.
 *
 * `family_id` is sent because the INSERT policy checks it, but it is not
 * trusted: `private.check_poll_vote()` overwrites it with the poll's own family
 * before the row lands, so a caller cannot file a vote under a family it does
 * not belong to by writing a different id. The same trigger is what bounds
 * `optionIndex` against *this* poll's length rather than against the widest a
 * poll may be.
 */
export async function castVote(
  familyId: string,
  pollId: string,
  optionIndex: number,
): Promise<PollResult<PollVote>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('chat_poll_votes')
      .upsert(
        {
          poll_id: pollId,
          family_id: familyId,
          user_id: auth.user.id,
          option_index: optionIndex,
        },
        { onConflict: 'poll_id,user_id' },
      )
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    return ok(toPollVote(data));
  });
}

/**
 * Takes this member's vote back.
 *
 * The row is deleted rather than blanked, for the reason `clearOwnLocation` is
 * a delete: there is no "abstained" value, and a member with no row simply has
 * not voted — which is the state the card already renders for everybody who
 * never did.
 *
 * The row is asked for back with `.select()` for the reason
 * `chatService.deleteMessage` does: a DELETE that RLS refuses matches nothing
 * and returns success, so without this a retraction that was not the caller's
 * to make would be reported as done and then reappear. Here the empty case is
 * not a refusal worth reporting though — the delete is scoped to `auth.uid()`
 * in the statement itself, so nothing else *can* match, and an empty result is
 * a vote already gone.
 */
export async function retractVote(pollId: string): Promise<PollResult<null>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { error } = await supabase
      .from('chat_poll_votes')
      .delete()
      .eq('poll_id', pollId)
      .eq('user_id', auth.user.id);

    if (error) return { data: null, error: toServiceError(error) };

    return ok(null);
  });
}
