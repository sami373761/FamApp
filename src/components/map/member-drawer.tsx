import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { isRecentlySynced, memberName, presenceLabel, relativeTime } from '@/data/format';
import { formatCoordinates } from '@/data/geo';
import type { FamilyMember } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

type MemberDrawerProps = {
  /** The whole roster — somebody with no position is still in the family. */
  members: FamilyMember[];
  /** The member the peek describes; resolved by the screen. */
  selected: FamilyMember | null;
  /** Set only once someone has been tapped — that is what centres the canvas. */
  focusedId: string | null;
  currentUserId?: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Called only for a member who has a position to centre on. */
  onSelect: (memberId: string) => void;
  isLoading: boolean;
  hasFamily: boolean;
};

/**
 * The peeking drawer over the map.
 *
 * Collapsed it shows one member — whoever is selected — which is the same card
 * the map used to end with. Pulled open it becomes the roster, and tapping a
 * row re-centres the canvas on that person's coordinates and thickens their
 * pin. Tapping the focused row again lets go, back to the family view.
 *
 * A member with no `locations` row keeps their line and says so: they are in
 * the family, they are simply not on the canvas, and inventing a pin for them
 * is exactly what this app does not do.
 */
export function MemberDrawer({
  members,
  selected,
  focusedId,
  currentUserId,
  expanded,
  onToggleExpanded,
  onSelect,
  isLoading,
  hasFamily,
}: MemberDrawerProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;

  return (
    <Card padded={false} style={styles.drawer}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={expanded ? t('drawer.hide') : t('drawer.show')}
        accessibilityState={{ expanded }}
        onPress={onToggleExpanded}
        feedback="tap"
        // The grabber is a 5pt line in a wide strip; dipping the strip is what
        // makes the press visible at all.
        scaleTo={0.96}
        style={styles.handleArea}>
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
      </PressableScale>

      {selected ? (
        <View style={styles.peek}>
          <Avatar
            initials={selected.initials}
            colorIndex={selected.colorIndex}
            avatar={selected.avatar}
            size="lg"
            online={selected.presence === 'online'}
            ring={isRecentlySynced(selected.location)}
          />

          <View style={styles.peekText}>
            <View style={styles.peekTitle}>
              <Text variant="subheading" numberOfLines={1} style={styles.shrink}>
                {memberName(i18n, selected)}
              </Text>
              {/*
                Presence is "how old is this pin", which is not a question worth
                asking about your own — you are here.
              */}
              {selected.id === currentUserId ? (
                <Badge label={t('common.you')} tone="primary" />
              ) : (
                <Badge
                  label={presenceLabel(i18n, selected.presence)}
                  tone={selected.presence === 'online' ? 'success' : 'neutral'}
                />
              )}
            </View>

            {/*
              `locations` stores coordinates and nothing else — there is no
              place name to show, and geocoding one would be inventing data.
            */}
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {selected.location ? formatCoordinates(selected.location) : ''}
            </Text>

            <View style={styles.peekMeta}>
              <Ionicons name="time-outline" size={14} color={colors.textTertiary} />
              <Text variant="label" color="textTertiary">
                {selected.location
                  ? t('drawer.updated', { time: relativeTime(i18n, selected.location.updatedAt) })
                  : ''}
              </Text>
            </View>
          </View>

          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={expanded ? t('drawer.hide') : t('drawer.show')}
            accessibilityState={{ expanded }}
            onPress={onToggleExpanded}
            feedback="tap"
            scaleTo={0.9}
            hitSlop={8}
            style={[styles.toggle, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons
              name={expanded ? 'chevron-down' : 'chevron-up'}
              size={18}
              color={colors.textSecondary}
            />
          </PressableScale>
        </View>
      ) : (
        <View style={styles.empty}>
          <EmptyState
            bare
            loading={isLoading}
            icon="location-outline"
            title={isLoading ? t('drawer.loading') : t('drawer.emptyTitle')}
            description={
              isLoading
                ? undefined
                : hasFamily
                  ? t('drawer.emptyBodyFamily')
                  : t('drawer.emptyBodySolo')
            }
          />
        </View>
      )}

      {expanded && members.length > 0 ? (
        <View style={[styles.list, { borderTopColor: colors.separator }]}>
          <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
            {members.map((member, index) => {
              const isFocused = member.id === focusedId;
              const canFocus = member.location !== null;

              return (
                <PressableScale
                  key={member.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isFocused, disabled: !canFocus }}
                  accessibilityLabel={
                    canFocus
                      ? t('drawer.centreA11y', { name: memberName(i18n, member) })
                      : t('drawer.notSharingA11y', { name: memberName(i18n, member) })
                  }
                  disabled={!canFocus}
                  onPress={() => onSelect(member.id)}
                  // Centring the camera on somebody is moving within the
                  // roster, not committing to anything.
                  feedback="select"
                  highlightColor={colors.surfaceMuted}
                  style={[
                    styles.row,
                    index < members.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.separator,
                    },
                    // The focused row keeps its standing fill; the highlight
                    // above is the transient one that answers the finger.
                    isFocused && { backgroundColor: colors.surfaceMuted },
                  ]}>
                  <Avatar
                    initials={member.initials}
                    colorIndex={member.colorIndex}
                    avatar={member.avatar}
                    online={member.presence === 'online'}
                    ring={isRecentlySynced(member.location)}
                  />

                  <View style={styles.rowText}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {member.id === currentUserId
                        ? t('drawer.selfName', { name: memberName(i18n, member) })
                        : memberName(i18n, member)}
                    </Text>
                    <Text variant="caption" color="textSecondary" numberOfLines={1}>
                      {member.location
                        ? t('drawer.position', {
                            coordinates: formatCoordinates(member.location),
                            time: relativeTime(i18n, member.location.updatedAt),
                          })
                        : t('drawer.notSharing')}
                    </Text>
                  </View>

                  {canFocus ? (
                    <Ionicons
                      name={isFocused ? 'locate' : 'chevron-forward'}
                      size={16}
                      color={isFocused ? colors.primary : colors.textTertiary}
                    />
                  ) : null}
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  drawer: { overflow: 'hidden', borderRadius: Radius.xl },
  handleArea: { alignItems: 'center', paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  grabber: { width: 36, height: 4, borderRadius: Radius.pill },
  peek: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  peekText: { flex: 1, gap: 2 },
  peekTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  peekMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  shrink: { flexShrink: 1 },
  toggle: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  list: { borderTopWidth: StyleSheet.hairlineWidth },
  // Caps the open drawer at roughly four rows, so the map keeps most of the
  // screen and the rest of the roster scrolls.
  listScroll: { maxHeight: 260 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
});
