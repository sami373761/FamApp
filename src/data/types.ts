/**
 * Domain types for FamApp.
 *
 * These are the shapes screens render. Each one is a camelCase projection of a
 * row in `database.types.ts` — nothing here describes a field the database
 * cannot supply, which is what keeps the UI honest about what is real.
 *
 * Nullability is carried through rather than defaulted away: a member who has
 * not chosen a name has `displayName: null`, and a member who is not sharing
 * their position has `location: null`. Screens render an empty state for those
 * cases instead of inventing a placeholder.
 */

import type { AvatarConfig } from '@/data/avatar';

/** `profiles.role` is a free-text column; these are the values the UI writes. */
export type FamilyRole = 'parent' | 'child' | 'guardian';

/** Derived from how recently `locations.updated_at` was touched. */
export type MemberPresence = 'online' | 'recent' | 'offline';

export type MemberLocation = {
  latitude: number;
  longitude: number;
  /** ISO timestamp, server-stamped by the `locations_touch_updated_at` trigger. */
  updatedAt: string;
};

export type FamilyMember = {
  id: string;
  /** Null until the member picks one; screens fall back to "Unnamed member". */
  displayName: string | null;
  /** Derived from `displayName`; '?' when there is none yet. */
  initials: string;
  /** Index into `MemberColors` — gives each person a stable identity colour. */
  colorIndex: number;
  /**
   * Their built face, or null when `profiles.avatar_config` is still the `{}`
   * default. Avatars fall back to initials rather than to a stand-in face.
   */
  avatar: AvatarConfig | null;
  role: FamilyRole | null;
  isAdmin: boolean;
  /** `profiles.created_at` — when the account was made. */
  createdAt: string;
  /** Their row in `locations`, or null when they share nothing. */
  location: MemberLocation | null;
  presence: MemberPresence;
};

export type Family = {
  id: string;
  /** Null for families created before the name column existed. */
  name: string | null;
  /** The 6-character code other members type on the Join screen. */
  joinCode: string;
  createdAt: string;
  maxMembers: number;
  /**
   * Whether this family was ever granted FamApp Gold. **Not the answer on its
   * own** — a grant can have lapsed. Ask `isPremiumActive(family)` in
   * `src/data/premium.ts`, which reads this together with `premiumUntil` the
   * same way `private.is_family_premium()` does server-side.
   */
  isPremium: boolean;
  /** When the grant lapses, or null when no end date was recorded. */
  premiumUntil: string | null;
};

export type MessageType = 'text' | 'image' | 'system';

/**
 * A photo that exists on this device and nowhere else yet.
 *
 * The one thing in the app that is rendered before a row backs it, and the
 * exception is narrow on purpose: it is not invented family data, it is *this*
 * user's own action a second before the network agrees. It lasts as long as one
 * upload — `FamilyContext` puts it in the list when the picker returns and
 * takes it out again when the insert lands or fails — and it never survives a
 * reload, because nothing writes it down. A pending message the app forgot is
 * the honest outcome of a send that never finished.
 *
 * Only ever set by `beginImage`. Anything that came from a row — fetched,
 * inserted or off the socket — has this undefined, which is what lets
 * `withMessage` tell a placeholder from the real thing at the same id.
 */
export type PendingUpload = {
  /** The compressed local file, so the bubble can show the actual photo. */
  localUri: string;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  type: MessageType;
  /** Null on an image-only message. */
  content: string | null;
  /** Storage object path in the private `chat-media` bucket, not a URL. */
  mediaUrl: string | null;
  createdAt: string;
  /** Set only while this device is still uploading the photo. See above. */
  pending?: PendingUpload;
};

/**
 * Grouped so the chat can render a date separator above each run of messages.
 *
 * Carries the calendar date, not a label: "Today" is a translation, and
 * `chatService` groups rows without knowing which language they will be read
 * in. The Chat screen turns `date` into copy with `dayLabel(i18n, …)`.
 */
export type ChatDay = {
  /** Stable list key — the calendar date, not the human label. */
  key: string;
  /** ISO timestamp of the first message of the day, for the separator label. */
  date: string;
  messages: ChatMessage[];
};

/** Mirrors the `tasks_status_valid` check constraint. */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'expired';

/** Mirrors the `tasks_duration_valid` check constraint. */
export type TaskDuration = '1_day' | '1_week' | '1_month';

export type FamilyTask = {
  id: string;
  title: string;
  status: TaskStatus;
  /** Null means an unclaimed pool task any member can pick up. */
  assigneeId: string | null;
  createdById: string;
  /** Last member who moved the task between states. */
  handledById: string | null;
  durationType: TaskDuration;
  expiresAt: string;
  /**
   * The chat message that announced this task, when it was created from Chat.
   * `messages` is swept on a 30-day retention cycle while the task is not, so
   * this goes back to null on a task whose announcement has aged out — the
   * column is `on delete set null` for exactly that reason.
   */
  sourceMessageId: string | null;
  createdAt: string;
};

/**
 * There is no activity table. The Home feed is folded together from the
 * messages and tasks already on screen — see `src/data/activity.ts`. Only the
 * two events that carry a real timestamp are represented: a message being sent
 * and a task being created. "Task completed" is deliberately absent, because
 * `tasks` records who completed it but never when.
 */
export type ActivityKind = 'task' | 'message';

export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  text: string;
  /** Whose colour the timeline dot takes. */
  memberId: string;
  at: string;
};

/**
 * Mirrors the `saved_places_category_valid` check constraint.
 *
 * A closed set rather than free text because every value has to resolve to an
 * icon and a label, and because "one row per (member, category)" is what caps
 * a member at five saved places — the list *is* the ceiling.
 */
export type PlaceCategory = 'home' | 'school' | 'work' | 'leisure' | 'park';

/**
 * A named coordinate the family can see, saved by one of its members.
 *
 * The first place *name* the schema can supply, which is why the map and the
 * Home pill are now allowed to render one. `title` is what the member typed —
 * nothing here is geocoded, and a place a member has not saved has no name.
 */
export type SavedPlace = {
  id: string;
  /** Who saved it. Only they may edit or delete the row. */
  ownerId: string;
  category: PlaceCategory;
  title: string;
  latitude: number;
  longitude: number;
  createdAt: string;
};
