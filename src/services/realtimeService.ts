/**
 * The one websocket the app opens.
 *
 * `FamilyContext` loads the family's rows once and then keeps them warm by
 * hand — a sent message is appended, a ticked task is replaced. That covers the
 * device that made the write and nobody else, so a second member's message only
 * appeared on a pull-to-refresh. This file closes that gap: one channel per
 * family, carrying the seven tables the tabs render.
 *
 * Votes are the newest binding and the one that most needed to be here: a poll
 * whose count only moves on a pull-to-refresh is not a poll.
 *
 * It is a service like every other — the network lives here, and the provider
 * above it never touches `supabase`. What it hands back is domain types
 * (`ChatMessage`, `FamilyTask`, `MemberLocation`) through the *same* mappers
 * the fetching services use, so a row that arrives over the socket is
 * indistinguishable from one that arrived over HTTP. The exception is
 * `profiles`: a profile row alone cannot say where its member is, so the raw
 * row goes up and the provider — which holds the position — completes it.
 *
 * Realtime is a supplement, never the source: the socket can drop, and events
 * that happened while it was down are not replayed. `onRejoin` is what says so,
 * and the provider answers it with a re-read.
 *
 * Server side this needs the table in the `supabase_realtime` publication —
 * the original four from the init migration, plus the three added with polls
 * and events — and REPLICA IDENTITY FULL on any
 * table whose deletes have to arrive, because a delete is published as the old
 * row and the default identity is the primary key alone, which the `family_id`
 * filter has nothing to match against. `messages` and `tasks` have carried it
 * since that migration and `locations` gained it in 20260901110000, so all
 * three deliver a delete, as do `chat_poll_votes` and `family_events`, which
 * gained it in 20260902110000 and 20260902120000 — retracting a vote and
 * removing a date are both deletes, and both have to reach every device. Only
 * `chat_polls` is published without it, because a poll is never updated and is
 * removed solely by its message being deleted, which the `messages` binding
 * already reports. `profiles` does not carry it, and would not be helped by it:
 * a member being removed is an UPDATE clearing `family_id`, and an update's
 * filter is matched against the *new* row, which no longer names this family.
 * That one still reaches the other devices on the next read.
 *
 * RLS applies to every event — the realtime server re-checks the subscriber's
 * own SELECT policies — so `family_id=eq.…` is an index filter, not a boundary.
 * The access token is set on the socket by supabase-js itself, on every auth
 * state change; nothing here has to hand it one.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import type { Database } from '@/data/database.types';
import type {
  ChatMessage,
  ChatPoll,
  FamilyEvent,
  FamilyTask,
  MemberLocation,
  PollVote,
} from '@/data/types';
import { toChatMessage } from '@/services/chatService';
import { toFamilyEvent } from '@/services/eventsService';
import type { ProfileRow } from '@/services/familyService';
import { toMemberLocation } from '@/services/locationService';
import { toChatPoll, toPollVote } from '@/services/pollService';
import { supabase } from '@/services/supabase';
import { toFamilyTask } from '@/services/taskService';

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type FamilyRealtimeHandlers = {
  /** A message anyone in the family posted, including this device's own. */
  onMessage: (message: ChatMessage) => void;
  /**
   * A message anyone in the family deleted, including this device's own.
   *
   * Deliverable only because `messages` carries `replica identity full`: the
   * `family_id` filter is matched against `old`, and a table without it sends
   * the primary key alone, so the event would never arrive. `profiles` is the
   * one table here still in that position, which is why it has no delete
   * listener.
   */
  onMessageRemoved: (messageId: string) => void;
  /** Insert *and* update: both arrive as the whole row, so both mean "this is the task now". */
  onTask: (task: FamilyTask) => void;
  onTaskRemoved: (taskId: string) => void;
  onLocation: (memberId: string, location: MemberLocation) => void;
  /**
   * A member stopped sharing: `clearOwnLocation()` deletes the row rather than
   * blanking it, so this is what takes the pin off everybody else's map.
   *
   * Deliverable only because `locations` carries `replica identity full`
   * (20260901110000) — the same reason the two message and task removals above
   * arrive at all.
   */
  onLocationRemoved: (memberId: string) => void;
  /** The raw row: a profile carries no position, and the roster's is the one to keep. */
  onProfile: (profile: ProfileRow) => void;
  /**
   * A poll somebody attached to a message. INSERT only: `chat_polls` has no
   * UPDATE policy — the options array is what votes index into, so editing it
   * would silently re-label answers already given — and a poll is removed by
   * its message being deleted, which arrives on `onMessageRemoved` and takes
   * the card with it.
   *
   * A row this build cannot read (options that are not 2–4 strings) is dropped
   * by `toChatPoll` and never reaches here, exactly as it is dropped on load.
   */
  onPoll: (poll: ChatPoll) => void;
  /**
   * Somebody voting, or changing their mind. Both arrive as the whole row —
   * changing a vote is an UPDATE of the same row, because `(poll_id, user_id)`
   * is unique — so both mean "this is their answer now".
   */
  onPollVote: (vote: PollVote) => void;
  /**
   * Somebody taking their vote back. There is no abstain value, so a retraction
   * is a DELETE, and it is deliverable only because `chat_poll_votes` carries
   * `replica identity full` — the `family_id` filter is matched against the old
   * row, and the default identity would send a primary key with nothing to
   * compare. Without it the tally would only fall on the next reload.
   */
  onPollVoteRemoved: (voteId: string) => void;
  /** A date somebody added to the shared calendar, or edited. */
  onEvent: (event: FamilyEvent) => void;
  /** A date somebody removed. `family_events` carries `replica identity full`. */
  onEventRemoved: (eventId: string) => void;
  /**
   * The channel joined again after having dropped. Everything that changed in
   * between was missed — the WAL is not replayed to a subscriber that was not
   * there — so the only honest response is to re-read.
   */
  onRejoin: () => void;
};

