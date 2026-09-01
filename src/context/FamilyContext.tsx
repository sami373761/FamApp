/**
 * Everything the tabs render, loaded once for the signed-in user's family.
 *
 * Home, Chat, Map, Tasks and Profile all need the member list, and three of
 * them need messages or tasks as well. Fetching per screen would mean the same
 * rows arriving four times and a task ticked on one tab going stale on another,
 * so the family's data is app-wide state — the same reasoning that puts the
 * profile in `AuthContext` rather than in a screen.
 *
 * `family_id` is the key: it comes from the profile, and while it is null (no
 * family yet, or signed out) this provider holds nothing and reports nothing to
 * load. Screens under `(tabs)` only exist when it is set — see `RootNavigator`.
 */

import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { presenceFrom } from '@/data/format';
import { isPremiumActive, memberLimitFor } from '@/data/premium';
import type {
  ChatMessage,
  Family,
  FamilyMember,
  FamilyTask,
  MemberLocation,
  PlaceCategory,
  SavedPlace,
  TaskDuration,
  TaskStatus,
} from '@/data/types';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/use-translation';
import * as chatMediaService from '@/services/chatMediaService';
import * as chatService from '@/services/chatService';
import {
  getFamilyOverview,
  regenerateJoinCode as regenerateJoinCodeRequest,
  removeMember as removeMemberRequest,
  toFamilyMember,
  type ProfileRow,
} from '@/services/familyService';
import * as placesService from '@/services/placesService';
import { subscribeToFamily } from '@/services/realtimeService';
import { errorText } from '@/services/result';
import * as taskService from '@/services/taskService';
import type { Translator } from '@/i18n';

/**
 * Everything the task composer collects.
 *
 * `note` is not a task column — there is none — it is an ordinary chat message
 * posted just before the announcement, from the person creating the task. That
 * keeps it honest: what the user typed is a message, and it is stored as one.
 */
export type NewTask = {
  title: string;
  /** Null leaves the task in the pool for anyone to pick up. */
  assigneeId?: string | null;
  durationType?: TaskDuration;
  note?: string | null;
};

/**
 * Everything the place composer collects.
 *
 * No owner and no family: both are decided by the session and pinned by the
 * database — `saved_places: insert own` checks one and
 * `saved_places_check_family` the other — so offering either would be offering
 * a write that cannot land.
 */
export type NewPlace = {
  category: PlaceCategory;
  title: string;
  latitude: number;
  longitude: number;
};

