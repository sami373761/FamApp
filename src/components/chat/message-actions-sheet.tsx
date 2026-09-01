/**
 * The menu behind a long press on a single message.
 *
 * It replaced the long press going straight to the delete dialog, because a
 * message can now be turned into a task as well — and one gesture that does two
 * things has to ask which. The rows are the shared `ActionRow`, so this menu and
 * the composer's "+" menu look and behave alike; the sheet holding it is Chat's
 * one `Sheet`, swapping its children rather than handing off to a second modal.
 *
 * **"Create task from message" is a prefill and nothing more.** It opens the
 * same `TaskComposerForm` the "+" menu opens, with the message's text already
 * in the title field, and the task it creates is announced and linked exactly
 * like any other — so nothing about the message row changes, and the message
 * stays in the conversation as its author wrote it.
 *
 * Delete is offered only when the screen says the caller may (`messages: delete
 * own or admin`, which is real enforcement rather than a courtesy). "Not your
 * message" is not a state anyone can act their way out of, so it is absent
 * rather than dimmed — unlike the family and Gold boundaries in the "+" menu,
 * which are both about the account rather than about somebody else's row.
 */

import { View } from 'react-native';

import { ActionRow, actionListStyles } from '@/components/chat/action-row';
import { useTranslation } from '@/hooks/use-translation';

type MessageActionsListProps = {
  /**
   * False for someone using the app without a family. `tasks: family inserts`
   * has no family id to check against, so the row says so rather than opening
   * a form that cannot be submitted — the same treatment the "+" menu gives it.
   */
  hasFamily: boolean;
  /**
   * Whether this message carries text that could be a title. False for a photo
   * sent without a caption, which has nothing to convert.
   */
  hasTitle: boolean;
  /** The screen's reading of `messages: delete own or admin`. */
  canDelete: boolean;
  onCreateTask: () => void;
  onDelete: () => void;
};

export function MessageActionsList({
  hasFamily,
  hasTitle,
  canDelete,
  onCreateTask,
  onDelete,
}: MessageActionsListProps) {
  const { t } = useTranslation();

  // No family outranks an empty message, the same way it outranks the tier in
  // the "+" menu: a caption would not help somebody who has nowhere to put the
  // task.
  const canCreateTask = hasFamily && hasTitle;

  return (
    <View style={actionListStyles.list}>
      <ActionRow
        icon="checkbox-outline"
        label={t('messageActions.createTask')}
        description={
          !hasFamily
            ? t('chatActions.createTaskDisabled')
            : !hasTitle
              ? t('messageActions.createTaskNoText')
              : t('messageActions.createTaskHint')
        }
        disabled={!canCreateTask}
        onPress={onCreateTask}
      />

      {canDelete ? (
        <ActionRow
          icon="trash-outline"
          label={t('messageActions.delete')}
          description={t('messageActions.deleteHint')}
          tone="danger"
          onPress={onDelete}
        />
      ) : null}
    </View>
  );
}
