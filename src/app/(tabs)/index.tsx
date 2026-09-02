/**
 * Home: the family in one screen, as a bento grid.
 *
 * Five blocks, largest first — a status pill that carries whatever is most
 * worth acting on right now, a wide tile of everyone's positions, a pair of
 * mini tiles for the next task and the last thing said, the family's next dates,
 * and the activity feed underneath. Nothing here is a summary of a summary:
 * every line is a row from `FamilyContext`, and a family with no rows gets a
 * real zero rather than a placeholder. The counters the old overview grid showed
 * live inside the tiles that own them.
 *
 * The dates card is the one block whose rows are not all rows: a birthday has
 * no table, it is `profiles.birth_date` rolled forward by `upcomingEvents`. That
 * is a *fold*, not a fixture — it renders nothing the schema cannot supply, and
 * a member who has given no date simply has no line.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EventModal, type EventModalMode } from '@/components/family/event-modal';
import { ActivityRow } from '@/components/home/activity-row';
import { EventsCard } from '@/components/home/events-card';
import { LiveStatusPill, type StatusTone } from '@/components/home/live-status-pill';
import { MiniTile } from '@/components/home/mini-tile';
import { PresenceTile } from '@/components/home/presence-tile';
import { PLACE_ICONS } from '@/components/map/place-pin';
import { PremiumBanner } from '@/components/premium/premium-banner';
import { Avatar, Card, EmptyState, GradientSurface, Screen, Text } from '@/components/ui';
import { deriveActivity } from '@/data/activity';
import { HOME_EVENT_LIMIT, upcomingEvents } from '@/data/events';
import {
  dueLabel,
  firstNameOf,
  isDueToday,
  isOverdue,
  isRecentlySynced,
  relativeTime,
} from '@/data/format';
import { membersAtPlaces, placeCategoryLabel, placeSentence, type MemberAtPlace } from '@/data/places';
import { canAddAnotherEvent } from '@/data/premium';
import type { FamilyMember, FamilyTask } from '@/data/types';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useLocation } from '@/hooks/useLocation';
import { useTabBarMetrics } from '@/hooks/use-tab-bar';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

/** What the pill at the top of the screen is currently reporting. */
type LiveStatus = {
  icon: keyof typeof Ionicons.glyphMap;
  tone: StatusTone;
  label: string;
  detail: string;
  onPress: () => void;
};

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { user, profile } = useAuth();
  const { canShare, isSyncing, syncNow } = useLocation();
  const { clearance } = useTabBarMetrics();
  const {
    family,
    members,
    messages,
    tasks,
    places,
    events,
    currentMember,
    getMember,
    isLoading,
    isRefreshing,
    error,
    isPremium,
    refresh,
    createEvent,
    deleteEvent,
  } = useFamily();

  /**
   * The event sheet's one open face, and the row `delete` is asking about.
   *
   * One `Sheet` with three faces rather than three sheets — presenting a modal
   * while another is dismissing in the same frame is unreliable on iOS, which
   * is the rule Chat's single panel and the Map's place sheet are both built
   * around.
   */
  const [eventMode, setEventMode] = useState<EventModalMode>('none');
  const [eventTarget, setEventTarget] = useState<string | null>(null);

  // Read from the profile rather than from `family`, which is also null while a
  // real family is loading — this must not flicker "you have no family".
  const hasFamily = !!profile?.family_id;

  // Every value below is a fold over rows that came from the database, so an
  // empty family reads zero rather than falling back to a fixture.
  const openTasks = useMemo(
    () => tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress'),
    [tasks],
  );

  /** The open task falling due soonest — `expires_at` is the only deadline one has. */
  const nextTask = useMemo(
    () =>
      openTasks.reduce<FamilyTask | null>(
        (soonest, task) =>
          !soonest || task.expiresAt.localeCompare(soonest.expiresAt) < 0 ? task : soonest,
        null,
      ),
    [openTasks],
  );

  /**
   * Oldest-last, so the newest message is the last element — but the newest
   * *sent* one, which is not the same thing while a photo is uploading. A
   * pending bubble belongs to the sender's own chat stream, not to a tile that
   * tells the family what the last thing said was. See `PendingUpload`.
   */
  const latestMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (!messages[index].pending) return messages[index];
    }

    return null;
  }, [messages]);

  /** Whoever wrote a position most recently — the map's freshest pin. */
  const latestLocated = useMemo(
    () =>
      members.reduce<FamilyMember | null>((newest, member) => {
        if (!member.location) return newest;
        if (!newest?.location) return member;

        return member.location.updatedAt.localeCompare(newest.location.updatedAt) > 0
          ? member
          : newest;
      }, null),
    [members],
  );

  /**
   * Whoever is standing at a saved place right now, most recent fix first.
   *
   * Freshness is checked before proximity, not after: `isRecentlySynced` is one
   * tracking interval, the same bar the "Live now" line below holds itself to.
   * A pin that has not been restamped in hours is not evidence that anybody is
   * still there, and "Sami at Work" is a much stronger claim than a timestamp.
   */
  const atPlace = useMemo(
    () =>
      membersAtPlaces(
        members.filter((member) => isRecentlySynced(member.location)),
        places,
      ).reduce<MemberAtPlace | null>(
        (newest, candidate) =>
          !newest ||
          candidate.member.location!.updatedAt.localeCompare(newest.member.location!.updatedAt) > 0
            ? candidate
            : newest,
        null,
      ),
    [members, places],
  );

  const activity = useMemo(
    () => deriveActivity({ i18n, messages, tasks, members }),
    [i18n, messages, tasks, members],
  );

  /**
   * The next few dates, folded from the roster's birth dates and the family's
   * own calendar and sorted together — see `upcomingEvents`. Recomputed rather
   * than stored, because a countdown written down is wrong tomorrow.
   *
   * `members` and `events` are the only dependencies: `now` is left to default,
   * so the list is as fresh as the render. That is right for a screen somebody
   * opens rather than leaves open — and a card that ticked over at midnight
   * without one would need a timer to say nothing new.
   */
  const occurrences = useMemo(
    () => upcomingEvents({ members, events, limit: HOME_EVENT_LIMIT }),
    [members, events],
  );

  /** The row the delete face is describing; null once it has been removed. */
  const eventToRemove = useMemo(
    () => events.find((event) => event.id === eventTarget) ?? null,
    [events, eventTarget],
  );

  const nameFor = useCallback(
    (member: FamilyMember) =>
      member.id === user?.id ? t('common.you') : firstNameOf(i18n, member.displayName),
    [i18n, t, user?.id],
  );

  /**
   * One slot, filled by whichever row is most worth acting on: a deadline that
   * has arrived, then somebody standing at a saved place, then the map moving
   * at all, then what the family is. Each one navigates to the tab that owns
   * the row it is describing.
   */
  const status: LiveStatus = useMemo(() => {
    const openMap = () => router.push('/(tabs)/map');

    // Nothing has arrived yet, and every count below would read as a real zero.
    if (isLoading) {
      return {
        icon: 'ellipsis-horizontal',
        tone: 'info',
        label: t('home.statusFamily'),
        detail: t('home.statusLoading'),
        onPress: openMap,
      };
    }

    if (nextTask) {
      const overdue = isOverdue(nextTask.expiresAt);

      if (overdue || isDueToday(nextTask.expiresAt)) {
        return {
          icon: 'alarm',
          tone: overdue ? 'danger' : 'warning',
          label: overdue ? t('home.statusOverdue') : t('home.statusDueToday'),
          detail: nextTask.title,
          onPress: () => router.push('/(tabs)/tasks'),
        };
      }
    }

    /*
      A named place outranks a bare position, because it is the same fact said
      better: "Sami at Mehmet's Home" is what the coordinates underneath it
      mean. It is not stored anywhere — the match is recomputed from the two
      row sets every time either changes, which is why it can never be stale in
      the way a visit log would be.
    */
    if (atPlace) {
      const owner = getMember(atPlace.place.ownerId);

      return {
        icon: PLACE_ICONS[atPlace.place.category],
        tone: 'primary',
        label: placeCategoryLabel(i18n, atPlace.place.category),
        detail: placeSentence(i18n, {
          name: nameFor(atPlace.member),
          place: atPlace.place,
          // Null when whoever saved it has since left the family: the place is
          // still real, it simply has nobody to be named after any more.
          ownerName: owner ? firstNameOf(i18n, owner.displayName) : null,
          isOwnedByViewer: atPlace.place.ownerId === user?.id,
          isOwnedBySubject: atPlace.place.ownerId === atPlace.member.id,
        }),
        onPress: () =>
          router.push({ pathname: '/(tabs)/map', params: { member: atPlace.member.id } }),
      };
    }

    if (latestLocated?.location && isRecentlySynced(latestLocated.location)) {
      return {
        icon: 'navigate',
        tone: 'info',
        label: t('home.statusLive'),
        detail: t('home.statusLiveDetail', {
          name: nameFor(latestLocated),
          time: relativeTime(i18n, latestLocated.location.updatedAt),
        }),
        onPress: openMap,
      };
    }

    if (!hasFamily) {
      return {
        icon: 'people-circle',
        tone: 'info',
        label: t('home.statusSolo'),
        detail: t('home.statusSoloDetail'),
        onPress: () => router.push('/add-family'),
      };
    }

    const sharing = members.filter((member) => member.location !== null).length;
    const roster = t('home.memberCount', { count: members.length });

    return {
      icon: 'people',
      tone: 'primary',
      label: t('home.statusFamily'),
      detail:
        sharing > 0
          ? t('home.rosterSharing', { roster, count: sharing })
          : t('home.rosterNobody', { roster }),
      onPress: openMap,
    };
  }, [
    atPlace,
    getMember,
    hasFamily,
    i18n,
    isLoading,
    latestLocated,
    members,
    nameFor,
    nextTask,
    router,
    t,
    user?.id,
  ]);

  const messageSender = latestMessage ? getMember(latestMessage.senderId) : undefined;

  return (
    <Screen
      scroll
      onRefresh={() => void refresh()}
      refreshing={isRefreshing}
      contentContainerStyle={{ paddingBottom: clearance }}>
      {/* The one banner in the app, so it takes the brand wash: a green that
          has all but faded by the far corner. Every block under it stays white,
          which is what keeps this reading as the top of the screen. */}
      <GradientSurface tone="primary" style={styles.header}>
        <View style={styles.greeting}>
          <Text variant="caption" color="textSecondary">
            {t('home.welcome')}
          </Text>
          <Text variant="title">{family?.name ?? t('common.yourFamily')}</Text>
        </View>

        {currentMember ? (
          <Avatar
            initials={currentMember.initials}
            colorIndex={currentMember.colorIndex}
            avatar={currentMember.avatar}
            size="lg"
            online={currentMember.presence === 'online'}
            ring={isRecentlySynced(currentMember.location)}
          />
        ) : null}
      </GradientSurface>

      {error ? (
        <Card style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
          <Text variant="caption" color="danger" style={styles.flex}>
            {error}
          </Text>
        </Card>
      ) : null}

      <View style={styles.bento}>
        <LiveStatusPill
          icon={status.icon}
          tone={status.tone}
          label={status.label}
          detail={status.detail}
          onPress={status.onPress}
        />

        <PresenceTile
          members={members}
          currentUserId={user?.id}
          // Opens the Map already centred on them — the same focus the map's
          // own drawer sets, which is why it travels as a route param. Somebody
          // with no position has nothing to centre on, so their chip just opens
          // the map.
          onSelectMember={(memberId) =>
            router.push(
              members.find((member) => member.id === memberId)?.location
                ? { pathname: '/(tabs)/map', params: { member: memberId } }
                : '/(tabs)/map',
            )
          }
          onLocate={() => void syncNow()}
          canLocate={canShare}
          isLocating={isSyncing}
          isLoading={isLoading}
          hasFamily={hasFamily}
        />

        <View style={styles.split}>
          <MiniTile
            icon="checkbox"
            tone="warning"
            label={t('home.nextUp')}
            title={nextTask ? nextTask.title : t('home.noOpenTasks')}
            meta={
              nextTask
                ? dueLabel(i18n, nextTask.expiresAt)
                : t('home.completedCount', {
                    count: tasks.filter((task) => task.status === 'completed').length,
                  })
            }
            empty={!nextTask}
            onPress={() => router.push('/(tabs)/tasks')}
          />

          <MiniTile
            icon="chatbubbles"
            tone="info"
            label={t('home.latest')}
            title={latestMessage ? (latestMessage.content ?? t('common.photo')) : t('home.noMessages')}
            meta={
              latestMessage
                ? t('home.latestMeta', {
                    // The app's own name is not translated; a `system` message
                    // was written by FamApp rather than by a member.
                    name:
                      latestMessage.type === 'system'
                        ? 'FamApp'
                        : messageSender
                          ? nameFor(messageSender)
                          : t('common.someone'),
                    time: relativeTime(i18n, latestMessage.createdAt),
                  })
                : t('home.sayHello')
            }
            empty={!latestMessage}
            onPress={() => router.push('/(tabs)/chat')}
          />
        </View>

        {/*
          The upgrade offer. It sits below the tiles rather than under the
          header, because two washes stacked at the top of a screen stop
          reading as "the top of the screen" — and because the family's own
          rows are what someone opened Home for. It is the app's only promo
          surface; there is no second one, and none should be added.

          Withheld once the family is on Gold — an advert for what somebody
          already pays for is the clearest way to look like the app does not
          know. Profile keeps its row, because that one is where a subscription
          is *managed* rather than sold, and it says "Active" instead.
        */}
        {/*
          Under the two mini tiles and above the promo, which is where a
          countdown belongs: it is the family's own rows, and everything below
          this point is either an advert or a log. The card carries its own
          "Add" rather than being wrapped in a `Section`, because the action
          belongs to the card's content and not to a heading above it.
        */}
        <EventsCard
          occurrences={occurrences}
          // Whether "Add" opens the form or the ceiling notice. The trigger is
          // what actually decides — this only decides which face is opened
          // first, so nobody fills in a form that cannot be saved.
          canAdd={canAddAnotherEvent(isPremium, events)}
          hasFamily={hasFamily}
          isLoading={isLoading}
          onAdd={() => setEventMode(canAddAnotherEvent(isPremium, events) ? 'form' : 'locked')}
          onRemove={(eventId) => {
            setEventTarget(eventId);
            setEventMode('delete');
          }}
        />

        {isPremium ? null : (
          <PremiumBanner
            title={t('premium.bannerTitle')}
            description={t('premium.bannerBody')}
            onPress={() => router.push('/premium')}
          />
        )}

        <Card style={styles.feed}>
          <Text variant="heading">{t('home.activity')}</Text>

          {isLoading ? (
            <EmptyState bare loading icon="pulse-outline" title={t('home.activityLoading')} />
          ) : activity.length === 0 ? (
            <EmptyState
              bare
              icon="pulse-outline"
              title={t('home.activityEmptyTitle')}
              description={t('home.activityEmptyBody')}
            />
          ) : (
            <View>
              {activity.map((event, index) => (
                <ActivityRow
                  key={event.id}
                  event={event}
                  member={getMember(event.memberId)}
                  isLast={index === activity.length - 1}
                />
              ))}
            </View>
          )}
        </Card>
      </View>

      <EventModal
        mode={eventMode}
        target={eventToRemove}
        eventCount={events.length}
        onCreate={createEvent}
        onDelete={deleteEvent}
        /*
          Closed before the push, exactly as Chat's "+" menu and the Map's place
          sheet close before the same one: the paywall is presented as a modal,
          and stacking it on a live `Sheet` is two modals in one frame.
        */
        onUpgrade={() => {
          setEventMode('none');
          router.push('/premium');
        }}
        onClose={() => {
          setEventMode('none');
          setEventTarget(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // The wash needs room to be a surface; the old header was bare rows.
    padding: Spacing.lg,
    borderRadius: Radius.xl,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  greeting: { gap: 2 },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  // The grid itself: one gap between every block, whatever its width.
  bento: { gap: Spacing.md },
  split: { flexDirection: 'row', gap: Spacing.md },
  feed: { gap: Spacing.lg },
});
