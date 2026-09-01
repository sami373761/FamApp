import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/theme';

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
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: SegmentedProps<T>) {
  const { colors } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.track, { backgroundColor: colors.surfaceMuted }, disabled && styles.dimmed]}>
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
            style={[
              styles.segment,
              isSelected && { backgroundColor: colors.surface, borderColor: colors.border },
            ]}>
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
    // Transparent until selected, so the segment does not resize on selection.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
});
