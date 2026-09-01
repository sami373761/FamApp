/**
 * The Profile tab: who you are, and every setting the app actually has.
 *
 * Every row here does something. Rows that could not — safe zones, granular
 * permissions, a privacy page, help & support — were removed rather than left
 * as chrome, on the same principle that keeps fixtures out of the rest of the
 * app: nothing is rendered that is not real.
 *
 * The three destinations (`edit-profile`, `edit-avatar`, `manage-members`) are
 * pushed screens. "Manage members" is disabled for a member who is not an
 * admin — the database refuses them anyway, and a dimmed row with a reason
 * explains the boundary better than a refusal after the fact.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LanguageSheet } from '@/components/settings/language-sheet';
import {
  Avatar,
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  GradientSurface,
  ListRow,
  Screen,
  Section,
  Segmented,
  SwitchRow,
  Text,
  type SegmentedOption,
} from '@/components/ui';
import type { Appearance } from '@/context/PreferencesContext';
import { memberName, monthYear, roleLabel } from '@/data/format';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTabBarMetrics } from '@/hooks/use-tab-bar';
import { usePreferences } from '@/hooks/usePreferences';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { describeLanguage } from '@/i18n';
import { deleteAccount } from '@/services/authService';
import { clearOwnLocation } from '@/services/locationService';
import {
  registerForPushNotifications,
  unregisterFromPushNotifications,
} from '@/services/notificationService';
import { errorText } from '@/services/result';
import { Radius, Spacing } from '@/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { signOut, user, profile } = useAuth();
  const {
    family,
    isPremium,
    members,
    tasks,
    currentMember,
    isLoading,
    isRefreshing,
    refresh,
    setOwnLocation,
  } = useFamily();
  const { preferences, setPreference } = usePreferences();
  const { clearance } = useTabBarMetrics();

  const appearanceOptions: readonly SegmentedOption<Appearance>[] = [
    { value: 'system', label: t('profile.appearanceSystem') },
    { value: 'light', label: t('profile.appearanceLight') },
    { value: 'dark', label: t('profile.appearanceDark') },
  ];
  // Signing out or deleting the account swaps the whole branch out from under
  // this screen, so nothing past an await may assume it is still mounted.
  const isMounted = useIsMounted();

  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isPickingLanguage, setIsPickingLanguage] = useState(false);
  const [isUpdatingNotifications, setIsUpdatingNotifications] = useState(false);
  const [isUpdatingLocation, setIsUpdatingLocation] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const completedCount = tasks.filter(
    (task) => task.status === 'completed' && task.assigneeId === user?.id,
  ).length;

  // Read from the profile rather than from `family`, which is also null while a
  // real family is still loading — this must not flicker "you have no family".
  const hasFamily = !!profile?.family_id;
  // `is_admin` is the real authority marker; `role` is a self-declared label.
  const isAdmin = !!currentMember?.isAdmin;
  const roleBadge = currentMember
    ? [
        currentMember.role ? roleLabel(i18n, currentMember.role) : null,
        currentMember.isAdmin ? t('common.admin') : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  /*
    The language the app is *actually* rendering in, which is not the same as
    the stored preference: `system` has to resolve to something before it can be
    shown, and showing "System" alone would leave the row unable to answer the
    question it is there to answer.
  */
  const languageName = describeLanguage(i18n.language).nativeName;

  /**
   * Turning notifications on registers *this device*: permission, an Expo push
   * token, and that token written onto the profile row. Turning it off clears
   * the token — the OS permission is left alone, because it is not the app's to
   * revoke and someone toggling back on should not face the prompt again.
   *
   * The switch moves first and moves back if the work fails, the same shape as
   * location sharing below and for the same reason: the flag must never claim
   * a registration that does not exist. Every way this fails on a healthy
   * device — the browser, a simulator, Expo Go, a build with no EAS project id
   * — arrives as an error with copy of its own, so the row explains itself
   * instead of silently snapping back.
   */
  async function setNotifications(next: boolean) {
    setSettingsError(null);
    setPreference('notifications', next);
    setIsUpdatingNotifications(true);

    const { error } = next
      ? await registerForPushNotifications()
      : await unregisterFromPushNotifications();

    if (!isMounted()) return;

    if (error) {
      setSettingsError(errorText(i18n, error));
      setPreference('notifications', !next);
    }

    setIsUpdatingNotifications(false);
  }

  /**
   * Turning sharing off is not just a flag: the position already stored would
   * keep showing on everyone else's map for as long as the row exists. The
   * switch is moved first so it responds immediately, and moved back if the
   * delete fails — the flag must never claim more privacy than there is.
   */
  async function setLocationSharing(next: boolean) {
    setSettingsError(null);
    setPreference('locationSharing', next);

    if (next) return;

    setIsUpdatingLocation(true);

    const { error } = await clearOwnLocation();

    if (!isMounted()) return;

    if (error) {
      setSettingsError(errorText(i18n, error));
      setPreference('locationSharing', true);
    } else {
      // The map and the member list both read this position. The row is gone,
      // so it is dropped from the roster directly rather than refetching the
      // family to learn what this call already knows.
      setOwnLocation(null);
    }

    if (isMounted()) setIsUpdatingLocation(false);
  }

  /**
   * On success the session is gone, which flips the root navigator's guards
   * back to the welcome stack and unmounts this screen — so there is nothing
   * to reset afterwards and no navigation to perform.
   */
  async function confirmDeleteAccount() {
    setIsDeleting(true);
    setDeleteError(null);

    const { error } = await deleteAccount();

    if (!isMounted()) return;

    if (error) {
      setDeleteError(errorText(i18n, error));
      setIsDeleting(false);
    }
  }

  return (
    <Screen
      scroll
      onRefresh={() => void refresh()}
      refreshing={isRefreshing}
      contentContainerStyle={{ paddingBottom: clearance }}>
      {isLoading ? (
        <EmptyState icon="person-outline" title={t('profile.loading')} loading />
      ) : (
        <>
          {/* The other banner: same wash as Home's, so "the top of a tab" looks
              like one thing across the app. */}
          <GradientSurface tone="primary" style={styles.header}>
            <Avatar
              initials={currentMember?.initials ?? '?'}
              colorIndex={currentMember?.colorIndex ?? 0}
              avatar={currentMember?.avatar}
              size="xl"
              online={currentMember?.presence === 'online'}
            />

            <View style={styles.identity}>
              <Text variant="title" center>
                {currentMember ? memberName(i18n, currentMember) : t('common.unnamedMember')}
              </Text>
              {roleBadge ? <Badge label={roleBadge} tone="primary" /> : null}
              <Text variant="caption" color="textTertiary">
                {user?.email ?? ''}
              </Text>
            </View>
          </GradientSurface>

          <Card style={styles.statsCard}>
            {[
              {
                label: t('profile.statFamily'),
                value: hasFamily
                  ? (family?.name ?? t('common.unnamedFamily'))
                  : t('profile.statSolo'),
              },
              {
                label: t('profile.statSince'),
                value: currentMember ? monthYear(i18n, currentMember.createdAt) : '—',
              },
              { label: t('profile.statTasksDone'), value: `${completedCount}` },
            ].map((stat, index, all) => (
              <View key={stat.label} style={styles.stat}>
                <Text variant="captionStrong" numberOfLines={1}>
                  {stat.value}
                </Text>
                <Text variant="label" color="textTertiary">
                  {stat.label.toUpperCase()}
                </Text>
                {index < all.length - 1 ? (
                  <View style={[styles.statDivider, { backgroundColor: colors.separator }]} />
                ) : null}
              </View>
            ))}
          </Card>

          {family ? (
            <Card style={styles.codeCard}>
              <View style={styles.codeText}>
                <Text variant="captionStrong">{t('profile.inviteTitle')}</Text>
                <Text variant="caption" color="textSecondary">
                  {t('profile.inviteBody')}
                </Text>
              </View>

              <View style={[styles.codePill, { backgroundColor: colors.accentSoft }]}>
                <Text variant="subheading" color="accent" style={styles.codeValue}>
                  {family.joinCode}
                </Text>
              </View>
            </Card>
          ) : null}
        </>
      )}

      <Section title={t('profile.sectionAccount')}>
        <Card padded={false} style={styles.group}>
          {/*
            The subscription row. `warning` is the gold — the badge, the banner
            on Home and the paywall's own header all take the same token, so
            "Gold" is one colour across the app. It leads the group because a
            plan is the account's headline fact, not one of its settings.
          */}
          <ListRow
            icon={isPremium ? 'sparkles' : 'sparkles-outline'}
            label={t('premium.rowLabel')}
            /*
              The badge is the row's *state*, which is exactly the slot a badge
              is for — "Gold" is the offer, "Active" is the answer. Both stay
              `warning`, because the colour is what makes Gold one thing across
              the app; only the word changes.
            */
            description={isPremium ? t('premium.rowHintActive') : t('premium.rowHint')}
            badge={isPremium ? t('premium.activeBadge') : t('premium.badge')}
            badgeTone="warning"
            onPress={() => router.push('/premium')}
          />
          <ListRow
            icon="person-outline"
            label={t('profile.editProfile')}
            description={t('profile.editProfileHint')}
            onPress={() => router.push('/edit-profile')}
          />
          <ListRow
            icon="happy-outline"
            label={t('profile.editAvatar')}
            description={t('profile.editAvatarHint')}
            onPress={() => router.push('/edit-avatar')}
            isLast
          />
        </Card>
      </Section>

      <Section title={t('profile.sectionFamily')}>
        <Card padded={false} style={styles.group}>
          {hasFamily ? (
            <ListRow
              icon="people-outline"
              label={t('profile.manageMembers')}
              description={
                isLoading
                  ? t('common.loading')
                  : isAdmin
                    ? family
                      ? t('profile.manageMembersCount', {
                          count: members.length,
                          max: family.maxMembers,
                        })
                      : t('profile.manageMembersCountOnly', { count: members.length })
                    : t('profile.manageMembersNotAdmin')
              }
              // Disabled while loading too: `isAdmin` reads false until the
              // family arrives, and a row that claims a boundary it has not
              // checked yet is worse than one that is briefly inert.
              disabled={isLoading || !isAdmin}
              onPress={() => router.push('/manage-members')}
              isLast
            />
          ) : (
            /*
              The only way out of solo mode, so it is not optional chrome. It
              pushes `add-family`, which is mounted in this branch — *not* the
              onboarding `create-family`, which lives behind a guard this user
              is already past and would arrive offering to skip something they
              have skipped, or to sign out of a settings screen.
            */
            <ListRow
              icon="people-circle-outline"
              label={t('profile.addFamily')}
              description={t('profile.addFamilyHint')}
              onPress={() => router.push('/add-family')}
              isLast
            />
          )}
        </Card>
      </Section>

      <Section title={t('profile.sectionPreferences')}>
        <Card padded={false} style={styles.group}>
          <SwitchRow
            icon="notifications-outline"
            label={t('profile.notifications')}
            description={t('profile.notificationsHint')}
            value={preferences.notifications}
            onValueChange={(value) => void setNotifications(value)}
            busy={isUpdatingNotifications}
          />
          <SwitchRow
            icon="location-outline"
            label={t('profile.locationSharing')}
            description={t('profile.locationSharingHint')}
            value={preferences.locationSharing}
            onValueChange={(value) => void setLocationSharing(value)}
            busy={isUpdatingLocation}
          />
          {/*
            A row rather than a `Segmented` like Appearance below: eleven
            options do not fit in a segmented control, and each has to be shown
            in its own script. `value` is the resolved language, not the stored
            preference — "System" would not tell anyone what they are reading.
          */}
          <ListRow
            icon="language-outline"
            label={t('profile.language')}
            value={languageName}
            onPress={() => setIsPickingLanguage(true)}
            isLast
          />
        </Card>

        {settingsError ? (
          <Card style={styles.note}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            <Text variant="caption" color="danger" style={styles.flex}>
              {settingsError}
            </Text>
          </Card>
        ) : null}

        <Card style={styles.appearanceCard}>
          <View style={styles.appearanceText}>
            <Text variant="captionStrong">{t('profile.appearance')}</Text>
            <Text variant="caption" color="textSecondary">
              {t('profile.appearanceHint')}
            </Text>
          </View>

          <Segmented
            label={t('profile.appearance')}
            options={appearanceOptions}
            value={preferences.appearance}
            onChange={(value) => setPreference('appearance', value)}
          />
        </Card>
      </Section>

      <Section title={t('profile.sectionActions')}>
        <Card padded={false} style={styles.group}>
          <ListRow
            icon="log-out-outline"
            label={t('profile.signOut')}
            showChevron={false}
            // No navigation needed: clearing the session flips the root
            // navigator's guards back to the auth stack.
            onPress={() => void signOut()}
          />
          <ListRow
            icon="trash-outline"
            label={t('profile.deleteAccount')}
            description={t('profile.deleteAccountHint')}
            tone="danger"
            showChevron={false}
            isLast
            onPress={() => {
              setDeleteError(null);
              setIsConfirmingDelete(true);
            }}
          />
        </Card>
      </Section>

      <Text variant="label" color="textTertiary" center style={styles.version}>
        {t('profile.version')}
      </Text>

      <LanguageSheet
        visible={isPickingLanguage}
        value={preferences.language}
        onSelect={(next) => setPreference('language', next)}
        onClose={() => setIsPickingLanguage(false)}
      />

      <ConfirmDialog
        visible={isConfirmingDelete}
        title={t('profile.deleteTitle')}
        message={
          isAdmin && members.length > 1
            ? t('profile.deleteMessageAdmin')
            : t('profile.deleteMessage')
        }
        confirmLabel={t('profile.deleteAccount')}
        tone="danger"
        loading={isDeleting}
        error={deleteError}
        onConfirm={() => void confirmDeleteAccount()}
        onCancel={() => {
          setIsConfirmingDelete(false);
          setDeleteError(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.xl,
    marginTop: Spacing.md,
  },
  identity: { alignItems: 'center', gap: Spacing.sm },
  statsCard: { flexDirection: 'row', marginTop: Spacing.xl },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { position: 'absolute', right: 0, top: 4, bottom: 4, width: StyleSheet.hairlineWidth },
  codeCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.md },
  codeText: { flex: 1, gap: 2 },
  codePill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  codeValue: { letterSpacing: 2 },
  group: { overflow: 'hidden' },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  appearanceCard: { gap: Spacing.md },
  appearanceText: { gap: 2 },
  version: { marginTop: Spacing.xxl },
});
