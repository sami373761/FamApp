/**
 * Device-local settings: appearance, language, notifications, location sharing.
 *
 * None of these have a column. `profiles` carries identity and membership and
 * nothing else, and inventing a settings column to back a switch would be the
 * same mistake as inventing a fixture — so these live in AsyncStorage. That is
 * the right home for them anyway: which colour scheme this phone shows, which
 * language it reads in, and whether it may notify you, are properties of the
 * device rather than of the person. A second device deliberately starts from
 * the defaults.
 *
 * Two of them have a server-side consequence, and neither flag is the whole
 * truth on its own. Turning location sharing off also deletes the caller's
 * `locations` row (`locationService.clearOwnLocation`), because a stale pin
 * left behind would keep showing on everyone else's map. Turning notifications
 * on registers this device and stores its Expo push token on the profile row;
 * turning it off clears the token (`notificationService`). Both switches are
 * reverted by the screen if their write fails — a flag that claims more privacy,
 * or more delivery, than there is would be worse than no flag.
 *
 * Hydration is deliberately *not* gated. Reading one AsyncStorage key finishes
 * well inside the splash `RootNavigator` already shows while the stored session
 * resolves, and withholding children here would render the whole app tree
 * unmountable on the server, where AsyncStorage never resolves at all.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { LANGUAGES } from '@/i18n';
import type { LanguagePreference } from '@/i18n';

/** 'system' follows the OS; the other two override it. */
export type Appearance = 'system' | 'light' | 'dark';

export type Preferences = {
  appearance: Appearance;
  /**
   * Which of the ten languages the app renders in, or `system` to follow the
   * device — the same shape as `appearance`, and stored for the same reason:
   * the phone in your hand has a language, the account does not.
   *
   * Resolved on every read rather than written down as a concrete code, so
   * someone who changes their phone's language is followed without being asked
   * again. See `resolveLanguage` in `src/i18n/languages.ts`.
   */
  language: LanguagePreference;
  /**
   * Whether this device is registered to receive push notifications.
   *
   * Device-local like the rest, and rightly so — a push token belongs to a
   * phone, not to an account. But it is no longer intent alone: flipping it
   * writes or clears `profiles.push_token` through `notificationService`, and
   * the flag is reverted if that fails, so it never claims a registration that
   * does not exist. The same rule `locationSharing` follows below.
   *
   * Nothing *sends* to those tokens yet, so "on" means registered, not
   * notified.
   */
  notifications: boolean;
  locationSharing: boolean;
  /**
   * The id of the user who chose to open the app without a family, or null.
   *
   * An id rather than a boolean because this device outlives the session: a
   * plain flag would carry one account's choice onto the next person to sign
   * in here, skipping family setup for someone who never asked to. Comparing
   * against the live session id makes it self-expiring — signing out or
   * switching accounts restores normal onboarding with nothing to clean up.
   *
   * There is no column for it and none was added: it records a *choice about
   * onboarding*, not a fact about the account. `family_id` remains the only
   * truth about membership, and a second device rightly asks again.
   *
   * `RootNavigator` reads it, so it decides which screens exist — see the
   * `inApp` guard there. Clearing it is what sends someone back to family
   * setup from inside the app.
   */
  familySetupSkippedFor: string | null;
};

export type PreferencesContextValue = {
  preferences: Preferences;
  /** True once the stored values have been read; false on the first frames. */
  isHydrated: boolean;
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
};

export const DEFAULT_PREFERENCES: Preferences = {
  appearance: 'system',
  language: 'system',
  notifications: true,
  locationSharing: true,
  familySetupSkippedFor: null,
};

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);

const STORAGE_KEY = 'famapp.preferences.v1';

const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

/**
 * Derived from `LANGUAGES` rather than written out again, so a language added
 * there is accepted here without a second edit — and one removed stops being
 * accepted, which is what makes an old stored value fall back to `system`.
 */
const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = [
  'system',
  ...LANGUAGES.map((language) => language.code),
];

/**
 * Stored JSON is untrusted input — an older build, a hand-edited value, or a
 * half-written key. Every field falls back to its default independently rather
 * than the whole blob being discarded.
 */
function parsePreferences(raw: string | null): Preferences {
  if (!raw) return DEFAULT_PREFERENCES;

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_PREFERENCES;
  }

  const value = parsed as Record<string, unknown>;
  const appearance = APPEARANCES.find((candidate) => candidate === value.appearance);
  const language = LANGUAGE_PREFERENCES.find((candidate) => candidate === value.language);

  return {
    appearance: appearance ?? DEFAULT_PREFERENCES.appearance,
    language: language ?? DEFAULT_PREFERENCES.language,
    notifications:
      typeof value.notifications === 'boolean'
        ? value.notifications
        : DEFAULT_PREFERENCES.notifications,
    locationSharing:
      typeof value.locationSharing === 'boolean'
        ? value.locationSharing
        : DEFAULT_PREFERENCES.locationSharing,
    familySetupSkippedFor:
      typeof value.familySetupSkippedFor === 'string' && value.familySetupSkippedFor
        ? value.familySetupSkippedFor
        : DEFAULT_PREFERENCES.familySetupSkippedFor,
  };
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Preferences | null>(null);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(STORAGE_KEY)
      // A storage read that fails is a device with no saved choices, not an
      // error worth surfacing — the defaults are a complete answer.
      .catch(() => null)
      .then((raw) => {
        if (active) setStored(parsePreferences(raw));
      });

    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setStored((previous) => ({ ...(previous ?? DEFAULT_PREFERENCES), [key]: value }));
    },
    [],
  );

  // Persisting from an effect rather than from the setter keeps the state
  // updater pure. The write that immediately follows hydration is a no-op
  // rewrite of what was just read.
  useEffect(() => {
    if (!stored) return;

    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored)).catch(() => undefined);
  }, [stored]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences: stored ?? DEFAULT_PREFERENCES,
      isHydrated: !!stored,
      setPreference,
    }),
    [stored, setPreference],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
