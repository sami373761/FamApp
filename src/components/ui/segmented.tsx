import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Motion, Radius, Spacing } from '@/theme';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

type SegmentedProps<T extends string> = {
  /** Two to four choices; more than that wants a list, not a segment. */
  options: readonly SegmentedOption<T>[];
  /** Null renders with nothing selected — a value the member has not set yet. */
  value: T | null;
  onChange: (value: T) => void;
  /** Announced as the purpose of the group, e.g. "Appearance". */
  label: string;
  disabled?: boolean;
};

/**
 * A small set of mutually exclusive choices, picked in place.
 *
 * The track is `surfaceMuted` and the selected segment is `surface`, so the
 * selection reads as raised out of a recessed well — the direction greys are
 * allowed to move on a white canvas. In dark mode the same pair steps up from
 * the canvas, which is that scheme's convention.
 *
 * That raised segment is **one view that slides**, not a background switched on
 * and off per option. Two segments changing colour in the same frame says a
 * choice was replaced; one thumb travelling says the same choice moved, which
 * is what actually happened — and it is the only way the control can show
 * *which way* the selection went. It is measured rather than assumed: the track
 * reports its width through `onLayout` and the thumb is laid out from it, so
 * the maths holds for two options or four and for whatever a translated label
 * does to the row.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: SegmentedProps<T>) {
  const { colors } = useTheme();

  // RN Web has no native animated module; asking for one only earns a warning.
  const useNativeDriver = Platform.OS !== 'web';

  const [trackWidth, setTrackWidth] = useState(0);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const hasSelection = selectedIndex >= 0;

  /*
    The track pads itself and puts one gap between segments, so the thumb's
    width is what is left over shared out — not `trackWidth / count`, which
    would drift a segment's worth by the last option.
  */
  const inner = Math.max(0, trackWidth - Spacing.xs * 2);
  const segmentWidth =
    options.length > 0 ? (inner - Spacing.xs * (options.length - 1)) / options.length : 0;

  const offset = useRef(new Animated.Value(0)).current;
  const presence = useRef(new Animated.Value(0)).current;
  /**
   * Whether the thumb has ever been put somewhere. The first measured layout
   * has to *place* it — animating from x=0 would slide it in from the track's
   * left edge every time the screen mounts already holding a selection.
   */
  const isPlaced = useRef(false);

  useEffect(() => {
    if (!hasSelection || segmentWidth <= 0) {
      // Fades out where it stands rather than sliding to a zero index, which
      // would animate the thumb to the first option on its way to nowhere.
      Animated.timing(presence, {
        toValue: 0,
        duration: Motion.duration.fast,
        useNativeDriver,
      }).start();

      return;
    }

    const target = Spacing.xs + selectedIndex * (segmentWidth + Spacing.xs);

    if (!isPlaced.current) {
      isPlaced.current = true;
      offset.setValue(target);
    }

    Animated.parallel([
      Animated.timing(presence, {
        toValue: 1,
        duration: Motion.duration.fast,
        useNativeDriver,
      }),
      Animated.timing(offset, {
        toValue: target,
        duration: Motion.duration.base,
        // Out-cubic: leaves quickly, arrives softly. A spring here overshoots
        // past the segment it is meant to be marking.
        easing: Easing.out(Easing.cubic),
        useNativeDriver,
      }),
    ]).start();
  }, [hasSelection, offset, presence, segmentWidth, selectedIndex, useNativeDriver]);

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: colors.surfaceMuted }, disabled && styles.dimmed]}>
      {/* Behind the labels and deaf to touch: the segments above own every
          press, exactly as they did when each drew its own background. */}
      {segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              width: segmentWidth,
              opacity: presence,
              transform: [{ translateX: offset }],
            },
          ]}
        />
      ) : null}

      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <PressableScale
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected, disabled }}
            accessibilityLabel={option.label}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            feedback="select"
            // A segment is already inset in its track; dipping it as far as a
            // full-width button would pull it off its own edges.
            scaleTo={0.94}
            style={styles.segment}>
            <Text
              variant={isSelected ? 'captionStrong' : 'caption'}
              color={isSelected ? 'text' : 'textSecondary'}>
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    padding: Spacing.xs,
    gap: Spacing.xs,
  },
  dimmed: { opacity: 0.4 },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
  },
  thumb: {
    position: 'absolute',
    top: Spacing.xs,
    bottom: Spacing.xs,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
