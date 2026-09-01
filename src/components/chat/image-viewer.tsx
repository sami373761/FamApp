/**
 * A chat photo at full size, with zoom.
 *
 * The bubble crops to a fixed 4:3 well so a run of photos does not make the
 * day's messages jump about, which means the bubble is never the whole picture
 * — this is where the rest of it is. `contentFit` is the difference and is the
 * whole point: `cover` in the bubble fills the well and loses the edges,
 * `contain` here fits the frame and loses nothing.
 *
 * **It re-signs nothing.** The caller passes the URL `ChatImage` already
 * resolved, and both pass the object path as `cacheKey`, so opening a photo is
 * a cache hit on bytes the device downloaded for the thumbnail rather than a
 * second signing request and a second download of the same object.
 *
 * A `Modal` rather than a route: it is a lightbox over the message that owns it,
 * and pushing a screen would put the chat's scroll position at the mercy of the
 * navigator. It is also the only `Modal` on the Chat screen that is not the one
 * `Sheet` — safe because the two can never be open at once, since the sheet
 * covers the list a photo would have to be tapped in. That is the same
 * two-modals-in-one-frame rule the sheet's four-mode state exists for,
 * satisfied by the surfaces being mutually unreachable rather than by a state
 * machine.
 *
 * ## Gestures
 *
 * Built on RN's own `PanResponder` and `Animated`, which is the whole of this
 * project's animation layer — `react-native-reanimated` is a dependency no file
 * imports, and `react-native-gesture-handler` is used only for the root view.
 * Waking either for one screen would be a larger commitment than the feature.
 *
 * One responder handles all three gestures, because they are the same stream of
 * touches and separating them would mean two responders fighting over who
 * claimed the finger:
 *
 * - **Pinch** — two touches, scale tracked against the distance between them at
 *   the moment the second finger landed.
 * - **Pan** — one touch, and only while zoomed in. At fit-scale a drag does
 *   nothing, so a stray finger cannot slide the photo off its own frame.
 * - **Double tap** — toggles between fit and `DOUBLE_TAP_SCALE`, which is what
 *   gives web and any one-finger user a way to zoom at all.
 *
 * **A single tap closes, and it is deliberately deferred** by `DOUBLE_TAP_MS`:
 * the first tap of a double tap is indistinguishable from a single one until
 * the window has passed, so closing immediately would shut the viewer every
 * time somebody tried to zoom. The delay is only paid on the background tap;
 * the X button closes at once and is the honest primary way out.
 *
 * Scale is clamped on release rather than during the gesture, so a pinch past
 * either end resists and springs back instead of stopping dead against a limit.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

/** Fit-to-frame, and the two ends a pinch is allowed to settle between. */
const MIN_SCALE = 1;
const MAX_SCALE = 4;
/** Where a double tap lands — enough to read a face or a sign, not a pixel hunt. */
const DOUBLE_TAP_SCALE = 2.5;

/** How long a tap waits to find out whether it was the first half of a double. */
const DOUBLE_TAP_MS = 220;
/** Movement under this, in either axis, still counts as a tap rather than a drag. */
const TAP_SLOP = 8;

type ImageViewerProps = {
  visible: boolean;
  /** The signed URL the bubble already holds — null keeps the viewer shut. */
  url: string | null;
  /** The object path, reused as the disk-cache key. See the note above. */
  path: string;
  /** Describes the photo for a screen reader, as the bubble's copy does. */
  label: string;
  onClose: () => void;
};