export type FamilyContextValue = {
  family: Family | null;
  /**
   * Whether this family holds an unexpired FamApp Gold grant.
   *
   * Derived from the family row through `isPremiumActive`, not stored: the two
   * columns behind it can go stale on their own — a grant lapses without
   * anything writing a row — so a boolean captured at load time would keep
   * claiming Gold after it ran out. It is exposed here rather than left to each
   * screen so the paywall, the Profile row and the map's place ceiling all read
   * the one answer.
   *
   * False with no family: a solo user has no row to carry a subscription.
   */
  isPremium: boolean;
  /**
   * How many members this family may hold — 5 free, 10 on Gold, and never above
   * the row's own `max_members`.
   *
   * Derived beside `isPremium` for the same reason it is: the ceiling moves the
   * moment a grant lapses, so a screen holding the number it read at load time
   * would keep offering room the trigger has since taken away. Both counters —
   * Profile's row and the Members screen's line — read this one answer rather
   * than `family.maxMembers`, which is the schema's hard bound and says nothing
   * about the tier.
   *
   * `GOLD_MEMBER_LIMIT` with no family: there is no row to be capped, and a
   * solo user is not shown a count anywhere.
   */
  memberLimit: number;
  members: FamilyMember[];
  messages: ChatMessage[];
  tasks: FamilyTask[];
  /**
   * Every place anybody in the family has saved. Family-wide by design: a place
   * is worth naming because everyone can see it, which is also exactly what the
   * `saved_places: family reads` policy allows.
   */
  places: SavedPlace[];
  /** The signed-in user's own row in `members`, once it has loaded. */
  currentMember: FamilyMember | null;
  /** Components hold member *ids*; this is how they resolve one. */
  getMember: (id: string | null | undefined) => FamilyMember | undefined;
  /** True only on the first load for a family — a refresh does not blank the UI. */
  isLoading: boolean;
  isRefreshing: boolean;
  /** Safe to render. Null when the last load succeeded. */
  error: string | null;
  refresh: () => Promise<void>;
  /** Every write below resolves to an error message to display, or null. */
  sendMessage: (text: string) => Promise<string | null>;
  /**
   * Puts the photo in the chat *before* it has been uploaded, as the sender's
   * own bubble under a progress veil.
   *
   * The three photo calls are one flow and are split because the slow middle
   * belongs to the screen: `beginImage` when the picker returns, then the
   * upload, then `sendImage` on success or `discardImage` on failure. Nothing
   * else in the app renders ahead of a row — see `PendingUpload` for why this
   * one is allowed to and why the exception does not widen.
   *
   * Synchronous and returns nothing, because there is nothing to fail: it is a
   * local commit of a photo the device already holds. A caller with no family
   * or no profile is a no-op rather than an error, since the send that would
   * follow could not have happened either.
   */
  beginImage: (messageId: string, localUri: string, caption?: string | null) => void;
  /**
   * Takes that placeholder back out — the upload failed, or the user cancelled
   * out of the picker after one had already been put up.
   *
   * `sendImage` calls this itself when the *insert* fails, so a caller only
   * needs it for the half it owns.
   */
  discardImage: (messageId: string) => void;
  /**
   * Posts an already-uploaded photo, by the id it was uploaded under and the
   * object path that came back.
   *
   * Takes the path rather than the picked image because the *upload* is the
   * slow half and belongs to the screen, which is what shows a progress row
   * while it runs. This is only the row and the local append — the same split
   * `setOwnLocation` makes, and for the same reason: a message naming an object
   * that was never stored would render as a broken photo for everyone.
   *
   * `messageId` is the one `chatMediaService.newMessageId()` produced before the
   * upload, so the object is already named after the row this is about to
   * insert. Reconciliation needs nothing extra for it: the local append and the
   * socket's echo of the same insert are matched on that id by `withMessage`,
   * which is the same key it would have had from `gen_random_uuid()` — and it
   * is what lets the confirmed row *replace* `beginImage`'s placeholder rather
   * than appear beneath it as a second copy of the same photo.
   *
   * `caption` is the optional text typed under the photo in the confirmation
   * step, stored as the same row's `content` rather than as a message of its
   * own — one row is what keeps a caption attached to its picture.
   */
  sendImage: (
    messageId: string,
    mediaPath: string,
    caption?: string | null,
  ) => Promise<string | null>;
  /**
   * Deletes a message, and the stored object behind it when it is a photo.
   *
   * **Optimistic**: the row leaves the local list first and is put back, in its
   * own place, if the server refuses. That refusal is a real possibility rather
   * than a formality — `messages: delete own or admin` is enforced, unlike the
   * client-side courtesies around tasks and the Gold gate — so this is one of
   * the few writes whose failure path a user can actually reach by trying.
   *
   * A pending placeholder is dropped locally without asking the server, since
   * there is no row to delete yet.
   */
  deleteMessage: (messageId: string) => Promise<string | null>;
  setTaskStatus: (taskId: string, status: TaskStatus) => Promise<string | null>;
  /**
   * Creates the task **and** announces it in the chat, which is what puts a
   * card in the message stream. Chat is the primary way tasks are made, so the
   * announcement is part of creating one rather than an option on it.
   */
  createTask: (input: NewTask) => Promise<string | null>;
  /**
   * Admin-only, enforced by the database. A member who is not an admin gets
   * the RPC's own refusal back as the message.
   */
  removeMember: (memberId: string) => Promise<string | null>;
  /**
   * Admin-only: replaces the family's join code with a new one.
   *
   * Lives here rather than being called from the screen so the code the Profile
   * tab is showing changes in the same commit — there is one `family` object
   * and every screen reads its `joinCode` from it. Like every other write, it
   * resolves to a message to display or null.
   */
  regenerateJoinCode: () => Promise<string | null>;
  /**
   * The three place writes, each resolving to a message to display or null.
   * Only your own places can be changed or removed — that is the RLS policy,
   * not a rule re-stated here, so a refusal arrives as the service's own error.
   */
  savePlace: (input: NewPlace) => Promise<string | null>;
  editPlace: (placeId: string, patch: NewPlace) => Promise<string | null>;
  deletePlace: (placeId: string) => Promise<string | null>;
  /**
   * Puts the caller's own position — or its absence — into the roster the map
   * is already rendering, after `locationService` has stored it.
   *
   * A local commit rather than a `refresh()`, for the same reason sending a
   * message appends: the write already returned the stored row, and a position
   * refreshing on a twelve-minute cadence should not drag the message and task
   * lists along with it. This does not *decide* anything — passing a location
   * that was never written would put a pin on the map that no other member can
   * see, which is the one thing this must not do.
   */
  setOwnLocation: (location: MemberLocation | null) => void;
};

