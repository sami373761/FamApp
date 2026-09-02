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
 *
 * `getDeviceBattery` is the second sensor read, and it lives here for the same
 * boundary reason: the charge level is written as two columns *of the position
 * row*, in the same tick, and it has the same lifetime. It is the only place
 * `expo-battery` is imported — the one-wrapper-per-dependency rule the rest of
 * the app follows for haptics, maps and the image picker.
 */

import * as Battery from 'expo-battery';
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
 * What this device can say about its own charge, and both halves are nullable
 * because "I cannot tell you" and "I will not tell you" reach the column as the
 * same NULL — see `locations.battery_level`.
 */
export type BatteryReading = {
  /** 0-100, or null when the device has no battery API or reports nothing. */
  level: number | null;
  /** Null rather than false when the state is unknown: see `getDeviceBattery`. */
  isCharging: boolean | null;
};

/** The reading a device with nothing to report produces, and the one a refusal writes. */
export const NO_BATTERY: BatteryReading = { level: null, isCharging: null };

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

/**
 * What the device knows about its own power, or nulls.
 *
 * **Never fails**, which is why it is not a `ServiceResult`: every way of not
 * knowing is the same answer here. The web target has no `expo-battery`
 * implementation, a simulator reports an "unknown" of -1, and a throw from the
 * native module is a device that cannot tell us — all three are "not sharing a
 * number", which is exactly what NULL already means in the column.
 *
 * The level is rounded to a whole percent on the way out because that is what
 * the column stores and what the badge renders; keeping the fraction would only
 * be precision nothing displays.
 */
export async function getDeviceBattery(): Promise<BatteryReading> {
  try {
    if (!(await Battery.isAvailableAsync())) return NO_BATTERY;

    const [level, state] = await Promise.all([
      Battery.getBatteryLevelAsync(),
      Battery.getBatteryStateAsync(),
    ]);

    // -1 is expo-battery's "I do not know", and a simulator returns it.
    if (!Number.isFinite(level) || level < 0) return NO_BATTERY;

    return {
      level: Math.max(0, Math.min(100, Math.round(level * 100))),
      // FULL is plugged in and done charging, which is still "on the mains" as
      // far as anybody reading the badge is concerned. UNKNOWN stays null
      // rather than being flattened to false, so the badge shows a percentage
      // with no bolt instead of claiming the phone is running on battery.
      isCharging:
        state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL
          ? true
          : state === Battery.BatteryState.UNPLUGGED
            ? false
            : null,
    };
  } catch {
    return NO_BATTERY;
  }
}

export function toMemberLocation(row: LocationRow): MemberLocation {
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    updatedAt: row.updated_at,
    batteryLevel: row.battery_level,
    isCharging: row.battery_charging,
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
 *
 * `battery` defaults to nothing rather than to a reading taken here, because
 * *whether* to share one is a device preference this file has no business
 * knowing — `LocationProvider` reads the switch and hands down either a real
 * reading or `NO_BATTERY`.
 */
export async function updateOwnLocation(
  familyId: string,
  coordinates: Coordinates,
  battery: BatteryReading = NO_BATTERY,
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
          // Always sent, never omitted. This is an upsert onto one row per
          // member, so leaving the columns out would keep whatever charge was
          // there last — a reading from before somebody switched sharing off,
          // sitting beside a position from after. Writing the nulls *is* how
          // the refusal reaches the table.
          battery_level: battery.level,
          battery_charging: battery.isCharging,
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
 * Stops sharing a charge level, without stopping sharing a position.
 *
 * An UPDATE rather than a delete, which is the whole difference between this
 * and `clearOwnLocation` below: the row is still the member's position and
 * everybody's map should keep it. Only the two battery columns go, and they go
 * to NULL because NULL is what "not sharing" already means in that column.
 *
 * It exists so the switch is immediate. The next fix would blank them anyway —
 * `updateOwnLocation` always sends both columns — but that is up to twelve
 * minutes away, and on a phone that has stopped moving it may be two hours. A
 * privacy switch that takes effect eventually is not one.
 *
 * Returns the stored row so the caller can commit it, exactly as the write
 * above does: the map is already rendering this position and only the badge on
 * it has to change. A caller with no row (never shared, or sharing switched
 * off) matches nothing, which is not a failure — there was nothing to clear.
 */
export async function clearOwnBattery(): Promise<LocationResult<MemberLocation | null>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('locations')
      .update({ battery_level: null, battery_charging: null })
      .eq('user_id', auth.user.id)
      .select()
      .maybeSingle();

    if (error) {
      return fail(
        /permission denied|violates row-level security/i.test(error.message ?? '')
          ? 'NOT_AUTHENTICATED'
          : 'UNKNOWN',
        'errors.location.batteryClearFailed',
        error,
      );
    }

    // No row is the honest success: somebody who is not sharing a position has
    // no battery reading stored to take back.
    return ok(data ? toMemberLocation(data) : null);
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
