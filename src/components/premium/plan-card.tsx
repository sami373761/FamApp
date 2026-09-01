import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/theme';

type PlanCardProps = {
  /** "Annual", "Monthly" — the plan's name, not its price. */
  name: string;
  price: string;
  /** The same money said the other way — "$3.33 a month". */
  per: string;
  /** "Best value · 40% off". Omitted on the plain plan. */
  badge?: string;
  /** A line that only one plan carries, e.g. the free trial. */
  note?: string;
  selected: boolean;
  onSelect: () => void;
  a11yLabel: string;
};

/**
 * One of the two prices, picked in place.
 *
 * A pair of cards rather than a `Segmented`: each option carries a price, a
 * per-month equivalent, a badge and a trial line, and a segment is a label.
 *
 * Selection is the border, not the fill. Tinting the card would put a raised
 * grey on the white canvas, which is the one direction the palette does not go;
 * the line is what carries hierarchy in light mode anyway. The width is the
 * same in both states so picking a plan cannot shift the layout under the
 * finger — only the colour changes.
 */
export function PlanCard({
  name,
  price,
  per,
  badge,
  note,
  selected,
  onSelect,
  a11yLabel,
}: PlanCardProps) {
  const { colors } = useTheme();

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={a11yLabel}
      onPress={onSelect}
      feedback="select"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: selected ? colors.warning : colors.border,
        },
      ]}>
      <View style={styles.head}>
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={20}
          color={selected ? colors.warning : colors.textTertiary}
        />

        <View style={styles.title}>
          <Text variant="subheading">{name}</Text>
        </View>

        {badge ? <Badge label={badge} tone="warning" /> : null}
      </View>

      <View style={styles.price}>
        <Text variant="heading">{price}</Text>
        <Text variant="caption" color="textTertiary">
          {per}
        </Text>
      </View>

      {note ? (
        <View style={styles.note}>
          <Ionicons name="gift-outline" size={14} color={colors.warning} />
          <Text variant="captionStrong" color="warning" style={styles.noteText}>
            {note}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    // Held at the same width in both states; only the colour moves.
    borderWidth: 2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { flex: 1 },
  price: { paddingLeft: Spacing.xl + Spacing.xs, gap: 2 },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingLeft: Spacing.xl + Spacing.xs,
  },
  noteText: { flex: 1 },
});
