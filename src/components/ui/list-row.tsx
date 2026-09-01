import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing, type ColorToken } from '@/theme';

type ListRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Secondary line under the label. */
  description?: string;
  /** Right-hand text, e.g. a current value. */
  value?: string;
  /**
   * Right-hand marker for a row whose *state* is the point — "Gold" on the
   * subscription row. Separate from `value`, which is a setting's current
   * answer and is rendered as plain caption text.
   */
  badge?: string;
  badgeTone?: BadgeTone;
  onPress?: () => void;
  /** Tints the icon and label — used for destructive rows like "Sign out". */
  tone?: Extract<ColorToken, 'text' | 'danger'>;
  showChevron?: boolean;
  /**
   * Dims the row and blocks the press. Used where a row exists but is not the
   * caller's to use — "Manage members" for a member who is not an admin — so
   * the capability stays visible and explains itself in `description`.
   */
  disabled?: boolean;
  /** Hides the divider on the final row of a group. */
  isLast?: boolean;
};

/** Settings-style row used by the Profile screen. */
export function ListRow({
  icon,
  label,
  description,
  value,
  badge,
  badgeTone = 'neutral',
  onPress,
  tone = 'text',
  showChevron = true,
  disabled = false,
  isLast = false,
}: ListRowProps) {
  const { colors } = useTheme();
  const iconColor = tone === 'danger' ? colors.danger : colors.textSecondary;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      feedback="tap"
      /*
        The row treatment: the recess it always had, now fading rather than
        switching, and a dip small enough that the divider inside it does not
        visibly move. A settings row is not a button and must not answer like
        one — see `PressableScale`.
      */
      highlightColor={colors.surfaceMuted}
      style={[styles.row, disabled && styles.dimmed]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>

      <View
        style={[
          styles.body,
          !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
        ]}>
        <View style={styles.labels}>
          <Text variant="body" color={tone}>
            {label}
          </Text>
          {description ? (
            <Text variant="caption" color="textTertiary">
              {description}
            </Text>
          ) : null}
        </View>

        {value ? (
          <Text variant="caption" color="textSecondary">
            {value}
          </Text>
        ) : null}

        {badge ? <Badge label={badge} tone={badgeTone} /> : null}

        {showChevron && !disabled ? (
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.lg },
  dimmed: { opacity: 0.4 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingRight: Spacing.lg,
  },
  labels: { flex: 1, gap: 2 },
});
