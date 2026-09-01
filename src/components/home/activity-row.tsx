import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { relativeTime } from '@/data/format';
import type { ActivityEvent, ActivityKind, FamilyMember } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { MemberColors, Spacing } from '@/theme';

/** Icon per activity kind, so the feed is scannable without reading each line. */
const KIND_ICON: Record<ActivityKind, keyof typeof Ionicons.glyphMap> = {
  task: 'checkmark-circle',
  message: 'chatbubble-ellipses',
};

type ActivityRowProps = {
  event: ActivityEvent;
  /** Resolved by the caller — undefined for a member who has since left. */
  member?: FamilyMember;
  isLast?: boolean;
};

export function ActivityRow({ event, member, isLast = false }: ActivityRowProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const accent = MemberColors[(member?.colorIndex ?? 0) % MemberColors.length];

  return (
    <View style={styles.row}>
      <View style={styles.timeline}>
        <View style={[styles.dot, { backgroundColor: accent }]}>
          <Ionicons name={KIND_ICON[event.kind]} size={12} color="#FFFFFF" />
        </View>
        {/* Connector is omitted on the last row so the line does not dangle. */}
        {!isLast ? <View style={[styles.line, { backgroundColor: colors.separator }]} /> : null}
      </View>

      <View style={[styles.body, isLast && styles.bodyLast]}>
        <Text variant="body">{event.text}</Text>
        <Text variant="caption" color="textTertiary">
          {relativeTime(i18n, event.at)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.md },
  timeline: { alignItems: 'center' },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, marginVertical: 2 },
  body: { flex: 1, gap: 2, paddingBottom: Spacing.lg },
  bodyLast: { paddingBottom: 0 },
});
