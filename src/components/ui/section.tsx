import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
          <Pressable accessibilityRole="button" onPress={onActionPress} hitSlop={8}>
            <Text variant="captionStrong" color="accent">
              {actionLabel}
            </Text>
          </Pressable>
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
