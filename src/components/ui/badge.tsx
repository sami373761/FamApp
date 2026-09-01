import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing, type ColorToken } from '@/theme';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

type BadgeProps = {
  label: string;
  tone?: BadgeTone;
};

/** Maps a semantic tone onto its background/foreground token pair. */
const TONE_TOKENS: Record<BadgeTone, { bg: ColorToken; fg: ColorToken }> = {
  neutral: { bg: 'surfaceMuted', fg: 'textSecondary' },
  primary: { bg: 'primarySoft', fg: 'primary' },
  success: { bg: 'successSoft', fg: 'success' },
  warning: { bg: 'warningSoft', fg: 'warning' },
  danger: { bg: 'dangerSoft', fg: 'danger' },
  info: { bg: 'infoSoft', fg: 'info' },
};

export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const { colors } = useTheme();
  const { bg, fg } = TONE_TOKENS[tone];

  return (
    <View style={[styles.badge, { backgroundColor: colors[bg] }]}>
      <Text variant="label" color={fg} style={styles.label}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  label: { letterSpacing: 0.5 },
});