/**
 * Postgres' own text format for a timestamp — `2026-08-25 12:00:00.123456+00` —
 * is what the WAL carries, and the realtime server is not obliged to hand it
 * back in the ISO 8601 shape PostgREST returns. Two things downstream would
 * quietly break on the difference: `Date.parse` (presence, due dates) and the
 * plain string comparisons that keep the chat in order, where a space sorts
 * before a `T` and would file every incoming message at the top of the day.
 *
 * So a timestamp is repaired rather than reformatted: a value already in the
 * shape PostgREST returns comes back byte for byte, which is what lets a
 * realtime row and a fetched row sit in the same sorted list.
 */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/;

export function toIsoTimestamp(value: string): string {
  const match = TIMESTAMP.exec(value);

  if (!match) return value;

  const [, date, time, zone] = match;

  // A bare timestamp is UTC: every column this touches is `timestamptz`, and
  // the database stores and serves those in UTC.
  const offset =
    !zone || zone === 'Z'
      ? '+00:00'
      : zone.length === 3
        ? `${zone}:00`
        : zone.length === 5
          ? `${zone.slice(0, 3)}:${zone.slice(3)}`
          : zone;

  return `${date}T${time}${offset}`;
}

/**
 * Opens the family's channel and returns the function that closes it.
 *
 * One channel with sixteen bindings rather than one channel per table: the
 * socket multiplexes them anyway, and a single topic means a single join, a
 * single rejoin, and one place to notice that the connection came back.
 */
