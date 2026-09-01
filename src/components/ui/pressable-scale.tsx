import type { ReactNode } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

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

type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  /** Plain styles only — no `({ pressed }) => …`; see the note above. */
  style?: StyleProp<ViewStyle>;
  /** Override the dip for an unusually large or small surface. */
  scaleTo?: number;
  /** What this press should feel like. `'none'` for a surface pressed in bulk. */
  feedback?: HapticFeedback | 'none';
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
  onPress,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const motion = usePressScale(scaleTo);
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
      {children}
    </AnimatedPressable>
  );
}
