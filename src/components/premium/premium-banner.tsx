import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { GradientSurface } from '@/components/ui/gradient-surface';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Shadow, Spacing } from '@/theme';

type PremiumBannerProps = {
  title: string;
  /** One line on what the money buys — never a feature list. */
  description: string;
  onPress: () => void;
};

/**
 * The upgrade entry point on Home.
 *
 * `warning` is the gold: it is the amber the palette already carries
 * (`#C77C1A`), and taking it means the offer adds no colour to the app. It is
 * deliberately *not* `primary` — green is the app's own actions, and a promo
 * that dressed itself as one would read as something the family did.
 *
 * Built like `LiveStatusPill`, and for the same reason: iOS draws the shadow
 * from the pressed layer's opaque background, so the outer surface carries the
 * fill and the shadow while the gradient — which rounds its own corners — lays
 * the content out on top. Clipping both to one view masks the shadow away.
 */
export function PremiumBanner({ title, description, onPress }: PremiumBannerProps) {
  const { colors } = useTheme();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      onPress={onPress}
      feedback="tap"
      style={[styles.shell, { backgroundColor: colors.warningSoft }]}>
      <GradientSurface tone="warning" style={styles.banner}>
        <View style={[styles.iconWell, { backgroundColor: colors.surface }]}>
          <Ionicons name="sparkles" size={20} color={colors.warning} />
        </View>

        <View style={styles.text}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" color="textSecondary">
            {description}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={16} color={colors.warning} />
      </GradientSurface>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  shell: { borderRadius: Radius.xl, ...Shadow.card },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    paddingRight: Spacing.lg,
    borderRadius: Radius.xl,
  },
  iconWell: {
    width: 44,
    height: 44,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Wraps to two lines rather than truncating: the description is the offer.
  text: { flex: 1, gap: 2 },
});
