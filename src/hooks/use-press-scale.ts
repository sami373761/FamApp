/**
 * The press response every interactive surface shares: a small dip in scale and
 * opacity while a finger is down, sprung back on release.
 *
 * Built on RN's own `Animated`, like `SwipeToComplete` — this project has no
 * animation layer, and adding one for a 30ms transform would be the heavier
 * choice. The values are deliberately small: the point is that a card feels
 * physical under the thumb, not that it visibly moves.
 */

import { useCallback, useMemo, useState } from 'react';
import { Animated, Platform } from 'react-native';

/** How far a pressed surface dips. Below ~0.95 it reads as a bounce, not a press. */
const PRESSED_SCALE = 0.97;
const PRESSED_OPACITY = 0.9;

export type PressScale = {
  /** Spread into the animated element's style array. */
  style: { transform: [{ scale: Animated.Value }]; opacity: Animated.Value };
  press: () => void;
  release: () => void;
};

export function usePressScale(pressedScale: number = PRESSED_SCALE): PressScale {
  // `useState` rather than a ref: both values are read while rendering the style.
  const [scale] = useState(() => new Animated.Value(1));
  const [opacity] = useState(() => new Animated.Value(1));

  // RN Web has no native animated module; asking for one only earns a warning.
  const useNativeDriver = Platform.OS !== 'web';

  const settle = useCallback(
    (toScale: number, toOpacity: number) => {
      Animated.parallel([
        // No bounciness: a button that wobbles back reads as a toy.
        Animated.spring(scale, { toValue: toScale, speed: 45, bounciness: 0, useNativeDriver }),
        Animated.timing(opacity, { toValue: toOpacity, duration: 90, useNativeDriver }),
      ]).start();
    },
    [opacity, scale, useNativeDriver],
  );

  return useMemo(
    () => ({
      style: { transform: [{ scale }], opacity },
      press: () => settle(pressedScale, PRESSED_OPACITY),
      release: () => settle(1, 1),
    }),
    [opacity, pressedScale, scale, settle],
  );
}
