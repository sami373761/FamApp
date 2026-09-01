/**
 * One person in the family roster, with the admin's remove control.
 *
 * Takes a resolved `FamilyMember` rather than an id — the screen owns
 * `getMember`, the same split `ActivityRow` and `TaskCard` use. Whether the
 * remove control appears is the caller's decision: this component renders it
 * when `onRemove` is supplied and nothing otherwise, so it is equally the
 * read-only row a non-admin sees.
 */

import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { memberName, monthYear, roleLabel } from '@/data/format';
import type { FamilyMember } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

type MemberRowProps = {
  member: FamilyMember;
  /** Marks the signed-in user's own row; they can never remove themselves here. */
  isSelf?: boolean;
  /** Supplying this renders the remove control. Admins only. */
  onRemove?: () => void;
  /** Spins that member's control while the RPC is in flight. */
  isRemoving?: boolean;
  /** Blocks the control while another removal is running. */
  disabled?: boolean;
  isLast?: boolean;
};

export function MemberRow({
  member,
  isSelf = false,
  onRemove,
  isRemoving = false,
  disabled = false,
  isLast = false,
}: MemberRowProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;

  // `is_admin` is the authority marker; `role` is a self-declared label.
  const detail = [
    member.role ? roleLabel(i18n, member.role) : null,
    t('memberRow.joined', { date: monthYear(i18n, member.createdAt) }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.row}>
      <Avatar
        initials={member.initials}
        colorIndex={member.colorIndex}
        avatar={member.avatar}
        size="md"
        online={member.presence === 'online'}
      />

      <View
        style={[
          styles.body,
          !isLast && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.separator,
          },
        ]}>
        <View style={styles.labels}>
          <View style={styles.nameRow}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.name}>
              {memberName(i18n, member)}
            </Text>
            {isSelf ? <Badge label={t('common.you')} tone="neutral" /> : null}
            {member.isAdmin ? <Badge label={t('common.admin')} tone="primary" /> : null}
          </View>

          <Text variant="caption" color="textTertiary">
            {detail}
          </Text>
        </View>

        {onRemove ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('memberRow.removeA11y', { name: memberName(i18n, member) })}
            accessibilityState={{ disabled: disabled || isRemoving, busy: isRemoving }}
            disabled={disabled || isRemoving}
            onPress={onRemove}
            // It opens the confirmation rather than removing anyone, so it is a
            // `tap`; `warning` belongs on the dialog's own confirm button.
            feedback="tap"
            scaleTo={0.9}
            hitSlop={8}
            style={[
              styles.remove,
              { backgroundColor: colors.dangerSoft },
              disabled && styles.dimmed,
            ]}>
            {isRemoving ? (
              <ActivityIndicator color={colors.danger} size="small" />
            ) : (
              <Ionicons name="person-remove-outline" size={16} color={colors.danger} />
            )}
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.lg },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginLeft: Spacing.md,
    paddingVertical: Spacing.md,
    paddingRight: Spacing.lg,
  },
  labels: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  // Keeps a long name from pushing the badges off the row.
  name: { flexShrink: 1 },
  remove: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: { opacity: 0.4 },
});
