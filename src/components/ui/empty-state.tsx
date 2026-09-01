import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/theme';

type EmptyStateProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** One line on why the list is empty, or what to do about it. */
  description?: string;
  /** Swaps the icon for a spinner — the same block, still settling. */
  loading?: boolean;
  /** Reddens the icon well for a failed load rather than an empty one. */
  tone?: 'neutral' | 'danger';
  /** Drops the card chrome, for screens that place this on their own surface. */
  bare?: boolean;
};

/**
 * The one way a screen says "there is nothing here".
 *
 * Every list in the app can legitimately be empty — a family of one has no
 * messages, no tasks and no shared locations — so this is a first-class state,
 * not an edge case.
 */
export function EmptyState({
  icon,
  title,
  description,
  loading = false,
  tone = 'neutral',
  bare = false,
}: EmptyStateProps) {
  const { colors } = useTheme();

  const wellColor = tone === 'danger' ? colors.dangerSoft : colors.surfaceMuted;
  const markColor = tone === 'danger' ? colors.danger : colors.textTertiary;

  const body = (
    <View style={styles.body}>
      <View style={[styles.well, { backgroundColor: wellColor }]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Ionicons name={icon} size={22} color={markColor} />
        )}
      </View>

      <Text variant="bodyStrong" color="textSecondary" center>
        {title}
      </Text>

      {description ? (
        <Text variant="caption" color="textTertiary" center>
          {description}
        </Text>
      ) : null}
    </View>
  );

  return bare ? body : <Card style={styles.card}>{body}</Card>;
}

const styles = StyleSheet.create({
  card: { paddingVertical: Spacing.xl },
  body: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  well: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
});
