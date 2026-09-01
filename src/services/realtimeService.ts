/**
 * The one websocket the app opens.
 *
 * `FamilyContext` loads the family's rows once and then keeps them warm by
 * hand — a sent message is appended, a ticked task is replaced. That covers the
 * device that made the write and nobody else, so a second member's message only
 * appeared on a pull-to-refresh. This file closes that gap: one channel per
 * family, carrying the four tables the tabs render.
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
 * all four are, from the initial migration, which also sets REPLICA IDENTITY
 * FULL on `messages` and `tasks` so a delete carries the old row. `locations`
 * and `profiles` do not have it, which is why nothing here listens for a delete
 * on either: with only the primary key in `old`, the `family_id` filter cannot
 * match and the event is never delivered.
 *
 * RLS applies to every event — the realtime server re-checks the subscriber's
 * own SELECT policies — so `family_id=eq.…` is an index filter, not a boundary.
 * The access token is set on the socket by supabase-js itself, on every auth
 * state change; nothing here has to hand it one.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import type { Database } from '@/data/database.types';
import type { ChatMessage, FamilyTask, MemberLocation } from '@/data/types';
import { toChatMessage } from '@/services/chatService';
import type { ProfileRow } from '@/services/familyService';
import { toMemberLocation } from '@/services/locationService';
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
   * the primary key alone, so the event would never arrive. That is the whole
   * reason `locations` and `profiles` have no delete listener.
   */
  onMessageRemoved: (messageId: string) => void;
  /** Insert *and* update: both arrive as the whole row, so both mean "this is the task now". */
  onTask: (task: FamilyTask) => void;
  onTaskRemoved: (taskId: string) => void;
  onLocation: (memberId: string, location: MemberLocation) => void;
  /** The raw row: a profile carries no position, and the roster's is the one to keep. */
  onProfile: (profile: ProfileRow) => void;
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
 * One channel with eight bindings rather than one channel per table: the socket
 * multiplexes them anyway, and a single topic means a single join, a single
 * rejoin, and one place to notice that the connection came back.
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
    .on<ProfileRow>(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles', filter },
      ({ new: row }) => handlers.onProfile({ ...row, created_at: toIsoTimestamp(row.created_at) }),
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