export function ImageViewer({ visible, url, path, label, onClose }: ImageViewerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);

  /**
   * The animated values, plus plain refs mirroring them.
   *
   * `Animated.Value` has no synchronous reader that is safe to call from a
   * gesture callback — `__getValue` is private and `addListener` is a
   * round-trip — so the responder does its arithmetic against these refs and
   * the values are only ever written to. They are kept in step by being set
   * together, which is why every commit below goes through `apply`.
   */
  const scale = useRef(new Animated.Value(MIN_SCALE)).current;
  const offsetX = useRef(new Animated.Value(0)).current;
  const offsetY = useRef(new Animated.Value(0)).current;

  const state = useRef({
    scale: MIN_SCALE,
    x: 0,
    y: 0,
    // The values as they were when the current gesture began.
    startScale: MIN_SCALE,
    startX: 0,
    startY: 0,
    /** Distance between two fingers when the second one landed; 0 while panning. */
    pinchDistance: 0,
    /** Where a single touch went down, to tell a tap from a drag. */
    tapX: 0,
    tapY: 0,
    lastTapAt: 0,
  }).current;

  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The frame the photo is fitted into, measured by `onLayout`. */
  const frameSize = useRef({ width: 0, height: 0 });

  /**
   * `onClose` through a ref, because the responder is memoised for the life of
   * the component while the prop is a fresh arrow on every render of the
   * bubble. Reading it at call time is what stops the gesture holding the first
   * render's closure forever.
   */
  const closeRef = useRef(onClose);

  closeRef.current = onClose;

  const cancelTapTimer = () => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
  };

  // Every reset and every gesture commit goes through here, so the refs the
  // responder reads can never drift from the values the screen is showing.
  const apply = useMemo(
    () =>
      (next: { scale: number; x: number; y: number }, animated: boolean) => {
        state.scale = next.scale;
        state.x = next.x;
        state.y = next.y;

        if (!animated) {
          scale.setValue(next.scale);
          offsetX.setValue(next.x);
          offsetY.setValue(next.y);

          return;
        }

        Animated.parallel([
          Animated.spring(scale, { toValue: next.scale, useNativeDriver: true, friction: 8 }),
          Animated.spring(offsetX, { toValue: next.x, useNativeDriver: true, friction: 8 }),
          Animated.spring(offsetY, { toValue: next.y, useNativeDriver: true, friction: 8 }),
        ]).start();
      },
    [offsetX, offsetY, scale, state],
  );

  // A different photo, or a reopened viewer, always starts fit to the frame —
  // inheriting the zoom somebody left on the last picture would open this one
  // somewhere in the middle of itself.
  useEffect(() => {
    if (!visible) return;

    setIsLoading(true);
    apply({ scale: MIN_SCALE, x: 0, y: 0 }, false);
    state.lastTapAt = 0;

    return cancelTapTimer;
  }, [apply, state, visible, url]);

  useEffect(() => cancelTapTimer, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claimed on touch-down so a tap is seen at all; a drag that should
        // scroll something else has nothing to compete with here, since the
        // viewer is the whole surface.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          state.scale > MIN_SCALE || gesture.numberActiveTouches === 2,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (event) => {
          cancelTapTimer();

          state.startScale = state.scale;
          state.startX = state.x;
          state.startY = state.y;
          state.pinchDistance = 0;

          const touch = event.nativeEvent.touches[0];

          state.tapX = touch?.pageX ?? 0;
          state.tapY = touch?.pageY ?? 0;
        },

        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;

          if (touches.length === 2) {
            const distance = Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            );

            // The second finger may land mid-gesture, so the baseline is taken
            // on the first two-touch frame rather than at grant.
            if (state.pinchDistance === 0) {
              state.pinchDistance = distance;
              state.startScale = state.scale;

              return;
            }

            // Unclamped on purpose — release is where it settles, so a pinch
            // past the end gives rather than hitting a wall.
            const next = state.startScale * (distance / state.pinchDistance);

            state.scale = next;
            scale.setValue(next);

            return;
          }

          if (state.scale > MIN_SCALE) {
            const x = state.startX + gesture.dx;
            const y = state.startY + gesture.dy;

            state.x = x;
            state.y = y;
            offsetX.setValue(x);
            offsetY.setValue(y);
          }
        },

        onPanResponderRelease: (event, gesture) => {
          const wasPinching = state.pinchDistance > 0;
          const moved = Math.abs(gesture.dx) > TAP_SLOP || Math.abs(gesture.dy) > TAP_SLOP;

          state.pinchDistance = 0;

          if (!wasPinching && !moved) {
            handleTap(event);

            return;
          }

          // Settle: clamp the scale, and drop back to centre whenever the photo
          // is no longer larger than its frame — an offset at fit-scale would
          // leave the picture sitting off to one side with nothing to pan back.
          const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale));

          apply(
            clamped <= MIN_SCALE
              ? { scale: MIN_SCALE, x: 0, y: 0 }
              : { scale: clamped, ...clampOffset(clamped, state.x, state.y) },
            true,
          );
        },
      }),
    // `handleTap` is read through the closure below and is stable for the life
    // of the component, so the responder is built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply, offsetX, offsetY, scale, state],
  );

  /**
   * Keeps a zoomed photo overlapping its own frame.
   *
   * At scale *s* the picture is *s* times the frame, so half the overflow —
   * `(s - 1) × frame / 2` — is as far as it can travel before an edge comes
   * inside the window. Without this a firm drag flings the photo off the screen
   * entirely and leaves a black rectangle with no way back except closing.
   *
   * Measured against the *frame*, not the rendered picture: `contain` letterboxes
   * a photo whose aspect ratio differs, so the true bound is smaller on one
   * axis. Erring wide lets a little letterboxing show at the extreme, which is
   * harmless — erring narrow would clip content the user is trying to reach.
   */
  function clampOffset(atScale: number, x: number, y: number) {
    const limitX = Math.max(0, ((atScale - 1) * frameSize.current.width) / 2);
    const limitY = Math.max(0, ((atScale - 1) * frameSize.current.height) / 2);

    return {
      x: Math.min(limitX, Math.max(-limitX, x)),
      y: Math.min(limitY, Math.max(-limitY, y)),
    };
  }

  function handleTap(event: GestureResponderEvent) {
    const now = Date.now();
    const isDouble = now - state.lastTapAt < DOUBLE_TAP_MS;

    state.lastTapAt = isDouble ? 0 : now;

    if (isDouble) {
      cancelTapTimer();

      // Zoom toward the point that was tapped rather than the centre: the
      // offset that keeps a tapped point still under the finger is its distance
      // from the centre, scaled by how much bigger everything just got.
      if (state.scale > MIN_SCALE) {
        apply({ scale: MIN_SCALE, x: 0, y: 0 }, true);

        return;
      }

      const { locationX, locationY } = event.nativeEvent;
      const frame = frameSize.current;
      const dx = frame.width > 0 ? frame.width / 2 - locationX : 0;
      const dy = frame.height > 0 ? frame.height / 2 - locationY : 0;

      apply(
        {
          scale: DOUBLE_TAP_SCALE,
          ...clampOffset(DOUBLE_TAP_SCALE, dx * DOUBLE_TAP_SCALE, dy * DOUBLE_TAP_SCALE),
        },
        true,
      );

      return;
    }

    // Might still turn out to be the first half of a double tap; see the note
    // about `DOUBLE_TAP_MS` at the top.
    cancelTapTimer();
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      if (state.scale <= MIN_SCALE) closeRef.current();
    }, DOUBLE_TAP_MS);
  }

  if (!url) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's hardware back, and Escape on web.
      onRequestClose={onClose}
      // Without this the status bar keeps the app's own background on Android
      // and sits as a pale band above a black frame.
      statusBarTranslucent>
      <View
        style={[styles.canvas, { backgroundColor: colors.viewerCanvas }]}
        onLayout={({ nativeEvent }) => {
          frameSize.current = {
            width: nativeEvent.layout.width,
            height: nativeEvent.layout.height,
          };
        }}
        {...responder.panHandlers}>
        <Animated.View
          style={[
            styles.stage,
            { transform: [{ translateX: offsetX }, { translateY: offsetY }, { scale }] },
          ]}>
          <Image
            source={{ uri: url, cacheKey: path }}
            style={styles.image}
            contentFit="contain"
            accessibilityLabel={label}
            cachePolicy="disk"
            recyclingKey={path}
            onLoad={() => setIsLoading(false)}
            // A failure here is not worth its own state: the thumbnail behind
            // this viewer loaded from the same URL a moment ago, so the honest
            // outcome is the spinner stopping rather than a second error
            // message contradicting the picture still on screen underneath.
            onError={() => setIsLoading(false)}
          />
        </Animated.View>

        {isLoading ? (
          <View style={styles.spinner} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.viewerOnCanvas} />
          </View>
        ) : null}

        {/*
          Outside the animated stage, so it neither zooms nor slides with the
          photo — it is the one control that must stay findable at any scale.
        */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('chat.photoClose')}
          onPress={onClose}
          // Inset by the notch, not by a guess. `Spacing.lg` matches the tab
          // bar island's own inset, so the two chrome edges agree.
          style={[styles.close, { top: insets.top + Spacing.sm }]}>
          <View style={[styles.closeWell, { backgroundColor: colors.overlay }]}>
            <Ionicons name="close" size={22} color={colors.viewerOnCanvas} />
          </View>
        </PressableScale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  stage: { width: '100%', height: '100%' },
  // Not `absoluteFill`: filling by flex is what lets `contain` measure against
  // the real frame rather than against an unbounded box.
  image: { width: '100%', height: '100%' },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: Spacing.lg },
  closeWell: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
