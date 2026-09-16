import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useHaptics } from '@/hooks/use-haptics';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { MaxContentWidth, Motion, Radius, Shadow, Spacing } from '@/theme';

/** Where the panel starts from before it has measured itself. */
const FALLBACK_TRAVEL = 360;

type SheetProps = {
  visible: boolean;
  /** Named for screen readers even when no visible title is wanted. */
  title: string;
  /** Hides the title row for a sheet whose content speaks for itself. */
  showTitle?: boolean;
  /** Optional line under the title — what this sheet is for. */
  description?: string;
  /** Blocks dismissal while a write is in flight. */
  dismissible?: boolean;
  /**
   * Identifies *which* content the panel is currently holding. A sheet that
   * swaps its children — Chat's one panel runs a menu, a task form and a photo
   * confirmation through the same frame — changes this, and the new content
   * settles in rather than replacing the old one between two frames.
   */
  contentKey?: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * A panel that rises from the bottom edge — the app's action sheet and its
 * modal forms.
 *
 * A `Modal` for the same reason `ConfirmDialog` is one: RN's `ActionSheetIOS`
 * is iOS-only and `Alert` does not exist on web, and this app has to behave the
 * same on all three targets. `ConfirmDialog` stays separate rather than being
 * rebuilt on top of this: it is a centred question with two answers, not a
 * surface, and collapsing the two would blur when to reach for which.
 *
 * The transition is ours rather than the `Modal`'s. `animationType="slide"`
 * moves the *whole* window, so the scrim arrives already at full strength,
 * travelling up with the panel like a card with a grey backing — which is not
 * what a scrim is. Driving it here separates the two: the backdrop fades where
 * it is, the panel travels its own height, and the same two values run
 * backwards on the way out, which is what lets the drag below hand off to them.
 *
 * Dismissal is deliberately available four ways — backdrop, hardware back and
 * Escape (both via `onRequestClose`), a downward drag on the handle, and
 * whatever the content offers — because a sheet that traps the user is the
 * crash they report as one.
 */
export function Sheet({
  visible,
  title,
  showTitle = true,
  description,
  dismissible = true,
  contentKey,
  onClose,
  children,
}: SheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const haptic = useHaptics();

  // RN Web has no native animated module; asking for one only earns a warning.
  const useNativeDriver = Platform.OS !== 'web';

  /*
    The `Modal` outlives `visible` by one animation: unmounting on the prop
    would cut the exit off at its first frame. `mounted` is what the Modal
    actually reads, and only the exit's completion clears it.
  */
  const [mounted, setMounted] = useState(visible);
  /** The panel's own height, so it travels exactly its length and no more. */
  const [travel, setTravel] = useState(FALLBACK_TRAVEL);

  const [progress] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));
  const [contentOpacity] = useState(() => new Animated.Value(1));
  const [contentShift] = useState(() => new Animated.Value(0));

  /**
   * `onClose` and `dismissible` through refs: the responder below is built once
   * for the life of the component, while both props are fresh on every render
   * of the screen holding the sheet. Reading them at gesture time is what stops
   * the drag holding the first render's closure forever.
   *
   * The mirrors are written in an effect rather than during render: a ref
   * touched mid-render is what React Compiler refuses (`react-hooks/refs`), and
   * a gesture can only fire after the commit that effect belongs to.
   */
  const closeRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);

  useEffect(() => {
    closeRef.current = onClose;
    dismissibleRef.current = dismissible;
  }, [dismissible, onClose]);

  /*
    Mounting is adjusted during render rather than in the effect below: the
    Modal has to exist in the very frame the entrance animation starts, and
    setting it from an effect costs an extra commit — which React Compiler also
    reads as a cascading render. Unmounting stays in the effect, because it is
    the exit's completion that decides it.
  */
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      drag.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: Motion.duration.panel,
        // Out-cubic: quick off the edge, settling rather than braking.
        easing: Easing.out(Easing.cubic),
        useNativeDriver,
      }).start();

      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: Motion.duration.exit,
      easing: Easing.in(Easing.cubic),
      useNativeDriver,
      // A drag that has already carried the panel part-way must not make the
      // rest of the trip take the full duration over again.
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [drag, progress, useNativeDriver, visible]);

  /*
    Content settling in. Only the arriving half is animated: holding the old
    children alive to cross-fade them would mean rendering a form that has
    already been told to reset, and the incoming fade alone is what the eye
    reads as one panel changing its mind rather than two panels swapping.
  */
  useEffect(() => {
    contentOpacity.setValue(0);
    contentShift.setValue(Motion.shift);

    Animated.parallel([
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: Motion.duration.fast,
        useNativeDriver,
      }),
      Animated.timing(contentShift, {
        toValue: 0,
        duration: Motion.duration.fast,
        easing: Easing.out(Easing.quad),
        useNativeDriver,
      }),
    ]).start();
  }, [contentKey, contentOpacity, contentShift, useNativeDriver]);

  /**
   * Drag to dismiss, on the handle only.
   *
   * The whole panel would be the more generous target and is the wrong one:
   * every sheet in this app holds either a scroll view or a text field, and a
   * responder over those competes for the same downward drag. The handle is the
   * one strip that owns nothing else, which is what a grabber is for.
   *
   * The rule below reads every `.current` inside a `useMemo` as a render-time
   * access, and for a `PanResponder` it cannot be one: the factory returns
   * handlers, and a handler runs when a finger moves. Building the responder
   * anywhere else means rebuilding it whenever a prop changes, which is the
   * stale-closure problem these mirrors exist to avoid.
   */
  const responder = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          dismissibleRef.current && gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          // Upward drag is refused rather than inverted: there is nothing above
          // the panel to reveal, so following the finger would only detach it.
          drag.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          const dismissed =
            gesture.dy > Motion.dismissDistance || gesture.vy > Motion.dismissVelocity;

          if (dismissed) {
            haptic('tap');
            closeRef.current();

            return;
          }

          Animated.spring(drag, {
            toValue: 0,
            ...Motion.spring.settle,
            useNativeDriver,
          }).start();
        },
        // A released-but-not-dismissed panel still has to come home.
        onPanResponderTerminate: () => {
          Animated.spring(drag, { toValue: 0, ...Motion.spring.settle, useNativeDriver }).start();
        },
      }),
    [drag, haptic, useNativeDriver],
  );

  const slide = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [travel, 0],
  });

  return (
    <Modal
      visible={mounted}
      transparent
      // The transition is driven here; the Modal's own would fight it.
      animationType="none"
      // Android's hardware back, and Escape on web.
      onRequestClose={dismissible ? onClose : undefined}>
      {/*
        The keyboard is handled here rather than inside each sheet's content,
        because a `KeyboardAvoidingView` nested in another one applies the inset
        twice and lifts the panel clear off the keyboard it was avoiding.

        Android needs `height` rather than nothing: a `Modal` is its own window
        and does not inherit the activity's `adjustResize`, so without it a
        focused field at the bottom of a sheet sits under the keyboard.
      */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.backdrop}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.overlay, opacity: progress },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.dismiss', { title })}
              disabled={!dismissible}
              onPress={onClose}
              style={styles.flex}
            />
          </Animated.View>

          <Animated.View
            onLayout={(event) => setTravel(event.nativeEvent.layout.height)}
            accessibilityViewIsModal
            style={[
              styles.panel,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                // The home indicator sits under the last row otherwise.
                paddingBottom: Spacing.lg + insets.bottom,
                transform: [{ translateY: Animated.add(slide, drag) }],
              },
            ]}>
            {/*
              The handle. It carries no accessibility role on purpose: it is a
              drag target, and a screen reader cannot drag — dismissal is
              announced on the backdrop above, which is reachable, and every
              sheet's content offers its own way out as well.

              Nothing here swallows presses any more either. The backdrop is now
              a *sibling* of the panel rather than its parent, so a touch landing
              inside the panel was never going to reach it.
            */}
            <View {...responder.panHandlers} style={styles.grabArea}>
              <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            </View>

            <Animated.View
              style={[
                styles.content,
                { opacity: contentOpacity, transform: [{ translateY: contentShift }] },
              ]}>
              {showTitle ? (
                <View style={styles.heading}>
                  <Text variant="heading">{title}</Text>
                  {description ? (
                    <Text variant="caption" color="textSecondary">
                      {description}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {children}
            </Animated.View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Bottom-aligned: the panel rises from the edge the thumb is already near.
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    width: '100%',
    maxWidth: MaxContentWidth,
    // Bounded by the backdrop, which is what the keyboard shrinks — so content
    // that scrolls (`flexShrink: 1`) yields instead of pushing its own footer
    // off the bottom of the screen.
    maxHeight: '100%',
    alignSelf: 'center',
    paddingHorizontal: Spacing.lg,
    // Wider than a card's: the panel is the largest surface in the app and the
    // corner has to stay a corner against a full-width edge.
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    ...Shadow.floating,
  },
  // Deep enough to be caught by a thumb aiming at the handle rather than at the
  // 5px line it can see.
  grabArea: { alignItems: 'center', paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  grabber: { width: 40, height: 5, borderRadius: Radius.pill },
  // Yields under the panel's `maxHeight`, which is what lets a scrolling child
  // shrink against the keyboard instead of pushing its own footer off-screen.
  content: { flexShrink: 1, gap: Spacing.md, paddingTop: Spacing.xs },
  heading: { gap: 2 },
});
