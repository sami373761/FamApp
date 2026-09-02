/**
 * "Family Events & Birthdays" — what the family has coming up.
 *
 * A block of rows like every other tile on Home, and every row is an
 * *occurrence* folded out of rows the screen already holds: a member's
 * `birth_date` rolled to its next return, or a `family_events` date. Nothing
 * here is stored as a countdown, because a countdown written down is wrong
 * tomorrow — the same reason `membersAtPlaces` is a fold and not a visit log.
 *
 * **The two sources are deliberately not labelled as two lists.** Somebody
 * looking at this wants to know what is next, not "the next birthday" and "the
 * next event" side by side. They are told apart by their glyph and by the row's
 * own subtitle, which is where the tier boundary becomes visible without being
 * announced: birthdays keep appearing for a free family because they cost the
 * schema nothing, and the shared calendar is what Gold widens.
 *
 * A birthday row is **not pressable**. It has no `family_events` row to delete,
 * and the date behind it is somebody's own identity column — editable by them
 * in Edit profile and nowhere else. Offering a delete that could only fail, or
 * an edit that rewrites another member's profile, would be worse than the row
 * being inert.
 */

import { Ionicons } from '@expo/vector-icons';

import { EVENT_ICONS } from '@/components/family/event-modal';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { StyleSheet, View } from 'react-native';

import type { EventOccurrence } from '@/data/events';
import { firstNameOf } from '@/data/format';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

/** Inside this many days a row is worth pointing at rather than merely listing. */
const IMMINENT_DAYS = 7;

type EventsCardProps = {
  occurrences: EventOccurrence[];
  /** Whether the "Add" action opens the form or the ceiling notice. */
  canAdd: boolean;
  /** False for a solo user: `family_events.family_id` is `not null`. */
  hasFamily: boolean;
  isLoading: boolean;
  /** Opens the composer, or the `locked` face when `canAdd` is false. */
  onAdd: () => void;
  /** Long press on a `family_events` row — asks the screen to confirm a delete. */
  onRemove: (eventId: string) => void;
};

export function EventsCard({
  occurrences,
  canAdd,
  hasFamily,
  isLoading,
  onAdd,
  onRemove,
}: EventsCardProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="heading">{t('events.title')}</Text>
          <Text variant="caption" color="textSecondary">
            {occurrences.length === 0
              ? t('events.subtitleEmpty')
              : t('events.subtitle', { count: occurrences.length })}
          </Text>
        </View>

        {/*
          Withheld entirely with no family rather than dimmed, because the row
          it would add cannot exist: `family_events.family_id` is `not null`, so
          there is nothing for a solo user to be told to upgrade *to*. Past the
          free ceiling it stays live and opens the notice instead — that is the
          ceiling being explained rather than the control vanishing.
        */}
        {hasFamily ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('events.add')}
            onPress={onAdd}
            feedback="tap"
            // A short text action needs a firmer dip than a full-width row to
            // register as one at all — the same value `Section`'s action takes.
            scaleTo={0.94}
            hitSlop={8}
            style={styles.add}>
            <Ionicons
              name={canAdd ? 'add-circle-outline' : 'lock-closed-outline'}
              size={16}
              color={colors.accent}
            />
            <Text variant="captionStrong" color="accent">
              {t('events.add')}
            </Text>
          </PressableScale>
        ) : null}
      </View>

      {isLoading ? (
        <EmptyState bare loading icon="calendar-outline" title={t('events.loading')} />
      ) : occurrences.length === 0 ? (
        <EmptyState
          bare
          icon="calendar-outline"
          title={hasFamily ? t('events.emptyTitle') : t('events.emptyNoFamilyTitle')}
          description={hasFamily ? t('events.emptyBody') : t('events.emptyNoFamilyBody')}
        />
      ) : (
        <View>
          {occurrences.map((occurrence, index) => (
            <OccurrenceRow
              key={occurrence.id}
              occurrence={occurrence}
              isLast={index === occurrences.length - 1}
              onRemove={onRemove}
            />
          ))}
        </View>
      )}
    </Card>
  );
}

function OccurrenceRow({
  occurrence,
  isLast,
  onRemove,
}: {
  occurrence: EventOccurrence;
  isLast: boolean;
  onRemove: (eventId: string) => void;
}) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;

  const isBirthday = occurrence.kind === 'birthday';
  // Only a stored row can be removed. A birthday has none — see the note at the
  // top of this file for why offering one anyway would be the wrong answer.
  const canRemove = !isBirthday;

  /**
   * The countdown, and it is three cases rather than a number with a unit:
   * "Today" and "Tomorrow" are what somebody actually says, and a row reading
   * "in 0 days" would be a computer talking.
   */
  const countdown =
    occurrence.daysUntil === 0
      ? t('events.today')
      : occurrence.daysUntil === 1
        ? t('events.tomorrow')
        : t('events.inDays', { count: occurrence.daysUntil });

  /**
   * The title, resolved here because `data/events.ts` produces no copy — it
   * carries the member's raw name and this is where "Mehmet's birthday" is
   * said in whichever of the ten languages the reader has chosen. An unnamed
   * member falls back rather than rendering "'s birthday".
   */
  const title = isBirthday
    ? t('events.birthdayOf', { name: firstNameOf(i18n, occurrence.title) })
    : occurrence.title;

  /**
   * Under the title: how old they will be, or that the date recurs. Null in
   * both cases where the fact is not known — a birth year the same as the
   * occurrence's, or a one-off — because printing an age nobody supplied is
   * inventing a fact about a person.
   */
  const detail =
    occurrence.turning !== null
      ? isBirthday
        ? t('events.turning', { count: occurrence.turning })
        : t('events.yearsOn', { count: occurrence.turning })
      : occurrence.isAnnual
        ? t('events.annual')
        : t('events.once');

  // Inside a week is the horizon a family plans against, so it is the one that
  // earns the accent. Everything further out is a list, not a warning.
  const imminent = occurrence.daysUntil <= IMMINENT_DAYS;

  return (
    <PressableScale
      accessibilityRole={canRemove ? 'button' : undefined}
      accessibilityLabel={`${title} · ${countdown}`}
      accessibilityHint={canRemove ? t('events.removeHint') : undefined}
      // A tap does nothing — this is a list, not a menu — so it must not buzz.
      // Only the long press is a gesture, and only on a row that has a row.
      feedback="none"
      disabled={!canRemove}
      onLongPress={canRemove ? () => onRemove(occurrence.id) : undefined}
      highlightColor={canRemove ? colors.surfaceMuted : undefined}
      highlightRadius={Radius.md}
      style={styles.row}>
      <View
        style={[
          styles.icon,
          { backgroundColor: imminent ? colors.primarySoft : colors.surfaceMuted },
        ]}>
        <Ionicons
          name={isBirthday ? 'gift-outline' : EVENT_ICONS[occurrence.type]}
          size={18}
          color={imminent ? colors.primary : colors.textTertiary}
        />
      </View>

      <View
        style={[
          styles.body,
          !isLast && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.separator,
          },
        ]}>
        <View style={styles.labels}>
          <Text variant="body" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            {detail}
          </Text>
        </View>

        {/*
          The countdown is the answer this card exists to give, so it takes the
          weight — and the accent only when it is close enough to act on.
        */}
        <Text variant="captionStrong" color={imminent ? 'primary' : 'textSecondary'}>
          {countdown}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerText: { flex: 1, gap: 2 },
  add: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  labels: { flex: 1, gap: 2 },
});
