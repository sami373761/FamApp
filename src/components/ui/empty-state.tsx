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
 * not an edge case. It is typeset like one: the title takes the same weight a
 * section heading would and the full text colour, because "No tasks yet" is the
 * screen's answer rather than a footnote about the absence of one. The
 * description stays tertiary and is held to a readable measure, so the block
 * reads as a centred column instead of a paragraph stretched across a tablet.
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
          <Ionicons name={icon} size={24} color={markColor} />
        )}
      </View>

      <Text variant="subheading" center>
        {title}
      </Text>

      {description ? (
        <Text variant="caption" color="textTertiary" center style={styles.description}>
          {description}
        </Text>
      ) : null}
    </View>
  );

  return bare ? body : <Card style={styles.card}>{body}</Card>;
}

const styles = StyleSheet.create({
  // An empty block needs room around it or it reads as a failed row rather than
  // a deliberate state.
  card: { paddingVertical: Spacing.xxl },
  body: { alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.lg },
  well: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // Groups the mark with the title it introduces, rather than spacing all
    // three elements evenly and leaving the eye nothing to start on.
    marginBottom: Spacing.md,
  },
  // Roughly forty characters a line — the measure a centred column stays
  // readable at, and what stops one long sentence spanning a tablet.
  description: { maxWidth: 320 },
});