export const FamilyContext = createContext<FamilyContextValue | null>(null);

/**
 * Stamped with the family it belongs to, so the value is *derived* rather than
 * synchronised — the same trick `AuthContext` uses for the profile. Without it,
 * leaving one family and joining another would show the old members until the
 * new fetch resolved.
 */
type LoadedFamily = {
  familyId: string;
  family: Family | null;
  members: FamilyMember[];
  messages: ChatMessage[];
  tasks: FamilyTask[];
  places: SavedPlace[];
  error: string | null;
};

const EMPTY_MEMBERS: FamilyMember[] = [];
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_TASKS: FamilyTask[] = [];
const EMPTY_PLACES: SavedPlace[] = [];

/*
  Every commit into a loaded family goes through one of the reducers below — a
  write this device made and an event another member's device caused alike. That
  is what keeps the two from fighting: an insert this app has already appended
  locally arrives over the socket a moment later carrying the same primary key,
  and a reducer that matches on the key can only ever hold one of them.

  Each returns the state it was handed, unchanged, when there is nothing to do,
  so `setLoaded` sees the same object and React skips the render.
*/

/** Flat projections of one row, so key-by-key equality is exact rather than a guess. */
function isSameRow<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every((key) => a[key] === b[key]);
}

/** The order `listTasks` returns: soonest deadline first. */
const byExpiry = (a: FamilyTask, b: FamilyTask) => a.expiresAt.localeCompare(b.expiresAt);

/** The order `getFamilyOverview` returns: admins first, then oldest profile first. */
const byStanding = (a: FamilyMember, b: FamilyMember) =>
  Number(b.isAdmin) - Number(a.isAdmin) || a.createdAt.localeCompare(b.createdAt);

function withMessage(state: LoadedFamily, message: ChatMessage): LoadedFamily {
  const existing = state.messages.findIndex((candidate) => candidate.id === message.id);

  if (existing !== -1) {
    // Already here as a real row: the local append and the socket's echo of the
    // same insert both arrive, in either order, and only one of them may land.
    if (!state.messages[existing].pending) return state;

    // Here as this device's own placeholder, now confirmed. It is *removed and
    // re-inserted* rather than overwritten in place, because the server stamped
    // `created_at` itself and it will not be the local clock's guess — leaving
    // it at the placeholder's index would file it out of order against anything
    // that arrived while the upload was running.
    const without = state.messages.filter((candidate) => candidate.id !== message.id);

    return withMessage({ ...state, messages: without }, message);
  }

  const messages = [...state.messages];

  // Oldest last, and almost always simply last. The scan back only earns its
  // keep when a socket event and a local append cross in flight.
  let at = messages.length;

  while (at > 0 && messages[at - 1].createdAt > message.createdAt) at -= 1;

  messages.splice(at, 0, message);

  return { ...state, messages };
}

