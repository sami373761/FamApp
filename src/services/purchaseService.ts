/**
 * Buying FamApp Gold.
 *
 * **There is still no store.** No StoreKit, no Google Play Billing, no
 * RevenueCat, no receipt and no webhook — nothing here charges anybody, and
 * `set_family_premium()` grants the tier to whoever asks. What changed is where
 * the answer lives: the paywall used to confirm against a `setTimeout` and
 * forget, and it now writes a row the rest of the app reads. That makes the
 * *plumbing* real — a family that subscribes stays subscribed across a reload,
 * on every member's device, and the saved-place ceiling actually moves — while
 * the payment itself remains the mock it has always been.
 *
 * Saying that out loud is the point of this comment. The one rule this codebase
 * keeps everywhere else is that nothing is rendered the schema cannot supply;
 * the paywall is its single sanctioned exception, and the exception is allowed
 * to widen only as far as "an offer is not a fact about this family". A receipt
 * would be such a fact. When one exists, it is verified inside
 * `set_family_premium()` — server-side, where the client cannot skip it — and
 * `purchasePlan` below becomes the thing that hands the store's token over
 * rather than the thing that decides.
 *
 * The service shape is the ordinary one: never throws, returns a
 * `ServiceResult`, and names a catalog key rather than a sentence.
 */

import type { PostgrestError } from '@supabase/supabase-js';

import { isPremiumActive, type PremiumPlan } from '@/data/premium';
import type { Family } from '@/data/types';
import { toFamily } from '@/services/familyService';
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

export type PurchaseErrorCode =
  | CommonErrorCode
  /** No `family_id` on the profile — there is nothing to attach a plan to. */
  | 'NO_FAMILY'
  /** The RPC does not recognise the plan, or the family row has gone. */
  | 'INVALID_PLAN'
  | 'NOT_FOUND'
  /**
   * `set_family_premium` is not on the project — the tier migration has not
   * been pushed. Worth its own code for the same reason `deleteAccount` gives
   * `DELETE_UNAVAILABLE` one: a missing RPC should say the backend is behind
   * the app, not report itself as an unexplained failure.
   */
  | 'UNAVAILABLE'
  /** Nothing to restore: this family has never held a grant. */
  | 'NOTHING_TO_RESTORE';

export type PurchaseServiceError = ServiceError<PurchaseErrorCode>;
export type PurchaseResult<T> = ServiceResult<T, PurchaseErrorCode>;

/**
 * What the app knows about a family's subscription, in one object.
 *
 * `isActive` is the fold the UI branches on, and the family row is carried with
 * it so a caller does not have to ask twice — `FamilyContext` commits it, and
 * the paywall shows the date underneath the badge.
 */
export type SubscriptionStatus = {
  family: Family;
  /** An unexpired grant. See `isPremiumActive` — this is that, precomputed. */
  isActive: boolean;
  /** Held a grant once, and it has run out. */
  isExpired: boolean;
  /** When it lapses, or null when no end date was recorded. */
  expiresAt: string | null;
};

function statusOf(family: Family): SubscriptionStatus {
  const isActive = isPremiumActive(family);

  return {
    family,
    isActive,
    isExpired: family.isPremium && !isActive,
    expiresAt: family.premiumUntil,
  };
}

function toServiceError(error: PostgrestError): PurchaseServiceError {
  const message = error.message ?? '';
  const cause = error;

  switch (error.code) {
    case '28000':
      return errorFrom('NOT_AUTHENTICATED', 'errors.notAuthenticated', cause);

    case 'P0001':
      // Both are `raise exception` sentences from `set_family_premium`, told
      // apart by their text the same way `familyService` tells its three apart.
      if (/need a family/i.test(message)) {
        return errorFrom('NO_FAMILY', 'errors.premium.noFamily', cause);
      }
      if (/unknown plan/i.test(message)) {
        return errorFrom('INVALID_PLAN', 'errors.premium.invalidPlan', cause);
      }

      return errorFrom('UNKNOWN', 'errors.premium.failed', cause);

    case '42501':
      // The guard trigger's own refusal, which should be unreachable from here:
      // this service only ever writes through the RPC, and the RPC is what the
      // guard lets past. Reaching it means somebody added a direct update.
      return errorFrom('UNKNOWN', 'errors.premium.failed', cause);

    // `.single()` matched no row — the family was deleted, or RLS hides it.
    case 'PGRST116':
      return errorFrom('NOT_FOUND', 'errors.family.notFound', cause);

    // PostgREST's "no such function": the project is missing
    // 20260825140000_family_premium_tier.sql.
    case 'PGRST202':
      return errorFrom('UNAVAILABLE', 'errors.premium.unavailable', cause);

    default:
      return errorFrom('UNKNOWN', 'errors.premium.failed', cause);
  }
}

/**
 * Subscribes the caller's family to a plan.
 *
 * One round trip, and the write is the server's: `set_family_premium` decides
 * the window (a 7-day trial for annual, one month for monthly), extends an
 * existing grant rather than replacing it, and returns the updated row. Doing
 * the arithmetic here instead would put the expiry on the device clock, which
 * is the one clock a subscription must not trust.
 *
 * The plan is typed rather than validated: `PremiumPlan` is the same closed set
 * the RPC's `case` accepts, so an unrecognised value is a compile error on this
 * side and `INVALID_PLAN` on the other.
 */
export async function purchasePlan(plan: PremiumPlan): Promise<PurchaseResult<SubscriptionStatus>> {
  return guarded(async () => {
    const { data, error } = await supabase.rpc('set_family_premium', { p_plan: plan });

    if (error) return { data: null, error: toServiceError(error) };
    if (!data) return fail('UNKNOWN', 'errors.premium.failed');

    return ok(statusOf(toFamily(data)));
  });
}

/**
 * Re-reads the grant this family already holds.
 *
 * With a real store this is where the platform is asked to replay the account's
 * purchases. There is none, so the honest version is the half that will survive
 * that change anyway: the tier lives on the family row, not on the device, so
 * anything already bought is *already* restored on every member's device the
 * moment the row loads. What this adds is the reading — and a definite answer
 * when there is nothing there, because a "Restore" button that silently does
 * nothing is worse than one that says so.
 */
export async function restorePurchases(): Promise<PurchaseResult<SubscriptionStatus>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('family_id')
      .eq('id', auth.user.id)
      .single();

    if (profileError) return { data: null, error: toServiceError(profileError) };
    if (!profile?.family_id) return fail('NO_FAMILY', 'errors.premium.noFamily');

    const status = await getSubscriptionStatus(profile.family_id);

    if (status.error) return status;

    // `is_premium` false has never been a grant, so there is nothing to bring
    // back — distinct from an expired one, which is a real purchase to renew.
    if (!status.data.family.isPremium) {
      return fail('NOTHING_TO_RESTORE', 'errors.premium.nothingToRestore');
    }

    return status;
  });
}

/**
 * The family's current subscription, straight from its row.
 *
 * A plain select rather than an RPC: `families: members read own family` already
 * scopes it, so a member can read their own family's tier and nobody else's,
 * and expiry is folded here rather than asked of the server — the columns are
 * the whole of the state, and `isPremiumActive` is the same rule
 * `private.is_family_premium()` applies.
 */
export async function getSubscriptionStatus(
  familyId: string,
): Promise<PurchaseResult<SubscriptionStatus>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('families')
      .select('*')
      .eq('id', familyId)
      .single();

    if (error) return { data: null, error: toServiceError(error) };
    if (!data) return fail('NOT_FOUND', 'errors.family.notFound');

    return ok(statusOf(toFamily(data)));
  });
}
