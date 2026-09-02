/**
 * The family's next dates, folded out of two row sets.
 *
 * Home's countdown card is a list of *occurrences*, and an occurrence is not a
 * row. Two things feed it:
 *
 *  * **Birthdays**, derived from `profiles.birth_date` on the roster the screen
 *    already holds. There is no birthday row and there must not be one — a
 *    stored copy would go stale the moment somebody corrected their date, and
 *    would double every birthday for a member the roster already carries. This
 *    is the same argument `membersAtPlaces` makes for not storing a visit log.
 *  * **`family_events`**, the dates somebody typed. An annual one rolls to its
 *    next occurrence; a one-off simply passes and stops being counted down to.
 *
 * That split is also where the tier boundary falls, and it is not arbitrary:
 * birthdays are a fold over rows every member can already read, so they stay
 * free for every family, exactly as knowing where the family is stays free.
 * What Gold sells is the shared calendar — the dates that exist only because
 * somebody entered them.
 *
 * Pure, like the rest of `data/`. Nothing here produces copy, so nothing takes
 * a `Translator`: an occurrence carries a `title` that came from a row and a
 * `kind` the caller turns into words. `now` is injectable because "which day is
 * it" is the input this whole file pivots on, and a caller that could not fix it
 * would have nothing it could reason about.
 */

import type { FamilyEvent, FamilyEventType, FamilyMember } from '@/data/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead the Home card looks. Beyond this is a calendar, not a countdown. */
export const EVENT_HORIZON_DAYS = 365;

/** How many occurrences Home shows before the card becomes a list to scroll. */
export const HOME_EVENT_LIMIT = 4;

/**
 * One dated thing, once.
 *
 * `id` is stable across renders but is **not** a row id for a birthday — those
 * have no row, so the member's id is namespaced instead. Nothing looks a
 * birthday up by this; it is a list key.
 */
export type EventOccurrence = {
  id: string;
  /**
   * `birthday` here means a *derived* one, from a member's own date. A
   * `family_events` row whose `event_type` is `'birthday'` is somebody else's
   * birthday entered by hand — a grandparent, say — and stays `event`, because
   * it has a row that can be edited and deleted and it counts against the tier.
   */
  kind: 'birthday' | 'event';
  title: string;
  type: FamilyEventType;
  /** The member whose birthday this is; null for a `family_events` row. */
  memberId: string | null;
  /** `YYYY-MM-DD` of the occurrence being counted down to, not of the stored row. */
  date: string;
  /** Whole days from `now` to that date. 0 is today. */
  daysUntil: number;
  /**
   * How many years old this birthday makes them, or how many years since the
   * stored date for an annual event. Null when the original year is unknown or
   * the event does not recur — an anniversary with no history is just a date.
   */
  turning: number | null;
  /** True for the event's own first occurrence, i.e. a one-off or a first year. */
  isAnnual: boolean;
};

/** Local calendar day as `YYYY-MM-DD`, which is the shape a `date` column returns. */
function toDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Parses `YYYY-MM-DD` into a **local** midnight.
 *
 * `new Date('2026-09-20')` parses as UTC midnight, which is the previous day in
 * every timezone west of Greenwich — so a birthday would read as one day early
 * for half the world. Splitting the parts and handing them to the `Date`
 * constructor is what keeps a calendar date on the calendar.
 *
 * Returns null for anything that is not a real date, so a hand-edited row or a
 * column read from a future migration is dropped rather than rendered as
 * "NaN days".
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());

  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  // Rejects 2026-02-30, which `Date` would silently roll into March.
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }

  return date;
}

/** Midnight local on the day `from` falls in — the fixed point every count is measured from. */
function startOfDay(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate());
}

/**
 * The next time this month-and-day comes round, today included.
 *
 * Today counts as the next occurrence rather than rolling to next year, because
 * a birthday that is *today* is the single most worth saying and a countdown
 * that skipped it would be absurd.
 *
 * **29 February lands on 1 March in a common year.** The alternative is 28
 * February, and both are defensible; this one is what `Date` does on its own
 * when handed month 1 day 29, so it is also the answer that needs no special
 * case to be consistent between the two branches below.
 */
