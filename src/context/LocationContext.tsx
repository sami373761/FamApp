/**
 * Keeping your own pin current without keeping the GPS on.
 *
 * `locations` holds one row per member and no history, so "tracking" here is
 * not a stream — it is a fix taken on a slow cadence and written only when it
 * says something new. Three rules do the work:
 *
 * 1. **Cadence.** A fix every twelve minutes, plus one whenever the app comes
 *    back to the foreground. Nothing is read while the app is backgrounded;
 *    only foreground permission is ever requested.
 * 2. **Distance.** A fix closer than 100 m to the last one *written* is
 *    dropped. A phone on a desk drifts a few metres between fixes, and writing
 *    that would spend a round trip to say nothing — the row's `updated_at`
 *    would move, but the position on everyone's map would not. The manual
 *    "Locate me" on the Map screen forces the write past this rule, which is
 *    the only thing `force` means.
 * 3. **Heartbeat.** Rule 2 has a cost: a member who stays put stops writing,
 *    so their `updated_at` ages and their pin reads as stale even though they
 *    are sharing normally. Once the stored position is two hours old the next
 *    fix is written whatever the distance, which restamps the row. At most one
 *    such write every two hours, so the battery rule survives it.
 *
 * **The charge level rides along with a write and never causes one.** A phone
 * dropping a percent is not news worth a round trip, and a tracker that
 * reported every change would spend the battery it is reporting on. So the
 * number every other member sees is exactly as old as the position under it —
 * which is why the badge is rendered only while that position still reads as
 * live, and why `batterySharing` is read through a ref rather than as a
 * dependency of the cadence.
 *
 * The baseline lives in a ref, not in storage: it is the position this *process*
 * last wrote and when the server stamped it, and after a restart the first fix
 * should write unconditionally rather than trust a number that may be hours old.
 * Its age is measured from `updated_at` rather than from the local clock,
 * because that is the value presence is derived from — this rule exists to keep
 * *that* number young.
 *
 * This provider decides *when*; `locationService` owns both the sensor and the
 * table, and `FamilyContext` owns the roster the new position lands in. Nothing
 * is committed to that roster that was not stored first.
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { getDistanceInMeters, type Coordinates } from '@/data/geo';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { usePreferences } from '@/hooks/usePreferences';
import { useTranslation } from '@/hooks/use-translation';
import {
  getDeviceBattery,
  getDevicePosition,
  updateOwnLocation,
  NO_BATTERY,
} from '@/services/locationService';
import { errorText } from '@/services/result';

/** How often a foreground app takes a fix. */
export const SYNC_INTERVAL_MS = 12 * 60 * 1000;

/** Movement below this is not worth a write. See the note above. */
export const MIN_SYNC_DISTANCE_METERS = 100;

/**
 * A stored position older than this is rewritten even if nothing has moved, so
 * that standing still does not read the same as having stopped sharing.
 */
export const HEARTBEAT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** The position last written, and the server time it was stamped with. */
type WrittenPosition = { coordinates: Coordinates; at: number };

export type LocationContextValue = {
  /** True while a fix or a write is in flight — background ticks included. */
  isSyncing: boolean;
  /** Safe to render. Null when the last attempt got as far as it could. */
  error: string | null;
  /** The device refused. Retrying will not help until system settings change. */
  isPermissionDenied: boolean;
  /**
   * Whether a sync can happen at all: sharing switched on, and a family to
   * write to. `locations.family_id` is `not null` and both RLS policies check
   * it, so a solo user has nowhere to put a position — the fix is skipped
   * rather than taken and discarded.
   */
  canShare: boolean;
  /** "Locate me": takes a fix and writes it whatever the distance. */
  syncNow: () => Promise<void>;
};

