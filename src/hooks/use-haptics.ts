/**
 * The app's haptic vocabulary.
 * https://docs.expo.dev/versions/v57.0.0/sdk/haptics/
 *
 * Six named effects rather than raw `expo-haptics` calls at every site, for the
 * same reason colours are tokens: the *meaning* is what a component should pick
 * ("this completed something"), not the taptic engine's pattern. Swapping what
 * `success` feels like is then one edit here.
 *
 * `useHaptics()` returns a module-level function, so its identity is stable and
 * it is safe in a dependency array. It is a hook rather than a bare import so
 * call sites read like `useTheme()` alongside it, and so a future "reduce
 * feedback" preference has one seam to hang off.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticFeedback =
  /** A light action: a row, a chip, a secondary button. */
  | 'tap'
  /** A weightier one: a filled CTA, the FAB. */
  | 'press'
  /** Moving between choices in a set — segments, filters. */
  | 'select'
  /** Something finished: a task ticked off. */
  | 'success'
  /** A destructive action being confirmed. */
  | 'warning'
  /** A write came back refused. */
  | 'error';

const EFFECT: Record<HapticFeedback, () => Promise<void>> = {
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  press: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  select: () => Haptics.selectionAsync(),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

/**
 * Only iOS and Android have a taptic engine to drive. The web build resolves
 * `expo-haptics` to a shim that would ask for `navigator.vibrate` — a no-op on
 * every desktop browser and an unwanted buzz on a phone one — so the platform
 * check is here rather than left to the shim.
 */
const isSupported = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * Feedback is decoration: a device that refuses (a simulator, a phone with
 * system haptics switched off) must never turn a working button into a crash,
 * so the promise is fired and forgotten.
 */
function fire(effect: HapticFeedback): void {
  if (!isSupported) return;

  EFFECT[effect]().catch(() => {});
}

export type HapticFire = (effect: HapticFeedback) => void;

export function useHaptics(): HapticFire {
  return fire;
}
