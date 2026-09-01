/**
 * Display formatting for values the database stores as raw ISO timestamps and
 * nullable text.
 *
 * The old fixtures carried pre-formatted strings ("12 min ago", "Today · 17:00")
 * because nothing computed them. Real rows carry `timestamptz`, so every one of
 * those labels is derived here — in one place, so the Home list, the map card
 * and the chat all age the same way.
 *
 * **Every function that produces copy takes the `Translator` as its first
 * argument.** That keeps this file what it has always been — pure derivation,
 * same inputs, same output — rather than making it read an ambient "current
 * language" that a caller cannot see. It is also what makes the locale explicit
 * for `toLocaleDateString`: once someone has picked a language by hand, the
 * device's own locale is the wrong answer, and passing `i18n.locale` is what
 * stops a Japanese UI printing an English month name.
 *
 * The predicates (`presenceFrom`, `isRecentlySynced`, `isOverdue`, `isDueToday`)
 * and `initialsFrom` / `dayKey` produce no copy and are untouched.
 */

import type { Translator } from '@/i18n';
import type { FamilyMember, FamilyRole, MemberLocation, MemberPresence } from '@/data/types';

/** A location touched within this window counts as live. */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
/** Beyond this a member reads as offline rather than merely stale. */
const RECENT_WINDOW_MS = 60 * 60 * 1000;

/**
 * One tracking interval — `LocationProvider` takes a fix every twelve minutes.
 *
 * A row written inside it means that member's app is running and syncing right
 * now, which is a different question from the one `presenceFrom` answers: that
 * is about the *pin* being fresh enough to trust (five minutes), this is about
 * the device still reporting at all. It is what the avatar presence ring reads.
 * Deliberately a literal rather than an import: `data/` derives, it does not
 * depend on the providers above it.
 */
export const SYNCED_WINDOW_MS = 12 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "Sami Yıldız" -> "SY", "Deniz" -> "D". Falls back to '?' rather than an empty
 * bubble so an unnamed member still renders a stable avatar.
 */
export function initialsFrom(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return '?';

  const letters = words.length === 1 ? [words[0][0]] : [words[0][0], words[words.length - 1][0]];

  return letters.join('').toUpperCase();
}

/** Shown wherever a member has not set `display_name` yet. */
export function unnamedMember(i18n: Translator): string {
  return i18n.t('common.unnamedMember');
}

/** First word only — used on map pins, where space is tight. */
export function firstNameOf(i18n: Translator, name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();

  return trimmed ? trimmed.split(/\s+/)[0] : unnamedMember(i18n);
}

export function memberName(i18n: Translator, member: Pick<FamilyMember, 'displayName'>): string {
  return member.displayName?.trim() || unnamedMember(i18n);
}

export function presenceFrom(location: MemberLocation | null, now = Date.now()): MemberPresence {
  if (!location) return 'offline';

  const age = now - new Date(location.updatedAt).getTime();

  if (age <= ONLINE_WINDOW_MS) return 'online';
  if (age <= RECENT_WINDOW_MS) return 'recent';

  return 'offline';
}

/** Whether this position was written within one tracking interval. */
export function isRecentlySynced(
  location: MemberLocation | null | undefined,
  now = Date.now(),
): boolean {
  if (!location) return false;

  return now - new Date(location.updatedAt).getTime() <= SYNCED_WINDOW_MS;
}

/** "now" · "12 min ago" · "3 h ago" · "4 days ago". */
export function relativeTime(i18n: Translator, iso: string, now = Date.now()): string {
  const age = now - new Date(iso).getTime();

  if (!Number.isFinite(age)) return '';
  // A server clock a few seconds ahead should not read as "in the future".
  if (age < MINUTE_MS) return i18n.t('time.now');
  if (age < HOUR_MS) return i18n.t('time.minutesAgo', { count: Math.floor(age / MINUTE_MS) });
  if (age < DAY_MS) return i18n.t('time.hoursAgo', { count: Math.floor(age / HOUR_MS) });

  const days = Math.floor(age / DAY_MS);

  return days === 1 ? i18n.t('time.yesterday') : i18n.t('time.daysAgo', { count: days });
}

/** "18:42", in the viewer's language but always 24-hour to match the design. */
export function clockTime(i18n: Translator, iso: string): string {
  return new Date(iso).toLocaleTimeString(i18n.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Calendar day as a stable key, so grouping does not depend on the label. */
export function dayKey(iso: string): string {
  const date = new Date(iso);

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** "Today" · "Yesterday" · "4 August 2026". */
export function dayLabel(i18n: Translator, iso: string, now = new Date()): string {
  const key = dayKey(iso);

  if (key === dayKey(now.toISOString())) return i18n.t('time.today');

  const yesterday = new Date(now.getTime() - DAY_MS);

  if (key === dayKey(yesterday.toISOString())) return i18n.t('time.yesterdayLabel');

  return new Date(iso).toLocaleDateString(i18n.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Deadline copy for a task. `expires_at` is the only time a task carries, and
 * the retention sweep marks anything past it as expired.
 */
export function dueLabel(i18n: Translator, iso: string, now = Date.now()): string {
  const remaining = new Date(iso).getTime() - now;

  if (!Number.isFinite(remaining)) return '';
  if (remaining <= 0) return i18n.t('due.expired');

  if (remaining < HOUR_MS) {
    return i18n.t('due.inMinutes', { count: Math.max(1, Math.floor(remaining / MINUTE_MS)) });
  }

  if (remaining < DAY_MS) return i18n.t('due.today', { time: clockTime(i18n, iso) });

  const days = Math.floor(remaining / DAY_MS);

  return days === 1
    ? i18n.t('due.tomorrow', { time: clockTime(i18n, iso) })
    : i18n.t('due.inDays', { count: days });
}

/**
 * True once a task's deadline has passed. Its status can still be `pending` —
 * `expired` is set by the nightly sweep, not by the clock.
 */
export function isOverdue(iso: string, now = Date.now()): boolean {
  return new Date(iso).getTime() <= now;
}

/** True when a task falls due before midnight tonight. */
export function isDueToday(iso: string, now = new Date()): boolean {
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const due = new Date(iso).getTime();

  return due >= now.getTime() && due <= endOfDay.getTime();
}

/**
 * "3 September 2026" — a calendar date with no relative shorthand.
 *
 * `dayLabel` says "Today" where it can, which is right above a run of chat
 * messages and wrong for a renewal date: a subscription that says it runs until
 * "Today" reads as expiring rather than as having a date. This is the plain
 * form, for the paywall.
 */
export function fullDate(i18n: Translator, iso: string): string {
  return new Date(iso).toLocaleDateString(i18n.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "March 2026" for the Profile stat row. */
export function monthYear(i18n: Translator, iso: string): string {
  return new Date(iso).toLocaleDateString(i18n.locale, { month: 'long', year: 'numeric' });
}

/**
 * The label for a self-declared `profiles.role`. A derivation like the rest of
 * this file rather than a table in each screen that shows one — Profile, Edit
 * profile, Add family and the member roster all need the same three words.
 */
export function roleLabel(i18n: Translator, role: FamilyRole): string {
  if (role === 'parent') return i18n.t('role.parent');
  if (role === 'child') return i18n.t('role.child');

  return i18n.t('role.guardian');
}

/** Human-readable label per presence, shown on the map drawer's peeking summary. */
export function presenceLabel(i18n: Translator, presence: MemberPresence): string {
  if (presence === 'online') return i18n.t('presence.live');
  if (presence === 'recent') return i18n.t('presence.recent');

  return i18n.t('presence.stale');
}