/**
 * Drops a message by id.
 *
 * Three callers, all of them removals of something that is no longer there or
 * never got there: a pending placeholder whose upload failed, a message this
 * device just deleted, and the socket's `DELETE` event for one somebody else
 * deleted. The last of those works only because `messages` carries `replica
 * identity full` — see `realtimeService`.
 */
function withoutMessage(state: LoadedFamily, messageId: string): LoadedFamily {
  const messages = state.messages.filter((candidate) => candidate.id !== messageId);

  return messages.length === state.messages.length ? state : { ...state, messages };
}

/** Insert and update in one: both carry the whole row, so both mean "this is the task now". */
function withTask(state: LoadedFamily, task: FamilyTask): LoadedFamily {
  const index = state.tasks.findIndex((candidate) => candidate.id === task.id);

  if (index === -1) return { ...state, tasks: [...state.tasks, task].sort(byExpiry) };
  if (isSameRow(state.tasks[index], task)) return state;

  const tasks = [...state.tasks];

  tasks[index] = task;

  return { ...state, tasks: tasks.sort(byExpiry) };
}

function withoutTask(state: LoadedFamily, taskId: string): LoadedFamily {
  const tasks = state.tasks.filter((task) => task.id !== taskId);

  return tasks.length === state.tasks.length ? state : { ...state, tasks };
}

/**
 * One member's position, or its absence — null is a member who has stopped
 * sharing, which is the same thing `clearOwnLocation` leaves behind.
 *
 * Presence is recomputed here rather than carried, because it is derived from
 * how old the position is: a fresh write makes the member live and a cleared
 * one makes them offline, in the same commit.
 */
function withLocation(
  state: LoadedFamily,
  memberId: string,
  location: MemberLocation | null,
): LoadedFamily {
  const member = state.members.find((candidate) => candidate.id === memberId);

  // A position for somebody the roster has never heard of: the profile row that
  // would introduce them has not arrived, and inventing a member from a pair of
  // coordinates is exactly what this app does not do.
  if (!member) return state;

  if (member.location === location) return state;
  if (member.location && location && isSameRow(member.location, location)) return state;

  return {
    ...state,
    members: state.members.map((candidate) =>
      candidate.id === memberId
        ? { ...candidate, location, presence: presenceFrom(location) }
        : candidate,
    ),
  };
}

/**
 * A profile row — from a member editing their name, colour or avatar, or from
 * somebody joining, which reaches us as the same UPDATE with `family_id` newly
 * set to this family. So an unknown id is added rather than ignored, and the
 * roster gains the new member without waiting for a refresh.
 *
 * The position comes from the roster, never from the row: `profiles` holds none.
 */
function withProfile(state: LoadedFamily, row: ProfileRow): LoadedFamily {
  const index = state.members.findIndex((candidate) => candidate.id === row.id);
  const existing = index === -1 ? null : state.members[index];
  const member = toFamilyMember(row, existing?.location ?? null);

  if (!existing) return { ...state, members: [...state.members, member].sort(byStanding) };

  const members = [...state.members];

  members[index] = member;

  return { ...state, members: members.sort(byStanding) };
}

/**
 * What the announcement message says.
 *
 * It is the fallback as much as the label: once the 30-day sweep removes the
 * task — or if the link never landed — this text is all that is left of the
 * card, so it has to read as a sentence on its own.
 *
 * Written in the *creator's* language and stored as message text, so it stays
 * in that language for every reader — a `messages` row is a row, not a key, and
 * rewriting one person's chat line into another person's language would be
 * inventing content the table does not hold.
 */
