/**
 * One row in a chat sheet's action list.
 *
 * Shared by the composer's "+" menu (`ChatActionsList`) and the long-press
 * menu on a single message (`MessageActionsList`) so the two cannot drift:
 * whatever a row looks like when it is unavailable, busy or being sold, it
 * looks the same wherever the sheet was opened from.
 *
 * It takes the row treatment `ListRow` takes — the same recess, faded in rather
 * than switched on, and a dip small enough not to detach the row from the panel
 * it sits in. Held perfectly still it was the one list in the app that did not
 * answer a finger; matching `ListRow` is what stops a menu row and a settings
 * row feeling like different apps.
 */

import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/theme';

export type ActionRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  /** A state, not a value — rendered in Gold's amber beside the label. */
  badge?: string;
  /**
   * `danger` for a destructive row, which is the same two-value vocabulary
   * `ListRow` takes. It tints the glyph and the label only: a soft fill would
   * make one row of a menu read as a filled button.
   */
  tone?: 'text' | 'danger';
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
};

export function ActionRow({
  icon,
  label,
  description,
  badge,
  tone = 'text',
  onPress,
  disabled = false,
  busy = false,
}: ActionRowProps) {
  const { colors } = useTheme();
  const inert = disabled || busy;
  const accent = tone === 'danger' ? colors.danger : colors.primary;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      accessibilityLabel={label}
      accessibilityHint={description}
      disabled={inert}
      onPress={onPress}
      // A destructive row is felt as one before it is confirmed.
      feedback={tone === 'danger' ? 'warning' : 'tap'}
      highlightColor={colors.surfaceMuted}
      highlightRadius={Radius.md}
      style={[styles.row, disabled && styles.disabled]}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name={icon} size={20} color={disabled ? colors.textTertiary : accent} />
      </View>

      <View style={styles.text}>
        <View style={styles.labelRow}>
          <Text
            variant="bodyStrong"
            color={disabled ? 'textTertiary' : tone === 'danger' ? 'danger' : 'text'}>
            {label}
          </Text>
          {badge ? <Badge label={badge} tone="warning" /> : null}
        </View>
        <Text variant="caption" color="textTertiary">
          {description}
        </Text>
      </View>

      {busy ? (
        <ActivityIndicator size="small" color={colors.textTertiary} />
      ) : disabled ? null : (
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      )}
    </PressableScale>
  );
}

export const actionListStyles = StyleSheet.create({
  list: { gap: Spacing.xs, paddingBottom: Spacing.sm },
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  disabled: { opacity: 0.55 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
