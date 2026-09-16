import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { Text } from '@/components/ui/text';
import { useHaptics } from '@/hooks/use-haptics';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Shadow, Spacing } from '@/theme';

/** How far the card can be pulled before it stops following the finger. */
const TRAVEL = 104;
/** Past this on release, the task is completed. */
const THRESHOLD = 72;
/** Below this a drag is a tap, and steeper than this it is the list scrolling. */
const MIN_DRAG = 8;
const HORIZONTAL_BIAS = 1.5;

type SwipeToCompleteProps = {
  /** False for a task that is already finished, or whose write is in flight. */
  enabled: boolean;
  /** Fired once, on release past the threshold. */
  onComplete: () => void;
  children: ReactNode;
};

/**
 * Pull a task card to the right to complete it.
 *
 * Built on React Native's own responder props and `Animated` rather than a
 * gesture library: `react-native-gesture-handler` is in this project for the
 * root view only and there is no animation layer, so this is the smallest thing
 * that works on every target the app builds for, the browser included. The
 * touch that started the gesture is captured without claiming it
 * (`…ShouldSetResponderCapture` returning false), which is what gives the
 * handlers a distance to measure while leaving taps to the card underneath.
 *
 * The gesture has to lose to the list it lives in — a task list scrolls
 * vertically — so the responder is only claimed for a drag that is clearly
 * sideways, and only rightwards. Completion is a real write: the card holds at
 * the green track for a beat, the caller's update goes out, and the card
 * springs back. It does not disappear on its own, because whether it moves to
 * the completed section is the database's answer, not this component's.
 */
export function SwipeToComplete({ enabled, onComplete, children }: SwipeToCompleteProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const haptic = useHaptics();

  // Lazily constructed once; `useState` rather than a ref because the value is
  // read while rendering the transform.
  const [translateX] = useState(() => new Animated.Value(0));

  // Where the finger went down. Only ever touched from an event handler.
  const origin = useRef({ x: 0, y: 0 });

  // Whether the finger is currently past the point of no return. Kept so the
  // detent below ticks on each crossing rather than on every frame beyond it —
  // and so dragging back under the threshold arms it again.
  const isArmed = useRef(false);

  // RN Web has no native animated module; asking for one only earns a warning.
  const useNativeDriver = Platform.OS !== 'web';

  const settle = useCallback(() => {
    Animated.spring(translateX, { toValue: 0, bounciness: 0, useNativeDriver }).start();
  }, [translateX, useNativeDriver]);

  const distance = (event: GestureResponderEvent) => ({
    dx: event.nativeEvent.pageX - origin.current.x,
    dy: event.nativeEvent.pageY - origin.current.y,
  });

  // A finished card is a plain card: no track behind it, and no wrapper
  // clipping the shadow that gives it its edge.
  if (!enabled) return <>{children}</>;

  return (
    <View style={[styles.track, { backgroundColor: colors.successSoft }]}>
      <View style={styles.action} pointerEvents="none">
        <Ionicons name="checkmark-circle" size={22} color={colors.success} />
        {/* The status this pull sets, named from the catalog — the same word
            the "Done" button above it wears. */}
        <Text variant="captionStrong" color="success">
          {t('taskStatus.completed')}
        </Text>
      </View>

      <Animated.View
        style={{ transform: [{ translateX }] }}
        onStartShouldSetResponderCapture={(event) => {
          origin.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };

          // Not ours yet: the card below still has to receive its taps.
          return false;
        }}
        onMoveShouldSetResponder={(event) => {
          const { dx, dy } = distance(event);

          return dx > MIN_DRAG && dx > Math.abs(dy) * HORIZONTAL_BIAS;
        }}
        // Once the swipe has started, the scroll view does not get to take it.
        onResponderTerminationRequest={() => false}
        onResponderMove={(event) => {
          const { dx } = distance(event);

          // A detent, not a confirmation: the tick says the card would complete
          // if the finger came off here, which is the one thing the track's
          // colour cannot say while a thumb is covering it.
          const armed = dx >= THRESHOLD;

          if (armed !== isArmed.current) {
            isArmed.current = armed;
            haptic('select');
          }

          translateX.setValue(Math.max(0, Math.min(dx, TRAVEL)));
        }}
        onResponderRelease={(event) => {
          isArmed.current = false;

          if (distance(event).dx < THRESHOLD) {
            settle();

            return;
          }

          Animated.timing(translateX, {
            toValue: TRAVEL,
            duration: 90,
            useNativeDriver,
          }).start(() => {
            onComplete();
            settle();
          });
        }}
        onResponderTerminate={() => {
          isArmed.current = false;
          settle();
        }}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Carries the card's own radius and shadow while it clips the slide, so a
  // card at rest looks exactly as it does anywhere else in the app.
  track: { borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.card },
  action: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.lg,
  },
});
