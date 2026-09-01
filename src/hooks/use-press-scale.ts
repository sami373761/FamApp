/**
 * The press response every interactive surface shares: a small dip in scale and
 * opacity while a finger is down, sprung back on release, plus an optional
 * highlight that fades in behind a full-width row.
 *
 * Built on RN's own `Animated`, like `SwipeToComplete` — this project has no
 * animation layer, and adding one for a 30ms transform would be the heavier
 * choice. The values are deliberately small: the point is that a card feels
 * physical under the thumb, not that it visibly moves.
 *
 * The highlight is the second half because a row is not a button. A settings
 * row dipped as far as a CTA reads as the whole list flinching, so a row takes
 * a barely-there dip and lets a fading recess carry the state instead — the
 * same fill it used to switch on and off instantly, now with the 90ms that
 * makes it read as a response rather than a flicker.
 */

import { useCallback, useMemo, useState } from 'react';
import { Animated, Platform } from 'react-native';

import { Motion } from '@/theme';

/** How far a pressed surface dips. Below ~0.95 it reads as a bounce, not a press. */
const PRESSED_SCALE = 0.97;
const PRESSED_OPACITY = 0.9;

export type PressScale = {
  /** Spread into the animated element's style array. */
  style: { transform: [{ scale: Animated.Value }]; opacity: Animated.Value };
  /** 0 → 1 while the finger is down; drive a highlight layer's opacity with it. */
  highlight: Animated.Value;
  press: () => void;
  release: () => void;
};

export function usePressScale(
  pressedScale: number = PRESSED_SCALE,
  /**
   * How far the surface dims. A row that carries a highlight passes 1: the
   * recess fading in behind it is already the answer, and dimming as well
   * would say the same thing twice on one press.
   */
  pressedOpacity: number = PRESSED_OPACITY,
): PressScale {
  // `useState` rather than a ref: all three values are read while rendering.
  const [scale] = useState(() => new Animated.Value(1));
  const [opacity] = useState(() => new Animated.Value(1));
  const [highlight] = useState(() => new Animated.Value(0));

  // RN Web has no native animated module; asking for one only earns a warning.
  const useNativeDriver = Platform.OS !== 'web';

  const settle = useCallback(
    (toScale: number, toOpacity: number, toHighlight: number) => {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: toScale,
          ...Motion.spring.press,
          useNativeDriver,
        }),
        Animated.timing(opacity, {
          toValue: toOpacity,
          duration: Motion.duration.press,
          useNativeDriver,
        }),
        Animated.timing(highlight, {
          toValue: toHighlight,
          duration: Motion.duration.press,
          useNativeDriver,
        }),
      ]).start();
    },
    [highlight, opacity, scale, useNativeDriver],
  );

  return useMemo(
    () => ({
      style: { transform: [{ scale }], opacity },
      highlight,
      press: () => settle(pressedScale, pressedOpacity, 1),
      release: () => settle(1, 1, 0),
    }),
    [highlight, opacity, pressedOpacity, pressedScale, scale, settle],
  );
}
