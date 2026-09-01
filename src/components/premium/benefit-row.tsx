import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/theme';

type BenefitRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
};

/**
 * One line of the value proposition.
 *
 * The well is `warningSoft` rather than the `surfaceMuted` `ListRow` uses: this
 * is not a setting, it is the thing being sold, and the gold ties the four rows
 * to the header above them. Icons stay Ionicons — the emoji a paywall usually
 * reaches for render differently on every platform and carry no colour token.
 */
export function BenefitRow({ icon, title, description }: BenefitRowProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <View style={[styles.iconWell, { backgroundColor: colors.warningSoft }]}>
        <Ionicons name={icon} size={18} color={colors.warning} />
      </View>

      <View style={styles.text}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" color="textSecondary">
          {description}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  iconWell: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
});
