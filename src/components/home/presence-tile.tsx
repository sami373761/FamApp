import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { firstNameOf, isRecentlySynced, relativeTime } from '@/data/format';
import type { FamilyMember } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

type PresenceTileProps = {
  members: FamilyMember[];
  /** Marks your own chip; resolved by the screen from `useAuth()`. */
  currentUserId?: string;
  /** Opens the Map. */
  onSelectMember: (memberId: string) => void;
  /** "Locate": the same forced write the Map's button performs. */
  onLocate: () => void;
  canLocate: boolean;
  isLocating: boolean;
  isLoading: boolean;
  /** True when the user has no family — the empty copy differs. */
  hasFamily: boolean;
};

/**
 * The large tile: who is sharing a position, and the button that adds yours.
 *
 * A chip per member, carrying the two things a `locations` row can say — how
 * long ago it was written, and whether that was recent enough to still be
 * syncing (the avatar ring). Somebody with no row keeps their chip and says so;
 * they are in the family either way.
 */
export function PresenceTile({
  members,
  currentUserId,
  onSelectMember,
  onLocate,
  canLocate,
  isLocating,
  isLoading,
  hasFamily,
}: PresenceTileProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const sharing = members.filter((member) => member.location !== null).length;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="heading">{t('presenceTile.title')}</Text>
          <Text variant="caption" color="textSecondary">
            {members.length === 0
              ? t('presenceTile.nobody')
              : t('presenceTile.sharingCount', { sharing, total: members.length })}
          </Text>
        </View>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('presenceTile.locateA11y')}
          accessibilityState={{ disabled: !canLocate || isLocating, busy: isLocating }}
          disabled={!canLocate || isLocating}
          onPress={onLocate}
          // A forced write to `locations`, so it is felt like one.
          feedback="press"
          style={[
            styles.locate,
            { backgroundColor: canLocate ? colors.primary : colors.surfaceMuted },
          ]}>
          {isLocating ? (
            <ActivityIndicator size="small" color={canLocate ? colors.onPrimary : colors.textTertiary} />
          ) : (
            <Ionicons
              name="locate"
              size={16}
              color={canLocate ? colors.onPrimary : colors.textTertiary}
            />
          )}
          <Text variant="captionStrong" color={canLocate ? 'onPrimary' : 'textTertiary'}>
            {t('presenceTile.locate')}
          </Text>
        </PressableScale>
      </View>

      {isLoading ? (
        <EmptyState bare loading icon="people-outline" title={t('presenceTile.loading')} />
      ) : members.length === 0 ? (
        <EmptyState
          bare
          icon="people-outline"
          title={hasFamily ? t('presenceTile.noMembers') : t('presenceTile.noFamily')}
          description={
            hasFamily ? t('presenceTile.noMembersBody') : t('presenceTile.noFamilyBody')
          }
        />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}>
          {members.map((member) => (
            <PressableScale
              key={member.id}
              accessibilityRole="button"
              accessibilityLabel={t('presenceTile.memberA11y', {
                name: firstNameOf(i18n, member.displayName),
              })}
              onPress={() => onSelectMember(member.id)}
              feedback="tap"
              style={styles.chip}>
              <Avatar
                initials={member.initials}
                colorIndex={member.colorIndex}
                avatar={member.avatar}
                size="lg"
                online={member.presence === 'online'}
                ring={isRecentlySynced(member.location)}
              />

              <Text variant="captionStrong" numberOfLines={1} style={styles.chipLabel}>
                {member.id === currentUserId ? t('common.you') : firstNameOf(i18n, member.displayName)}
              </Text>

              {/* Coordinates belong on the Map card; here the only honest
                  summary of a `locations` row is how old it is. */}
              <Text variant="label" color="textTertiary" numberOfLines={1} style={styles.chipLabel}>
                {member.location
                  ? relativeTime(i18n, member.location.updatedAt)
                  : t('presenceTile.noLocation')}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerText: { flex: 1, gap: 2 },
  locate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  strip: { gap: Spacing.lg, paddingRight: Spacing.xs },
  chip: { alignItems: 'center', gap: Spacing.xs, width: 76 },
  chipLabel: { textAlign: 'center', maxWidth: 76 },
});