export function nextOccurrence(date: Date, now: Date = new Date()): Date {
  const today = startOfDay(now);
  const thisYear = new Date(today.getFullYear(), date.getMonth(), date.getDate());

  if (thisYear.getTime() >= today.getTime()) return thisYear;

  return new Date(today.getFullYear() + 1, date.getMonth(), date.getDate());
}

/**
 * Whole days from today to `date`. Negative for a date already past.
 *
 * Both sides are floored to local midnight first, so this counts *calendar*
 * days rather than 24-hour spans — "tomorrow" is tomorrow whether it is now
 * 09:00 or 23:50, which is the only reading a countdown can have.
 */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

type UpcomingInput = {
  members: FamilyMember[];
  events: FamilyEvent[];
  now?: Date;
  /** How many to return. Omit for everything inside the horizon. */
  limit?: number;
};

/**
 * Everything the family has coming up, soonest first.
 *
 * The two sources are folded into one list and sorted together, because that is
 * what somebody looking at the card wants to know — not "the next birthday" and
 * "the next event" side by side, but what is next.
 *
 * A one-off that has passed is dropped: it is history, and a countdown to it
 * would be a negative number pretending to be news. An annual one always has a
 * next occurrence, so it never leaves the list — it only goes to the back.
 */
export function upcomingEvents({
  members,
  events,
  now = new Date(),
  limit,
}: UpcomingInput): EventOccurrence[] {
  const occurrences: EventOccurrence[] = [];

  for (const member of members) {
    const born = parseDateOnly(member.birthDate);

    // A member who has not given a date has no occurrence. That is the whole
    // handling: no placeholder row, no "birthday unknown" line.
    if (!born) continue;

    const occurs = nextOccurrence(born, now);
    const until = daysUntil(occurs, now);

    if (until > EVENT_HORIZON_DAYS) continue;

    occurrences.push({
      // Namespaced rather than raw, because there is no row to take an id from
      // and a member id alone could collide with a `family_events` id in the
      // same list. Nothing looks a birthday up by this; it is a list key.
      id: `birthday:${member.id}`,
      kind: 'birthday',
      // The member's own name, resolved by the screen — this layer produces no
      // copy, so it carries the raw name and lets the card say "Mehmet's
      // birthday" in whichever of the ten languages it is being read in.
      title: member.displayName ?? '',
      type: 'birthday',
      memberId: member.id,
      date: toDateKey(occurs),
      daysUntil: until,
      // How old they will be. Null for a date whose year is in the future or
      // the same — neither is a real age, and printing one would be inventing a
      // fact about somebody.
      turning:
        occurs.getFullYear() > born.getFullYear() ? occurs.getFullYear() - born.getFullYear() : null,
      isAnnual: true,
    });
  }

  for (const event of events) {
    const stored = parseDateOnly(event.eventDate);

    if (!stored) continue;

    const occurs = event.isAnnual ? nextOccurrence(stored, now) : stored;
    const until = daysUntil(occurs, now);

    // A one-off that has been and gone is history, not a countdown.
    if (until < 0) continue;
    if (until > EVENT_HORIZON_DAYS) continue;

    occurrences.push({
      id: event.id,
      kind: 'event',
      title: event.title,
      type: event.eventType,
      memberId: null,
      date: toDateKey(occurs),
      daysUntil: until,
      turning:
        event.isAnnual && occurs.getFullYear() > stored.getFullYear()
          ? occurs.getFullYear() - stored.getFullYear()
          : null,
      isAnnual: event.isAnnual,
    });
  }

  occurrences.sort((a, b) => a.daysUntil - b.daysUntil || a.title.localeCompare(b.title));

  return limit === undefined ? occurrences : occurrences.slice(0, limit);
}
