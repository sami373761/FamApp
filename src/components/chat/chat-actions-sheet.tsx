/**
 * The menu behind the composer's "+".
 *
 * Three entries, and each of them can be in one of three states — available,
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
 * Content only, no `Sheet` of its own: Chat shows this, the message menu and
 * the task form in the same sheet, because presenting one native modal while
 * dismissing another in the same frame is unreliable on iOS. The rows
 * themselves are `ActionRow`, shared with the message menu.
 */

import { View } from 'react-native';

import { ActionRow, actionListStyles } from '@/components/chat/action-row';
import { useTranslation } from '@/hooks/use-translation';

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
  /**
   * Opens the poll form. Gated on the same `canCreateTask` flag rather than one
   * of its own: a poll is a `messages` row plus a `chat_polls` row, and both
   * carry a `not null` family id, so the boundary is exactly the same one.
   */
  onCreatePoll: () => void;
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
  onCreatePoll,
  onSendPhoto,
  onUpgrade,
}: ChatActionsListProps) {
  const { t } = useTranslation();

  // No family outranks the tier: a solo user's photo has no `family_id` to be
  // stored against, so selling them Gold to fix it would be the wrong answer.
  const photoBlockedByFamily = !canCreateTask;
  const photoLocked = !photoBlockedByFamily && !isPremium;

  return (
    <View style={actionListStyles.list}>
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

      {/*
        Free for every tier, deliberately. A poll is two ordinary rows in tables
        every member can already write to, and neither `chat_polls: insert own`
        nor `chat_poll_votes: insert own` reads `families.is_premium` — so
        putting a padlock here would be selling something the database hands out
        anyway, which is a worse lie than the photo row's (that one at least
        mirrors a boundary the product intends).
      */}
      <ActionRow
        icon="stats-chart-outline"
        label={t('chatActions.createPoll')}
        description={
          canCreateTask ? t('chatActions.createPollHint') : t('chatActions.createPollDisabled')
        }
        disabled={!canCreateTask}
        onPress={onCreatePoll}
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
