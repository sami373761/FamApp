import type { ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useHaptics, type HapticFeedback } from '@/hooks/use-haptics';
import { usePressScale } from '@/hooks/use-press-scale';

/**
 * Animating the `Pressable` itself, rather than wrapping it in an
 * `Animated.View`, is what keeps `style` meaning exactly what it means on a
 * plain `Pressable`: callers pass layout (`flex: 1`, margins) and it still lands
 * on the element that lays out. The cost is that `style` cannot be the
 * function-of-`pressed` form — `Animated` has no way to look inside a function
 * for its nodes — which is fine, because the pressed look is now the animation.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The dip a full-width row takes: present to the thumb, invisible to the eye. */
const ROW_SCALE = 0.99;

type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  /** Plain styles only — no `({ pressed }) => …`; see the note above. */
  style?: StyleProp<ViewStyle>;
  /** Override the dip for an unusually large or small surface. */
  scaleTo?: number;
  /** What this press should feel like. `'none'` for a surface pressed in bulk. */
  feedback?: HapticFeedback | 'none';
  /**
   * Fades a recess in behind the content while the finger is down — the row
   * treatment. Supplying it also softens the dip and drops the dimming, so a
   * settings row answers with the fill it always used rather than flinching
   * like a button. Pass `colors.surfaceMuted`; anything raised is the wrong
   * direction on a white canvas.
   */
  highlightColor?: string;
  /** Rounds the highlight to match the row's own corners. */
  highlightRadius?: number;
  children?: ReactNode;
};

/**
 * A `Pressable` that responds to touch: it dips under the finger and fires one
 * haptic when the press completes.
 *
 * Both halves live here rather than at each call site so the whole app answers
 * a touch the same way. The haptic fires on `onPress` — not `onPressIn` — so a
 * finger that slides off the target never leaves a buzz behind for something
 * that did not happen.
 */
export function PressableScale({
  style,
  scaleTo,
  feedback = 'tap',
  highlightColor,
  highlightRadius = 0,
  onPress,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const isRow = highlightColor !== undefined;
  const motion = usePressScale(scaleTo ?? (isRow ? ROW_SCALE : undefined), isRow ? 1 : undefined);
  const haptic = useHaptics();

  return (
    <AnimatedPressable
      {...rest}
      // The caller's own style goes last: a screen overriding a radius or a
      // background still wins, and only the transform comes from here.
      style={[motion.style, style]}
      onPressIn={(event) => {
        motion.press();
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        motion.release();
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (feedback !== 'none') haptic(feedback);
        onPress?.(event);
      }}>
      {/*
        Behind the content rather than over it: an overlay would wash out the
        label it is meant to be under. It takes no layout because it is
        absolutely positioned, so a row's flex children are unaffected.
      */}
      {isRow ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: highlightColor,
              borderRadius: highlightRadius,
              opacity: motion.highlight,
            },
          ]}
        />
      ) : null}

      {children}
    </AnimatedPressable>
  );
}