export function subscribeToFamily(familyId: string, handlers: FamilyRealtimeHandlers): () => void {
  const filter = `family_id=eq.${familyId}`;

  // Only a *re*-join means events were missed; the first one is the load that
  // has already happened above us.
  let hasJoined = false;

  const channel: RealtimeChannel = supabase
    .channel(`family-${familyId}`)
    .on<Row<'messages'>>(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter },
      ({ new: row }) => {
        handlers.onMessage(toChatMessage({ ...row, created_at: toIsoTimestamp(row.created_at) }));
      },
    )
    .on<Row<'messages'>>(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages', filter },
      ({ old: row }) => {
        // `old` is typed Partial because a table without REPLICA IDENTITY FULL
        // sends only its key. `messages` has it, so the id is really there.
        if (row.id) handlers.onMessageRemoved(row.id);
      },
    )
    .on<Row<'tasks'>>(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'tasks', filter },
      ({ new: row }) => handlers.onTask(toRealtimeTask(row)),
    )
    .on<Row<'tasks'>>(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'tasks', filter },
      ({ new: row }) => handlers.onTask(toRealtimeTask(row)),
    )
    .on<Row<'tasks'>>(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'tasks', filter },
      ({ old: row }) => {
        // `old` is typed Partial because a table without REPLICA IDENTITY FULL
        // sends only its key. `tasks` has it, so the id is really there.
        if (row.id) handlers.onTaskRemoved(row.id);
      },
    )
    .on<Row<'locations'>>(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'locations', filter },
      ({ new: row }) => handlers.onLocation(row.user_id, toRealtimeLocation(row)),
    )
    .on<Row<'locations'>>(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'locations', filter },
      ({ new: row }) => handlers.onLocation(row.user_id, toRealtimeLocation(row)),
    )
    .on<Row<'locations'>>(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'locations', filter },
      ({ old: row }) => {
        // `old` is typed Partial because a table without REPLICA IDENTITY FULL
        // sends only its key. `locations` has it, so the member id is really
        // there — and the whole old row is what the filter above matched on.
        if (row.user_id) handlers.onLocationRemoved(row.user_id);
      },
    )
    .on<ProfileRow>(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles', filter },
      ({ new: row }) => handlers.onProfile({ ...row, created_at: toIsoTimestamp(row.created_at) }),
    )
    .on<Row<'chat_polls'>>(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_polls', filter },
      ({ new: row }) => {
        const poll = toChatPoll({ ...row, created_at: toIsoTimestamp(row.created_at) });

        // Options this build cannot read — see `toPollOptions`. The question is
        // still a message and still renders; only the card is withheld.
        if (poll) handlers.onPoll(poll);
      },
    )
    .on<Row<'chat_poll_votes'>>(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_poll_votes', filter },
      ({ new: row }) =>
        handlers.onPollVote(toPollVote({ ...row, created_at: toIsoTimestamp(row.created_at) })),
    )
    .on<Row<'chat_poll_votes'>>(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'chat_poll_votes', filter },
      ({ new: row }) =>
        handlers.onPollVote(toPollVote({ ...row, created_at: toIsoTimestamp(row.created_at) })),
    )
    .on<Row<'chat_poll_votes'>>(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'chat_poll_votes', filter },
      ({ old: row }) => {
        // `old` is typed Partial because a table without REPLICA IDENTITY FULL
        // sends only its key. `chat_poll_votes` has it, so the id is really
        // there — and the whole old row is what the filter above matched on.
        if (row.id) handlers.onPollVoteRemoved(row.id);
      },
    )
    .on<Row<'family_events'>>(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'family_events', filter },
      ({ new: row }) => {
        const event = toFamilyEvent({ ...row, created_at: toIsoTimestamp(row.created_at) });

        if (event) handlers.onEvent(event);
      },
    )
    .on<Row<'family_events'>>(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'family_events', filter },
      ({ new: row }) => {
        const event = toFamilyEvent({ ...row, created_at: toIsoTimestamp(row.created_at) });

        if (event) handlers.onEvent(event);
      },
    )
    .on<Row<'family_events'>>(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'family_events', filter },
      ({ old: row }) => {
        // Same reasoning as the vote delete above: `family_events` carries
        // REPLICA IDENTITY FULL, so the id and the family filter both arrive.
        if (row.id) handlers.onEventRemoved(row.id);
      },
    )
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;

      if (hasJoined) handlers.onRejoin();

      hasJoined = true;
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

function toRealtimeTask(row: Row<'tasks'>): FamilyTask {
  return toFamilyTask({
    ...row,
    created_at: toIsoTimestamp(row.created_at),
    expires_at: toIsoTimestamp(row.expires_at),
  });
}

function toRealtimeLocation(row: Row<'locations'>): MemberLocation {
  return toMemberLocation({ ...row, updated_at: toIsoTimestamp(row.updated_at) });
}
