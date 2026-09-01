import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Spacing } from '@/theme';

type SectionProps = {
  title: string;
  /** Optional trailing action, e.g. "See all". */
  actionLabel?: string;
  onActionPress?: () => void;
  children: ReactNode;
};

/** A titled block with consistent spacing between screen sections. */
export function Section({ title, actionLabel, onActionPress, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text variant="heading">{title}</Text>

        {actionLabel ? (
          <PressableScale
            accessibilityRole="button"
            onPress={onActionPress}
            feedback="tap"
            // A short label needs a firmer dip than a full-width row to read as
            // one at all.
            scaleTo={0.94}
            hitSlop={8}>
            <Text variant="captionStrong" color="accent">
              {actionLabel}
            </Text>
          </PressableScale>
        ) : null}
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.md, marginTop: Spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
