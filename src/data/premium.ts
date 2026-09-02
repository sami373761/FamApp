/**
 * FamApp Gold, as a derivation.
 *
 * The tier is two columns on `families` — `is_premium` and `premium_until` —
 * and neither is the answer alone: a grant can have lapsed, and one with no end
 * date never does. So "is this family on Gold" is a fold over the pair, and it
 * lives here rather than being re-asked at each call site, exactly the way
 * `membersAtPlaces` folds positions against places instead of storing a match.
 *
 * `private.is_family_premium()` in `20260825140000_family_premium_tier.sql` is
 * the same rule in SQL, and it is the one that actually enforces anything —
 * this half decides what the UI *says*, that half decides what the database
 * *allows*. They have to agree, which is why each exists exactly once.
 *
 * Pure, like the rest of `data/`: no clock injected because `Date.now()` is the
 * question being asked, and no `Translator` because nothing here produces copy.
 */

import type { Family, FamilyEvent, SavedPlace } from '@/data/types';

/** The two plans the paywall offers, and the only values the RPC accepts. */
export type PremiumPlan = 'annual' | 'monthly';

export const PREMIUM_PLANS: readonly PremiumPlan[] = ['annual', 'monthly'];

export function isPremiumPlan(value: string): value is PremiumPlan {
  return PREMIUM_PLANS.some((candidate) => candidate === value);
}

/**
 * Whether the family holds an unexpired grant.
 *
 * Null — no family, or one still loading — is `false` rather than unknown. A
 * solo user has no family row to carry a subscription, and treating "loading"
 * as Gold would flash benefits the next render takes away.
 */
export function isPremiumActive(family: Family | null | undefined): boolean {
  if (!family?.isPremium) return false;
  if (!family.premiumUntil) return true;

  return new Date(family.premiumUntil).getTime() > Date.now();
}

/**
 * A family that *was* on Gold and no longer is.
 *
 * Worth telling apart from "never subscribed": the paywall says "renew" to one
 * and "start a trial" to the other, and a family sitting above the free ceiling
 * on places got there this way.
 */
export function isPremiumExpired(family: Family | null | undefined): boolean {
  return !!family?.isPremium && !isPremiumActive(family);
}

/**
 * How many saved places a family may hold, by tier.
 *
 * These mirror `private.check_saved_place_limit()`, which is what actually
 * refuses the insert — the numbers are repeated here so the map can dim the
 * button and explain itself *before* someone fills in a form that cannot be
 * saved, not because the client is trusted to enforce them.
 *
 * Family-wide, not per member. `unique (user_id, category)` already caps each
 * member at five categories; a per-member tier ceiling would leave a free
 * family of four holding twenty places, which is not a free tier.
 */
export const FREE_PLACE_LIMIT = 2;
export const GOLD_PLACE_LIMIT = 10;

/**
 * Takes the derived boolean, not the family row.
 *
 * `FamilyContext` already folds the two columns into `isPremium` once per
 * render, and every caller of this has it to hand. Asking for the `Family`
 * again would mean re-deriving the same answer in a second place and letting
 * the two disagree on a screen that has one but not the other.
 */
export function placeLimitFor(isPremium: boolean): number {
  return isPremium ? GOLD_PLACE_LIMIT : FREE_PLACE_LIMIT;
}

/**
 * Is there room for another place in this family?
 *
 * A lapsed grant never deletes rows — the trigger is INSERT-only — so a family
 * can legitimately sit *above* its own ceiling, and `<` is what keeps that
 * reading as "full" rather than going negative anywhere.
 */
export function canSaveAnotherPlace(isPremium: boolean, places: SavedPlace[]): boolean {
  return places.length < placeLimitFor(isPremium);
}

/**
 * How many members a family may hold, by tier.
 *
 * These mirror `private.enforce_family_member_limit()`, which is what actually
 * refuses the join — the numbers are repeated here so a counter can say "3 of
 * 5" rather than promising room the trigger will not give, not because the
 * client is trusted to enforce them. A join is redeemed on the *joiner's*
 * device against a family they cannot see until they are in it, so this half
 * never gets to stop anything; it only explains.
 */
export const FREE_MEMBER_LIMIT = 5;
export const GOLD_MEMBER_LIMIT = 10;

/**
 * The tier's ceiling, narrowed by the family's own.
 *
 * `families.max_members` is the schema's hard bound (`between 1 and 10`) and
 * the trigger takes `least()` of the two, so this takes the same minimum rather
 * than assuming the column is always 10 — a counter that disagreed with the
 * database about the denominator would be worse than no counter.
 *
 * Takes the derived boolean and not the family row, exactly like
 * `placeLimitFor`: `FamilyContext` folds the two premium columns into
 * `isPremium` once per render, and re-deriving it here would let the two
 * disagree on a screen that holds one but not the other.
 */
export function memberLimitFor(isPremium: boolean, hardCap?: number | null): number {
  return Math.min(hardCap ?? GOLD_MEMBER_LIMIT, isPremium ? GOLD_MEMBER_LIMIT : FREE_MEMBER_LIMIT);
}

/**
 * How many shared calendar events a family may hold, by tier.
 *
 * Mirrors `private.check_family_event_limit()`, which is what actually refuses
 * the insert — the numbers are here so the composer can explain the ceiling
 * before somebody fills in a form that cannot be saved, not because the client
 * is trusted to enforce them.
 *
 * Gold is genuinely uncapped, and `Infinity` is how that is said rather than a
 * large number standing in for one. It is the only unbounded tier in the app,
 * and it is the one place the paywall's "no claim may be unlimited" rule does
 * not bite: that rule exists because "unlimited saved places" and "30-day
 * history" were selling something no schema could deliver, whereas here the
 * trigger really does stop counting.
 *
 * **Birthdays are not counted against this.** They have no row — they are
 * folded out of `profiles.birth_date` by `src/data/events.ts` — so a free
 * family sees every birthday it has and is rationed only on the dates somebody
 * typed. That is the same boundary the geofence pushes draw: the fold is free,
 * the thing that only exists because it was entered is what is sold.
 */
export const FREE_EVENT_LIMIT = 1;

export function eventLimitFor(isPremium: boolean): number {
  return isPremium ? Infinity : FREE_EVENT_LIMIT;
}

/**
 * Is there room for another shared event?
 *
 * A lapsed grant never deletes rows — the trigger is INSERT-only — so a family
 * can legitimately sit *above* its own ceiling, and `<` is what keeps that
 * reading as "full" rather than going negative anywhere. The same shape
 * `canSaveAnotherPlace` has, and true for any Gold family because `Infinity`
 * is never reached.
 */
export function canAddAnotherEvent(isPremium: boolean, events: FamilyEvent[]): boolean {
  return events.length < eventLimitFor(isPremium);
}
