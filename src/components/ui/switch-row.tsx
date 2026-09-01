import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Switch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/theme';

type SwitchRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Secondary line under the label — say what flipping this actually does. */
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  /** Swaps the switch for a spinner while the change is being written. */
  busy?: boolean;
  /** Hides the divider on the final row of a group. */
  isLast?: boolean;
};

/**
 * `ListRow` for a setting that toggles rather than navigates.
 *
 * Deliberately the same icon well, divider and spacing as `ListRow`, because
 * the two sit in one card on the Profile screen and the eye should read them as
 * one list with two kinds of control.
 */
export function SwitchRow({
  icon,
  label,
  description,
  value,
  onValueChange,
  disabled = false,
  busy = false,
  isLast = false,
}: SwitchRowProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.row, disabled && styles.dimmed]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name={icon} size={18} color={colors.textSecondary} />
      </View>

      <View
        style={[
          styles.body,
          !isLast && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.separator,
          },
        ]}>
        <View style={styles.labels}>
          <Text variant="body">{label}</Text>
          {description ? (
            <Text variant="caption" color="textTertiary">
              {description}
            </Text>
          ) : null}
        </View>

        {busy ? (
          <ActivityIndicator color={colors.textTertiary} style={styles.spinner} />
        ) : (
          <Switch
            value={value}
            onValueChange={onValueChange}
            disabled={disabled}
            accessibilityLabel={label}
            trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
            thumbColor={colors.surface}
            ios_backgroundColor={colors.surfaceMuted}
          />
        )}
      </View>
    </View>
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
  // Holds the switch's width so the row does not reflow while it is busy.
  spinner: { width: 51 },
});
