/**
 * Where everyone is.
 *
 * `locations` holds exactly one row per member (the primary key is `user_id`),
 * server-stamped by the `locations_touch_updated_at` trigger — there is no
 * history, only a last-known position. A member with no row is simply not
 * sharing, which the UI renders as an empty state rather than a default pin.
 *
 * This file owns both ends of a position: `getDevicePosition` reads the sensor
 * (the one non-network boundary in `services/`, kept here because everything
 * else about a position already lives in this file) and the rest read and write
 * the table. Deciding *when* to take a fix is `LocationProvider`'s job, not
 * this file's — nothing here schedules anything.
 */

import * as Location from 'expo-location';

import type { Database } from '@/data/database.types';
import type { Coordinates } from '@/data/geo';
import type { MemberLocation } from '@/data/types';
import {
  fail,
  guarded,
  ok,
  type CommonErrorCode,
  type ServiceError,
  type ServiceResult,
} from '@/services/result';
import { supabase } from '@/services/supabase';

type LocationRow = Database['public']['Tables']['locations']['Row'];

/**
 * Deliberately no codes of its own — every failure here is a read failure, and
 * keeping the union to `CommonErrorCode` is what lets `familyService` fold this
 * result into its own without widening.
 */
export type LocationErrorCode = CommonErrorCode;
export type LocationServiceError = ServiceError<LocationErrorCode>;
export type LocationResult<T> = ServiceResult<T, LocationErrorCode>;

/**
 * Reading the sensor fails in ways a table read cannot, and the caller has to
 * tell them apart: a refusal is permanent until the user changes it in system
 * settings, whereas a failed fix is worth retrying on the next tick. Kept off
 * `LocationErrorCode` deliberately — that union stays `CommonErrorCode` so
 * `familyService` can fold `listLocations` into its own result without widening.
 */
export type PositionErrorCode = 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | CommonErrorCode;
export type PositionResult<T> = ServiceResult<T, PositionErrorCode>;

/**
 * ~10 m rather than the ~100 m default: the tracker's write threshold is 100 m,
 * and a fix whose own error is that large would cross it on jitter alone and
 * write a row for a phone that never moved. A single fix every twelve minutes
 * costs little either way — the cadence is what saves the battery, not the
 * accuracy setting.
 */
const FIX_ACCURACY = Location.Accuracy.High;

/**
 * One position from the device, or the reason there isn't one.
 *
 * Permission is requested rather than assumed: the first call is what shows the
 * system prompt, and `requestForegroundPermissionsAsync` resolves immediately
 * with the stored answer on every call after that. Background permission is not
 * asked for — the app only reads a position while someone is using it.
 */
export async function getDevicePosition(): Promise<PositionResult<Coordinates>> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (!permission.granted) {
      return fail(
        'PERMISSION_DENIED',
        permission.canAskAgain
          ? 'errors.location.permissionNeeded'
          : 'errors.location.permissionDenied',
      );
    }

    const position = await Location.getCurrentPositionAsync({ accuracy: FIX_ACCURACY });

    return ok({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });
  } catch (cause) {
    // Services never throw: a disabled location service, a timed-out fix and an
    // insecure browser context all arrive here, and all mean the same thing to
    // the caller — no position this time, try again on the next tick.
    return fail('POSITION_UNAVAILABLE', 'errors.location.unavailable', cause);
  }
}

export function toMemberLocation(row: LocationRow): MemberLocation {
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    updatedAt: row.updated_at,
  };
}

/** Keyed by member id, because every caller looks positions up per member. */
export async function listLocations(
  familyId: string,
): Promise<LocationResult<Map<string, MemberLocation>>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('family_id', familyId);

    // RLS already scopes this to the caller's family; a failure here is a
    // genuine read failure, so it is reported rather than swallowed as "empty".
    if (error) {
      return fail(
        /permission denied/i.test(error.message ?? '') ? 'NOT_AUTHENTICATED' : 'UNKNOWN',
        'errors.location.loadFailed',
        error,
      );
    }

    return ok(new Map(data.map((row) => [row.user_id, toMemberLocation(row)])));
  });
}

/**
 * Stores the caller's latest position.
 *
 * An upsert, because `locations` is keyed on `user_id` and holds no history —
 * one row per member, overwritten. `updated_at` is not sent: the
 * `locations_touch_updated_at` trigger stamps it with server time, which is
 * what makes presence comparable across devices with drifting clocks. The
 * stored row is read back for exactly that reason.
 *
 * `familyId` is passed in rather than looked up because both RLS policies check
 * it against `private.current_family_id()`; a caller with no family cannot
 * write here at all, which is why the tracker skips the write entirely instead
 * of collecting a fix to throw away.
 */
export async function updateOwnLocation(
  familyId: string,
  coordinates: Coordinates,
): Promise<LocationResult<MemberLocation>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('locations')
      .upsert(
        {
          user_id: auth.user.id,
          family_id: familyId,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        },
        { onConflict: 'user_id' },
      )
      .select()
      .single();

    if (error) {
      return fail(
        /permission denied|violates row-level security/i.test(error.message ?? '')
          ? 'NOT_AUTHENTICATED'
          : 'UNKNOWN',
        'errors.location.shareFailed',
        error,
      );
    }

    return ok(toMemberLocation(data));
  });
}

/**
 * Stops sharing a position.
 *
 * The row is deleted rather than blanked, because there is no "sharing off"
 * column — a member with no row simply is not sharing, which is the state the
 * map already renders. Leaving the row behind would keep the last known pin on
 * everyone else's map for as long as the account exists. `locations: delete
 * own` is the policy that permits this.
 */
export async function clearOwnLocation(): Promise<LocationResult<null>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { error } = await supabase.from('locations').delete().eq('user_id', auth.user.id);

    if (error) {
      return fail(
        /permission denied/i.test(error.message ?? '') ? 'NOT_AUTHENTICATED' : 'UNKNOWN',
        'errors.location.clearFailed',
        error,
      );
    }

    return ok(null);
  });
}