function announcementFor(i18n: Translator, title: string): string {
  return i18n.t('system.newTask', { title });
}

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const i18n = useTranslation();
  const familyId = profile?.family_id ?? null;

  const [loaded, setLoaded] = useState<LoadedFamily | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * `refresh()` is awaited from screens that unmount on success (Edit profile,
   * Edit avatar) and fired by pull-to-refresh, which can overlap with itself.
   * The generation counter makes the *latest* request the only one allowed to
   * write, so a slow earlier response cannot overwrite a newer one.
   */
  const mounted = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (id: string): Promise<LoadedFamily> => {
    // Note the `i18n` dependency below: the banner is stored as a *sentence*,
    // so switching language re-runs this and the message comes back translated
    // rather than frozen in whatever language it first failed in.
    const [overview, messages, tasks, places] = await Promise.all([
      getFamilyOverview(id),
      chatService.listMessages(id),
      taskService.listTasks(id),
      placesService.listPlaces(id),
    ]);

    return {
      familyId: id,
      family: overview.data?.family ?? null,
      members: overview.data?.members ?? EMPTY_MEMBERS,
      messages: messages.data ?? EMPTY_MESSAGES,
      tasks: tasks.data ?? EMPTY_TASKS,
      places: places.data ?? EMPTY_PLACES,
      // One banner is enough; the first failure is the one worth showing.
      error: [overview.error, messages.error, tasks.error, places.error]
        .filter((failure) => failure !== null)
        .map((failure) => errorText(i18n, failure))[0] ?? null,
    };
  }, [i18n]);

  useEffect(() => {
    if (!familyId) return;

    // Bumping the generation here too: a refresh of the *previous* family that
    // is still in flight must not land on top of the family just switched to.
    const request = ++generation.current;

    let active = true;

    void load(familyId).then((next) => {
      if (active && request === generation.current) setLoaded(next);
    });

    return () => {
      active = false;
    };
  }, [familyId, load]);

  /**
   * Re-reads everything without touching `isRefreshing`: pull-to-refresh owns
   * that spinner, and a socket that has just reconnected must not pull it down
   * on its own.
   */
  const reload = useCallback(async () => {
    if (!familyId) return;

    const request = ++generation.current;

    const next = await load(familyId);

    if (!mounted.current) return;

    // Only the newest request may write.
    if (request === generation.current) setLoaded(next);
  }, [familyId, load]);

  const refresh = useCallback(async () => {
    if (!familyId) return;

    setIsRefreshing(true);

    await reload();

    if (!mounted.current) return;

    // Any request may stop the spinner, even a superseded one — clearing it
    // early beats leaving it stuck on.
    setIsRefreshing(false);
  }, [familyId, reload]);

  // Anything stamped with a different family is a leftover and must not be read.
  const current = loaded?.familyId === familyId ? loaded : null;

  /**
   * The one way anything writes into the loaded family, and only into *this*
   * family: state stamped with another one belongs to a family the user has
   * since left, and patching it would show the old members again.
   */
  const commit = useCallback(
    (patch: (previous: LoadedFamily) => LoadedFamily) => {
      setLoaded((previous) => (previous?.familyId === familyId ? patch(previous) : previous));
    },
    [familyId],
  );

  /*
    `reload` changes identity with the language — the banner it loads is a
    translated sentence — and a language switch has no business tearing down a
    websocket, so the rejoin handler below reaches it through a ref. That keeps
    the channel keyed on the family and nothing else.
  */
  const reloadRef = useRef(reload);

  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  /**
   * The family's live connection.
   *
   * Everything above this point is a pull: the load, the pull-to-refresh, and
   * the local commit each write makes. None of them can tell this device that
   * *another* member has said something, so without the channel a second phone's
   * message only appeared when someone dragged the list down. The reducers do
   * the reconciling — a row arriving twice, once from the write and once from
   * the socket, lands once.
   */
  useEffect(() => {
    if (!familyId) return;

    return subscribeToFamily(familyId, {
      onMessage: (message) => commit((previous) => withMessage(previous, message)),
      onMessageRemoved: (messageId) => commit((previous) => withoutMessage(previous, messageId)),
      onTask: (task) => commit((previous) => withTask(previous, task)),
      onTaskRemoved: (taskId) => commit((previous) => withoutTask(previous, taskId)),
      onLocation: (memberId, location) =>
        commit((previous) => withLocation(previous, memberId, location)),
      // Somebody switched sharing off, which deletes their row: the pin comes
      // off this map too, not just theirs. `withLocation` already treats a null
      // position as an absent one and recomputes presence from it.
      onLocationRemoved: (memberId) =>
        commit((previous) => withLocation(previous, memberId, null)),
      onProfile: (row) => commit((previous) => withProfile(previous, row)),
      // Nothing that happened while the socket was down is replayed, so a
      // rejoin is only a promise that events start again — the rows in between
      // have to be fetched.
      onRejoin: () => void reloadRef.current(),
    });
  }, [commit, familyId]);

  const sendMessage = useCallback(
    async (text: string): Promise<string | null> => {
      if (!familyId) return i18n.t('errors.family.none');

      const { data, error } = await chatService.sendMessage(familyId, text);

      if (error) return errorText(i18n, error);

      // Committing beats refetching: the insert already returned the stored
      // row. It goes through the same reducer the channel uses, because the
      // socket may well have delivered this very row already.
      commit((previous) => withMessage(previous, data));

      return null;
    },
    [commit, familyId, i18n],
  );

  const beginImage = useCallback(
    (messageId: string, localUri: string, caption?: string | null): void => {
      if (!familyId || !profile?.id) return;

      // The local clock, which is the one thing here the server will disagree
      // with — `created_at` is stamped `now()` on insert. It only has to be
      // close enough to file the bubble at the bottom where the sender is
      // looking; `withMessage` re-files it for real once the row comes back.
      commit((previous) =>
        withMessage(previous, {
          id: messageId,
          senderId: profile.id,
          type: 'image',
          // Trimmed to null the same way `sendImageMessage` will trim it, so
          // the placeholder and the row it becomes say the same thing.
          content: caption?.trim() || null,
          // No object path yet — that is the whole point of `pending`, and it
          // is why `ChatImage` reads `localUri` instead of trying to sign this.
          mediaUrl: null,
          createdAt: new Date().toISOString(),
          pending: { localUri },
        }),
      );
    },
    [commit, familyId, profile?.id],
  );

  const discardImage = useCallback(
    (messageId: string): void => {
      commit((previous) => withoutMessage(previous, messageId));
    },
    [commit],
  );

  const sendImage = useCallback(
    async (
      messageId: string,
      mediaPath: string,
      caption?: string | null,
    ): Promise<string | null> => {
      if (!familyId) return i18n.t('errors.family.none');

      const { data, error } = await chatService.sendImageMessage(
        familyId,
        messageId,
        mediaPath,
        caption,
      );

      // The caller reports the failure; the placeholder goes either way, since
      // a bubble that stays behind an error message reads as a photo that is
      // still on its way.
      if (error) {
        commit((previous) => withoutMessage(previous, messageId));

        return errorText(i18n, error);
      }

      // Same reducer the channel uses — this replaces the placeholder above,
      // or does nothing if the socket already delivered the confirmed row.
      commit((previous) => withMessage(previous, data));

      return null;
    },
    [commit, familyId, i18n],
  );

  const deleteMessage = useCallback(
    async (messageId: string): Promise<string | null> => {
      // Held before the optimistic removal, because it is the only copy of the
      // row left afterwards — both to put back if the delete is refused, and to
      // read `mediaUrl` off once it succeeds.
      const removed = current?.messages.find((message) => message.id === messageId);

      if (!removed) return null;

      // A placeholder was never inserted, so there is nothing to ask the server
      // about — dropping it locally *is* the delete. The upload still running
      // behind it will find its own row gone and report that, which is the
      // truthful outcome of cancelling something mid-flight.
      if (removed.pending) {
        commit((previous) => withoutMessage(previous, messageId));

        return null;
      }

      commit((previous) => withoutMessage(previous, messageId));

      const { error } = await chatService.deleteMessage(messageId);

      if (error) {
        // Put it back exactly where it was: `withMessage` re-files it by
        // `createdAt`, so it returns to its own place rather than the bottom.
        commit((previous) => withMessage(previous, removed));

        return errorText(i18n, error);
      }

      // Row first, object second, and the object's failure is not reported —
      // see `deleteChatImage`. An orphaned object is invisible and the 10-day
      // sweep collects it; a message pointing at a deleted object would be a
      // broken photo for the whole family.
      if (removed.type === 'image' && removed.mediaUrl) {
        void chatMediaService.deleteChatImage(removed.mediaUrl);
      }

      return null;
    },
    [commit, current?.messages, i18n],
  );

  const setTaskStatus = useCallback(
    async (taskId: string, status: TaskStatus): Promise<string | null> => {
      const { data, error } = await taskService.setTaskStatus(taskId, status);

      if (error) return errorText(i18n, error);

      commit((previous) => withTask(previous, data));

      return null;
    },
    [commit, i18n],
  );

  /**
   * Task first, chat second.
   *
   * The two rows point at each other in one direction only — `source_message_id`
   * lives on the task — so something has to go first, and it should be the task:
   * if the chat writes fail afterwards the user still has a real task on the
   * Tasks page, whereas announcing first would leave a message about a task
   * that was never created. Every step commits to local state as it lands, so a
   * partial success is partially visible rather than invisible.
   */
  const createTask = useCallback(
    async (input: NewTask): Promise<string | null> => {
      if (!familyId) return i18n.t('errors.family.none');

      const { data: task, error } = await taskService.createTask({
        familyId,
        title: input.title,
        assigneeId: input.assigneeId ?? null,
        durationType: input.durationType,
      });

      if (error) return errorText(i18n, error);

      // `listTasks` orders by deadline, so the new row is spliced in rather
      // than appended — otherwise it would jump on the next refresh.
      commit((previous) => withTask(previous, task));

      const note = input.note?.trim();

      // The note goes in as an ordinary message from the user, before the
      // announcement, so the chat reads as "here is why" followed by the card.
      // Its failure is reported rather than swallowed — it is text the user
      // typed, and losing it silently would be the worst of the outcomes here.
      let noteFailed = false;

      if (note) {
        const { data: noteMessage } = await chatService.sendMessage(familyId, note);

        if (noteMessage) {
          commit((previous) => withMessage(previous, noteMessage));
        } else {
          noteFailed = true;
        }
      }

      const { data: announcement, error: announceError } = await chatService.sendSystemMessage(
        familyId,
        announcementFor(i18n, task.title),
      );

      if (announceError || !announcement) {
        // The task is real and already in the list above; only the chat is
        // short of it. Say exactly that rather than implying nothing happened.
        return i18n.t('errors.task.notPosted');
      }

      commit((previous) => withMessage(previous, announcement));

      const { data: linked } = await taskService.linkTaskToMessage(task.id, announcement.id);

      // Without the link the message renders as its own plain text instead of
      // as a card — a weaker result, not a broken one, so it is not an error.
      if (linked) {
        commit((previous) => withTask(previous, linked));
      }

      // Reported last: the card is on screen either way, so this is a note that
      // went missing rather than a task that did not happen.
      if (noteFailed) {
        return i18n.t('errors.task.noteFailed');
      }

      return null;
    },
    [commit, familyId, i18n],
  );

  const removeMember = useCallback(
    async (memberId: string): Promise<string | null> => {
      const { error } = await removeMemberRequest(memberId);

      if (error) return errorText(i18n, error);

      // Dropping the member locally beats refetching: `remove_member` returns
      // nothing to merge, and the row it cleared is no longer visible to this
      // caller anyway — RLS scopes `profiles` to the family.
      commit((previous) => ({
        ...previous,
        members: previous.members.filter((member) => member.id !== memberId),
      }));

      return null;
    },
    [commit, i18n],
  );

  const regenerateJoinCode = useCallback(async (): Promise<string | null> => {
    const { data, error } = await regenerateJoinCodeRequest();

    if (error) return errorText(i18n, error);

    // A local commit, not a `refresh()`: the RPC returned the code it stored,
    // and nothing else about the family moved. Nothing listens for `families`
    // over the socket either, so there is no echo of this to reconcile — but it
    // still returns the state it was handed when the code is unchanged, the
    // same contract the reducers above keep.
    commit((previous) =>
      previous.family && previous.family.joinCode !== data
        ? { ...previous, family: { ...previous.family, joinCode: data } }
        : previous,
    );

    return null;
  }, [commit, i18n]);

  /**
   * Commits one place into the loaded family, or removes it when `next` is
   * null. Every place write returns the stored row (or nothing, for a delete),
   * so this is a local commit rather than a `refresh()` — the same rule
   * `sendMessage` follows, and the reason the map does not blink after a save.
   */
  const commitPlace = useCallback(
    (placeId: string, next: SavedPlace | null) => {
      commit((previous) => {
        const without = previous.places.filter((place) => place.id !== placeId);

        return { ...previous, places: next ? [...without, next] : without };
      });
    },
    [commit],
  );

  const savePlace = useCallback(
    async (input: NewPlace): Promise<string | null> => {
      if (!familyId) return i18n.t('errors.family.none');

      const { data, error } = await placesService.createPlace({ familyId, ...input });

      if (error) return errorText(i18n, error);

      commitPlace(data.id, data);

      return null;
    },
    [commitPlace, familyId, i18n],
  );

  const editPlace = useCallback(
    async (placeId: string, patch: NewPlace): Promise<string | null> => {
      const { data, error } = await placesService.updatePlace(placeId, patch);

      if (error) return errorText(i18n, error);

      commitPlace(placeId, data);

      return null;
    },
    [commitPlace, i18n],
  );

  const deletePlace = useCallback(
    async (placeId: string): Promise<string | null> => {
      const { error } = await placesService.deletePlace(placeId);

      if (error) return errorText(i18n, error);

      commitPlace(placeId, null);

      return null;
    },
    [commitPlace, i18n],
  );

  const setOwnLocation = useCallback(
    (location: MemberLocation | null) => {
      const ownId = profile?.id;

      if (!ownId) return;

      // The same reducer the channel's own `locations` events use, which is
      // what makes this write and the echo of it that comes back over the
      // socket a moment later land as one.
      commit((previous) => withLocation(previous, ownId, location));
    },
    [commit, profile?.id],
  );

  const value = useMemo<FamilyContextValue>(() => {
    const members = current?.members ?? EMPTY_MEMBERS;

    // With no family there is no roster to find yourself in, but the profile
    // row carries the same identity — name, colour, avatar — so the user still
    // sees themselves on Home and Profile instead of a '?' circle. Built only
    // in that case: once a family exists its roster is the authority, and it
    // also carries `isAdmin` and a location that a lone profile row cannot.
    const soloMember = !familyId && profile ? toFamilyMember(profile, null) : null;

    const family = current?.family ?? null;
    const isPremium = isPremiumActive(family);

    return {
      family,
      isPremium,
      memberLimit: memberLimitFor(isPremium, family?.maxMembers),
      members,
      messages: current?.messages ?? EMPTY_MESSAGES,
      tasks: current?.tasks ?? EMPTY_TASKS,
      places: current?.places ?? EMPTY_PLACES,
      currentMember: members.find((member) => member.id === profile?.id) ?? soloMember,
      getMember: (id) => (id ? members.find((member) => member.id === id) : undefined),
      isLoading: !!familyId && !current,
      isRefreshing,
      error: current?.error ?? null,
      refresh,
      sendMessage,
      beginImage,
      discardImage,
      sendImage,
      deleteMessage,
      setTaskStatus,
      createTask,
      removeMember,
      regenerateJoinCode,
      savePlace,
      editPlace,
      deletePlace,
      setOwnLocation,
    };
  }, [
    beginImage,
    createTask,
    current,
    deleteMessage,
    deletePlace,
    discardImage,
    editPlace,
    familyId,
    isRefreshing,
    profile,
    refresh,
    regenerateJoinCode,
    removeMember,
    savePlace,
    sendImage,
    sendMessage,
    setOwnLocation,
    setTaskStatus,
  ]);

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}
