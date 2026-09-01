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

import type { Family, SavedPlace } from '@/data/types';

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
