import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { GradientSurface, type GradientTone } from '@/components/ui/gradient-surface';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Shadow, Spacing, type ColorToken } from '@/theme';

/**
 * Each tone pairs a `*Soft` fill with its solid foreground — the same four the
 * gradients carry a wash for, so the pill hands its tone straight to
 * `GradientSurface`. Aliased rather than re-declared so the two cannot drift.
 */
export type StatusTone = GradientTone;

type LiveStatusPillProps = {
  icon: keyof typeof Ionicons.glyphMap;
  tone: StatusTone;
  /** The kind of thing this is — "Due today", "Live now". */
  label: string;
  /** The thing itself, in one line. */
  detail: string;
  onPress: () => void;
};

/**
 * The one line at the top of Home that says what is happening right now.
 *
 * It is a single slot on purpose: whichever of the family's rows is most worth
 * acting on takes it, and tapping goes to the tab that row lives on. The Home
 * screen decides which — this only renders the choice, so there is no state
 * here that could disagree with the tiles below.
 */
export function LiveStatusPill({ icon, tone, label, detail, onPress }: LiveStatusPillProps) {
  const { colors } = useTheme();
  const softToken = `${tone}Soft` as ColorToken;

  return (
    // Two elements rather than one: iOS draws a shadow from the pressed layer's
    // own opaque background, and clipping a gradient to a radius on the same
    // view would mask that shadow away. So the outer surface carries the fill
    // and the shadow, and the gradient — which rounds its own corners — lays
    // the content out on top of it.
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${detail}`}
      onPress={onPress}
      feedback="tap"
      style={[styles.shell, { backgroundColor: colors[softToken] }]}>
      <GradientSurface tone={tone} style={styles.pill}>
        <View style={[styles.iconWell, { backgroundColor: colors.surface }]}>
          <Ionicons name={icon} size={18} color={colors[tone]} />
        </View>

        <View style={styles.text}>
          <Text variant="label" color={tone}>
            {label.toUpperCase()}
          </Text>
          <Text variant="bodyStrong" numberOfLines={1}>
            {detail}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={16} color={colors[tone]} />
      </GradientSurface>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  shell: { borderRadius: Radius.pill, ...Shadow.card },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingRight: Spacing.lg,
    borderRadius: Radius.pill,
  },
  iconWell: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
});