export const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { preferences } = usePreferences();
  const { setOwnLocation } = useFamily();
  const i18n = useTranslation();

  const familyId = profile?.family_id ?? null;
  const canShare = preferences.locationSharing && !!familyId;
  /**
   * Read through a ref rather than taken as a dependency of `sync`.
   *
   * The switch is a *property of the next write*, not of the schedule: if it
   * were in the dependency array, flipping it would rebuild `sync`, and the
   * effect below would tear down the twelve-minute timer and start a fresh one
   * — restarting the cadence, and firing an immediate fix, because somebody
   * changed their mind about a badge. Profile already clears what is stored the
   * moment the switch moves (`clearOwnBattery`), so nothing is waiting on this.
   */
  const shareBattery = useRef(preferences.batterySharing);

  // In an effect, not during render: a ref written mid-render is what React
  // Compiler refuses, and every reader of this one is a timer or a callback
  // that cannot run before the commit.
  useEffect(() => {
    shareBattery.current = preferences.batterySharing;
  }, [preferences.batterySharing]);

  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);

  /** The last position actually stored — the baseline for both distance and age. */
  const lastWritten = useRef<WrittenPosition | null>(null);
  /** A twelve-minute tick landing on top of a "Locate me" press must not double-write. */
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const sync = useCallback(
    async (force: boolean) => {
      if (!canShare || !familyId || inFlight.current) return;

      inFlight.current = true;
      setIsSyncing(true);

      try {
        const position = await getDevicePosition();

        if (!mounted.current) return;

        if (position.error) {
          // A refusal is worth remembering: it is the one failure the user can
          // do something about, and the Map screen says so instead of offering
          // a retry that cannot succeed.
          setIsPermissionDenied(position.error.code === 'PERMISSION_DENIED');
          setError(errorText(i18n, position.error));

          return;
        }

        setIsPermissionDenied(false);

        const previous = lastWritten.current;
        const moved = previous
          ? getDistanceInMeters(previous.coordinates, position.data)
          : Infinity;
        // A stored position this old is due a restamp whether or not the phone
        // has been anywhere — see rule 3. With no baseline both measures read
        // as "write it", which is what a fresh process should do.
        const age = previous ? Date.now() - previous.at : Infinity;

        // Nothing written, nothing failed: this is the tracker working, not an
        // error, so any earlier message is cleared on the way out.
        if (!force && moved < MIN_SYNC_DISTANCE_METERS && age < HEARTBEAT_MAX_AGE_MS) {
          setError(null);

          return;
        }

        // Read only once the write is going ahead. Taking it beside the fix
        // would spend a native call on every tick, most of which decide not to
        // write at all — and a reading taken then discarded is one that would
        // have been a few minutes stale by the time it mattered.
        const battery = shareBattery.current ? await getDeviceBattery() : NO_BATTERY;

        if (!mounted.current) return;

        const { data: stored, error: writeError } = await updateOwnLocation(
          familyId,
          position.data,
          battery,
        );

        if (!mounted.current) return;

        if (writeError) {
          setError(errorText(i18n, writeError));

          return;
        }

        // Only now is the baseline moved — a failed write must not make the
        // next fix look like it has not travelled far enough to bother, nor
        // reset the heartbeat clock on a row that was never restamped. The
        // stored `updated_at` is used rather than the local clock because that
        // is the timestamp the age is really about.
        lastWritten.current = {
          coordinates: position.data,
          at: new Date(stored.updatedAt).getTime(),
        };
        setError(null);
        setOwnLocation(stored);
      } finally {
        inFlight.current = false;

        if (mounted.current) setIsSyncing(false);
      }
    },
    // `i18n` is a dependency because the stored error is a *sentence*: without
    // it a failure would stay in the language it first happened in, and the
    // effect below would keep the stale timer besides.
    [canShare, familyId, i18n, setOwnLocation],
  );

  useEffect(() => {
    if (!canShare) return;

    // Sharing has just become possible — switched on, or a family arrived — so
    // the first fix goes in immediately rather than twelve minutes from now.
    void sync(false);

    const interval = setInterval(() => void sync(false), SYNC_INTERVAL_MS);

    // Coming back to the foreground is when a position is most likely to be
    // stale: the interval does not fire while the app is suspended.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync(false);
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
      // Sharing stopped, or the family changed. Either way the row this
      // baseline described is gone (Profile deletes it when the switch goes
      // off), so keeping the number would let a phone that has not moved skip
      // the write that puts its pin back.
      lastWritten.current = null;
    };
  }, [canShare, sync]);

  const syncNow = useCallback(() => sync(true), [sync]);

  const value = useMemo<LocationContextValue>(
    () => ({ isSyncing, error, isPermissionDenied, canShare, syncNow }),
    [isSyncing, error, isPermissionDenied, canShare, syncNow],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}
