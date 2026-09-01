/**
 * The menu behind the composer's "+".
 *
 * Two entries, and each of them can be in one of three states — available,
 * unavailable because there is no family, or, for photos, behind FamApp Gold.
 * None of the three is hidden: the same treatment "Manage members" gets for a
 * non-admin, and the reason is the same one — a control that vanishes explains
 * nothing, and the boundary is best stated where the action is.
 *
 * **The lock is a UI rule, exactly like `canActOnTask`.** `messages: send as
 * self` does not read `families.is_premium`, and neither does the `chat-media`
 * upload policy, so a free family's photo would be accepted by the database.
 * This row is a sales surface, not enforcement; making it real means a trigger
 * reading `private.is_family_premium()`. Do not build anything on top of it
 * that assumes it holds.
 *
 * Content only, no `Sheet` of its own: Chat shows this and the task form in the
 * same sheet, because presenting one native modal while dismissing another in
 * the same frame is unreliable on iOS.
 */

import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

type ChatActionsListProps = {
  /**
   * False for someone using the app without a family. Tasks belong to a family
   * — `tasks: family inserts` has nothing to check them against otherwise — so
   * the row states that instead of opening a form that cannot be submitted.
   *
   * Photos need one for the same reason: `messages.family_id` is `not null`.
   */
  canCreateTask: boolean;
  /** The family's tier, from `useFamily().isPremium`. Gates the photo row. */
  isPremium: boolean;
  /** True while a pick-and-upload started from this row is still running. */
  isSendingPhoto?: boolean;
  onCreateTask: () => void;
  /** Gold family: open the picker. */
  onSendPhoto: () => void;
  /** Free family: go to the paywall instead. */
  onUpgrade: () => void;
};

export function ChatActionsList({
  canCreateTask,
  isPremium,
  isSendingPhoto = false,
  onCreateTask,
  onSendPhoto,
  onUpgrade,
}: ChatActionsListProps) {
  const { t } = useTranslation();

  // No family outranks the tier: a solo user's photo has no `family_id` to be
  // stored against, so selling them Gold to fix it would be the wrong answer.
  const photoBlockedByFamily = !canCreateTask;
  const photoLocked = !photoBlockedByFamily && !isPremium;

  return (
    <View style={styles.list}>
      <ActionRow
        icon="checkbox-outline"
        label={t('chatActions.createTask')}
        description={
          canCreateTask
            ? t('chatActions.createTaskHint')
            : t('chatActions.createTaskDisabled')
        }
        disabled={!canCreateTask}
        onPress={onCreateTask}
      />

      <ActionRow
        // A padlock rather than a photo when it is not this family's to press:
        // the glyph says which of the two rows is the one being sold.
        icon={photoLocked ? 'lock-closed-outline' : 'image-outline'}
        label={t('chatActions.sendPhoto')}
        description={
          photoBlockedByFamily
            ? t('chatActions.sendPhotoDisabled')
            : photoLocked
              ? t('chatActions.sendPhotoLocked')
              : isSendingPhoto
                ? t('chat.photoUploading')
                : t('chatActions.sendPhotoHint')
        }
        // `warning` is the whole of Gold's colour — the same amber the banner,
        // the Profile row and the paywall's hero already read.
        badge={photoLocked ? t('premium.badge') : undefined}
        // Locked is *not* disabled: the press is the whole point of the row,
        // it just goes to the paywall rather than to the picker.
        disabled={photoBlockedByFamily}
        busy={isSendingPhoto}
        onPress={photoLocked ? onUpgrade : onSendPhoto}
      />
    </View>
  );
}

type ActionRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  /** A state, not a value — rendered in Gold's amber beside the label. */
  badge?: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
};

function ActionRow({
  icon,
  label,
  description,
  badge,
  onPress,
  disabled = false,
  busy = false,
}: ActionRowProps) {
  const { colors } = useTheme();
  const inert = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      accessibilityLabel={label}
      accessibilityHint={description}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
        disabled && styles.disabled,
      ]}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name={icon} size={20} color={disabled ? colors.textTertiary : colors.primary} />
      </View>

      <View style={styles.text}>
        <View style={styles.labelRow}>
          <Text variant="bodyStrong" color={disabled ? 'textTertiary' : 'text'}>
            {label}
          </Text>
          {badge ? <Badge label={badge} tone="warning" /> : null}
        </View>
        <Text variant="caption" color="textTertiary">
          {description}
        </Text>
      </View>

      {busy ? (
        <ActivityIndicator size="small" color={colors.textTertiary} />
      ) : disabled ? null : (
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.xs, paddingBottom: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  disabled: { opacity: 0.55 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
