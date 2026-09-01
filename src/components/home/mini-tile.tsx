import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing, type ColorToken } from '@/theme';

export type MiniTileTone = Extract<ColorToken, 'primary' | 'warning' | 'danger' | 'info'>;

type MiniTileProps = {
  icon: keyof typeof Ionicons.glyphMap;
  tone: MiniTileTone;
  /** What this tile is about — "Next up", "Latest message". */
  label: string;
  /** The row itself: a task title, a message preview. */
  title: string;
  /** Its one qualifier: a deadline, a sender and a time. */
  meta?: string;
  /**
   * True when `title` is standing in for rows that do not exist yet. It is
   * greyed rather than replaced, so the tile keeps its place in the grid
   * instead of the whole row reflowing when the first task arrives.
   */
  empty?: boolean;
  onPress: () => void;
};

/** Half-width tile in the Home bento grid: one row, said in three lines. */
export function MiniTile({ icon, tone, label, title, meta, empty = false, onPress }: MiniTileProps) {
  const { colors } = useTheme();
  const softToken = `${tone}Soft` as ColorToken;

  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.iconWell, { backgroundColor: colors[softToken] }]}>
          <Ionicons name={icon} size={16} color={colors[tone]} />
        </View>
        <Text variant="label" color="textTertiary" numberOfLines={1} style={styles.label}>
          {label.toUpperCase()}
        </Text>
      </View>

      <Text variant="bodyStrong" color={empty ? 'textTertiary' : 'text'} numberOfLines={2}>
        {title}
      </Text>

      {meta ? (
        <Text variant="label" color="textTertiary" numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 150, gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconWell: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, letterSpacing: 0.5 },
});
