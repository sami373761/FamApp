/**
 * The family roster, and the admin's ability to remove people from it.
 *
 * Admin-only in the sense that matters: `remove_member` is a SECURITY DEFINER
 * RPC that refuses anyone whose own profile is not `is_admin`, so the boundary
 * is the database's, not this screen's. The Profile row that leads here is
 * disabled for non-admins, and the remove controls below are simply not
 * rendered for them — but a member who reaches this screen some other way still
 * gets a roster they can read, which is exactly what RLS already lets them see.
 *
 * The invite code sits here too, and only for admins, because this is the one
 * screen that can change it: `regenerate_join_code()` is the same shape of
 * boundary — a SECURITY DEFINER RPC that refuses a non-admin — and the code it
 * returns is what the card is displaying, so the button and its result share a
 * card. Profile keeps showing the code to everyone; it just cannot rotate it.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MemberRow } from '@/components/family/member-row';
import { Button, Card, ConfirmDialog, EmptyState, NavHeader, Screen, Text } from '@/components/ui';
import { memberName } from '@/data/format';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useHaptics } from '@/hooks/use-haptics';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

export default function ManageMembersScreen() {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { user } = useAuth();
  const isMounted = useIsMounted();
  const haptic = useHaptics();
  const {
    family,
    members,
    currentMember,
    isLoading,
    isRefreshing,
    refresh,
    removeMember,
    regenerateJoinCode,
  } = useFamily();

  // Held as an id rather than a boolean so the dialog, the spinner and the RPC
  // all agree on which member is being removed.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isConfirmingCode, setIsConfirmingCode] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const isAdmin = !!currentMember?.isAdmin;
  const pending = members.find((member) => member.id === pendingId) ?? null;

  async function confirmRemoval() {
    if (!pendingId) return;

    setIsRemoving(true);
    setError(null);

    const failure = await removeMember(pendingId);

    // Going back mid-removal unmounts the dialog along with this screen.
    if (!isMounted()) return;

    setIsRemoving(false);

    // The dialog stays open on failure so the reason lands next to the action.
    if (failure) {
      setError(failure);
      return;
    }

    setPendingId(null);
  }

  async function confirmRegeneration() {
    setIsRegenerating(true);
    setCodeError(null);

    const failure = await regenerateJoinCode();

    if (!isMounted()) return;

    setIsRegenerating(false);

    // Same rule as the removal above: the dialog holds so the reason lands
    // beside the action that caused it.
    if (failure) {
      setCodeError(failure);
      return;
    }

    // The new code is already on screen behind the dialog — `family.joinCode`
    // came back in the same commit — so the feedback is for the write landing,
    // not for anything about to happen.
    haptic('success');
    setIsConfirmingCode(false);
  }

  return (
    <Screen edges={['top', 'bottom']} scroll onRefresh={() => void refresh()} refreshing={isRefreshing}>
      <NavHeader title={t('manageMembers.title')} backFallback="/(tabs)/profile" />

      {isLoading ? (
        <EmptyState icon="people-outline" title={t('manageMembers.loading')} loading />
      ) : (
        <>
          <View style={styles.intro}>
            <Text variant="title">{family?.name ?? t('common.yourFamily')}</Text>
            <Text variant="body" color="textSecondary">
              {family
                ? t('manageMembers.placesUsed', {
                    used: members.length,
                    max: family.maxMembers,
                  })
                : t('manageMembers.memberCount', { count: members.length })}{' '}
              {isAdmin ? t('manageMembers.adminHint') : t('manageMembers.memberHint')}
            </Text>
          </View>

          {members.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title={t('manageMembers.emptyTitle')}
              description={t('manageMembers.emptyBody')}
            />
          ) : (
            <Card padded={false} style={styles.group}>
              {members.map((member, index) => {
                const isSelf = member.id === user?.id;

                return (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isSelf={isSelf}
                    // Admins cannot remove themselves — `remove_member` rejects
                    // it, and leaving is a different action entirely.
                    onRemove={
                      isAdmin && !isSelf
                        ? () => {
                            setError(null);
                            setPendingId(member.id);
                          }
                        : undefined
                    }
                    isRemoving={isRemoving && pendingId === member.id}
                    disabled={isRemoving}
                    isLast={index === members.length - 1}
                  />
                );
              })}
            </Card>
          )}

          {/*
            The code is shown here as well as on Profile because this is where
            it can be *changed*, and an action whose whole result is a new
            six-character string has to put that string next to the button.
            Admin-only, like the RPC behind it.
          */}
          {isAdmin && family ? (
            <Card style={styles.codeCard}>
              <View style={styles.codeHeader}>
                <View style={styles.codeText}>
                  <Text variant="captionStrong">{t('manageMembers.codeTitle')}</Text>
                  <Text variant="caption" color="textSecondary">
                    {t('manageMembers.codeBody')}
                  </Text>
                </View>

                <View style={[styles.codePill, { backgroundColor: colors.accentSoft }]}>
                  <Text variant="subheading" color="accent" style={styles.codeValue}>
                    {family.joinCode}
                  </Text>
                </View>
              </View>

              <Button
                label={t('manageMembers.regenerate')}
                variant="secondary"
                size="md"
                loading={isRegenerating}
                disabled={isRemoving}
                leading={
                  <Ionicons name="refresh-outline" size={18} color={colors.accent} />
                }
                onPress={() => {
                  setCodeError(null);
                  setIsConfirmingCode(true);
                }}
              />
            </Card>
          ) : null}

          {!isAdmin ? (
            <Card style={styles.note}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textTertiary} />
              <Text variant="caption" color="textSecondary" style={styles.flex}>
                {t('manageMembers.notAdmin')}
              </Text>
            </Card>
          ) : null}
        </>
      )}

      <ConfirmDialog
        visible={!!pending}
        title={
          pending
            ? t('manageMembers.removeTitle', { name: memberName(i18n, pending) })
            : t('manageMembers.removeTitleGeneric')
        }
        message={t('manageMembers.removeMessage')}
        confirmLabel={t('manageMembers.remove')}
        tone="danger"
        loading={isRemoving}
        error={error}
        onConfirm={() => void confirmRemoval()}
        onCancel={() => {
          setPendingId(null);
          setError(null);
        }}
      />

      {/*
        A second dialog rather than one that swaps its copy, which the removal
        one cannot do without losing the title it keeps for its own fade-out
        (`removeTitleGeneric` above). The two are mutually exclusive — opening
        this one presents nothing while the other is dismissing, which is the
        actual iOS hazard — so both simply sit here with one of them visible.
      */}
      <ConfirmDialog
        visible={isConfirmingCode}
        title={t('manageMembers.regenerateTitle')}
        message={t('manageMembers.regenerateMessage')}
        confirmLabel={t('manageMembers.regenerate')}
        tone="danger"
        loading={isRegenerating}
        error={codeError}
        onConfirm={() => void confirmRegeneration()}
        onCancel={() => {
          setIsConfirmingCode(false);
          setCodeError(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { gap: Spacing.sm, marginTop: Spacing.lg, marginBottom: Spacing.xl },
  group: { overflow: 'hidden' },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.lg },
  codeCard: { gap: Spacing.lg, marginTop: Spacing.lg },
  codeHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  codeText: { flex: 1, gap: 2 },
  codePill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  codeValue: { letterSpacing: 2 },
});
