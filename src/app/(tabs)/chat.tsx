import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatActionsList } from '@/components/chat/chat-actions-sheet';
import { ChatComposer } from '@/components/chat/chat-composer';
import { MessageBubble } from '@/components/chat/message-bubble';
import { TaskMessageCard } from '@/components/chat/task-message-card';
import { TaskComposerForm } from '@/components/tasks/task-composer';
import { Avatar, EmptyState, Sheet, Text } from '@/components/ui';
import { dayLabel } from '@/data/format';
import type { TaskStatus } from '@/data/types';
import { errorText } from '@/services/result';
import { pickAndCompressImage, uploadChatImage } from '@/services/chatMediaService';
import { groupByDay } from '@/services/chatService';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTabBarMetrics } from '@/hooks/use-tab-bar';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { MaxContentWidth, Spacing } from '@/theme';

/**
 * How long to wait for the actions sheet to finish sliding away.
 *
 * The picker is presented by the OS from the same root view controller the
 * `Sheet`'s `Modal` is dismissing from, and asking iOS to present over a
 * controller that is mid-dismissal is the one that silently does nothing —
 * the same two-modals-in-one-frame hazard that keeps this screen down to a
 * single `Sheet`. `animationType="slide"` runs about 300 ms, so this waits it
 * out rather than racing it. Android and web present their pickers as their
 * own activity or a file input and need no such gap.
 */
const SHEET_DISMISS_MS = 350;

const sheetDismissed = () =>
  Platform.OS === 'ios'
    ? new Promise((resolve) => setTimeout(resolve, SHEET_DISMISS_MS))
    : Promise.resolve();

/**
 * Family chat, and the app's primary way of creating a task.
 *
 * Does not use the shared `Screen` wrapper: the composer must pin to the
 * keyboard while only the message list scrolls.
 *
 * A message is drawn as a task card when a task names it in `source_message_id`
 * — the lookup below, not a flag on the message. That keeps the rule one-way:
 * lose the task and the announcement is still a readable line of chat, which is
 * exactly what happens once the 30-day sweep takes one of the two.
 */
export default function ChatScreen() {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { user, profile } = useAuth();
  const {
    family,
    isPremium,
    members,
    messages,
    tasks,
    getMember,
    isLoading,
    sendMessage,
    sendImage,
    createTask,
    setTaskStatus,
  } = useFamily();
  const scrollRef = useRef<ScrollView>(null);
  const isMounted = useIsMounted();
  const { clearance } = useTabBarMetrics();

  /**
   * The floating tab bar is what the composer normally keeps clear of — but
   * with the keyboard up the island is either behind it (iOS) or hidden
   * (`tabBarHideOnKeyboard` on Android), and holding the space open would leave
   * a band of empty surface between the input and the keyboard.
   */
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const shown = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardOpen(true),
    );
    const hidden = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardOpen(false),
    );

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  // Read from the profile, not from `family`, which is also null while a real
  // family is loading. `tasks: family inserts` needs a family id, so without one
  // creating a task cannot succeed — the menu says so instead of the form
  // refusing after it has been filled in.
  const hasFamily = !!profile?.family_id;

  // One sheet, three states — not two sheets. Dismissing a native modal while
  // presenting another in the same frame is unreliable on iOS, so "Create task"
  // changes what the open sheet holds rather than handing off to a second one.
  const [sheet, setSheet] = useState<'none' | 'actions' | 'task'>('none');
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  // The photo flow outlives the sheet that starts it — the picker closes it —
  // so its progress and its failure belong to the screen, in the strip above
  // the composer. `ChatComposer` keeps its own error slot for the draft it
  // owns; a photo has no draft to preserve, so the two never share a line.
  const [isSendingPhoto, setIsSendingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const days = useMemo(() => groupByDay(messages), [messages]);
  const onlineCount = members.filter((member) => member.presence === 'online').length;

  // Built once per task list rather than scanned per message: a family can hold
  // 200 messages against 20 active tasks, and this runs on every render.
  const taskByMessageId = useMemo(() => {
    const index = new Map<string, (typeof tasks)[number]>();

    for (const task of tasks) {
      if (task.sourceMessageId) index.set(task.sourceMessageId, task);
    }

    return index;
  }, [tasks]);

  /**
   * Which status a press means is `TaskStatusActions`' business — it owns the
   * toggle rule and hands the resolved value down. This is only the write.
   */
  async function updateTaskStatus(taskId: string, status: TaskStatus) {
    setBusyTaskId(taskId);

    await setTaskStatus(taskId, status);

    if (isMounted()) setBusyTaskId(null);
  }

  /**
   * Pick, compress, upload, post — in that order, and the order is load-bearing.
   *
   * The object goes into the bucket *before* the row that names it, the same
   * way `createTask` writes the task before announcing it: a message pointing
   * at nothing renders as a broken photo for the whole family, whereas an
   * object nothing points at is invisible and the 10-day media sweep collects
   * it. Each step reports its own failure rather than a single "sending
   * failed" — a refused permission and a dropped connection are different
   * problems with different fixes.
   *
   * The sheet closes *first*. The picker is the OS's own modal, and presenting
   * it over a live RN `Modal` is the same unreliable-on-iOS problem this
   * screen's one-sheet rule exists to avoid.
   */
  const sendPhoto = useCallback(async () => {
    setSheet('none');
    setPhotoError(null);

    if (!profile?.family_id) return;

    setIsSendingPhoto(true);

    await sheetDismissed();

    if (!isMounted()) return;

    const picked = await pickAndCompressImage();

    if (!isMounted()) return;

    if (picked.error) {
      setPhotoError(errorText(i18n, picked.error));
      setIsSendingPhoto(false);
      return;
    }

    // Null data with no error is a cancel, which is an answer and not a fault.
    if (!picked.data) {
      setIsSendingPhoto(false);
      return;
    }

    const uploaded = await uploadChatImage(profile.family_id, picked.data);

    if (!isMounted()) return;

    if (uploaded.error) {
      setPhotoError(errorText(i18n, uploaded.error));
      setIsSendingPhoto(false);
      return;
    }

    const failure = await sendImage(uploaded.data);

    if (!isMounted()) return;

    setPhotoError(failure);
    setIsSendingPhoto(false);
  }, [i18n, isMounted, profile?.family_id, sendImage]);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.avatars}>
          {members.slice(0, 3).map((member, index) => (
            <View key={member.id} style={index > 0 ? styles.avatarOverlap : undefined}>
              <Avatar
                initials={member.initials}
                colorIndex={member.colorIndex}
                avatar={member.avatar}
                size="sm"
              />
            </View>
          ))}
        </View>

        <View style={styles.headerText}>
          <Text variant="subheading">{family?.name ?? t('chat.title')}</Text>
          <Text variant="caption" color="textSecondary">
            {t('chat.memberCount', { count: members.length })}
            {onlineCount > 0 ? t('chat.online', { count: onlineCount }) : ''}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // No offset: the tab bar floats above the scene rather than taking
        // space out of it, so this view already reaches the bottom of the
        // window and the keyboard's own height is the whole correction.
        keyboardVerticalOffset={0}>
        {isLoading || days.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              bare
              loading={isLoading}
              icon="chatbubbles-outline"
              title={isLoading ? t('chat.loading') : t('chat.emptyTitle')}
              description={isLoading ? undefined : t('chat.emptyBody')}
            />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.messages}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            {days.map((day) => (
              <View key={day.key}>
                <View style={styles.dayDivider}>
                  <View style={[styles.dayPill, { backgroundColor: colors.surfaceMuted }]}>
                    <Text variant="label" color="textSecondary">
                      {dayLabel(i18n, day.date).toUpperCase()}
                    </Text>
                  </View>
                </View>

                {day.messages.map((message, index) => {
                  const task = taskByMessageId.get(message.id);
                  const isOwn = message.senderId === user?.id;
                  const previous = day.messages[index - 1];

                  if (task) {
                    return (
                      <TaskMessageCard
                        key={message.id}
                        task={task}
                        createdAt={message.createdAt}
                        author={getMember(message.senderId)}
                        assignee={getMember(task.assigneeId)}
                        isOwn={isOwn}
                        currentUserId={user?.id}
                        busy={busyTaskId === task.id}
                        onSetStatus={(status) => void updateTaskStatus(task.id, status)}
                      />
                    );
                  }

                  return (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      sender={getMember(message.senderId)}
                      isOwn={isOwn}
                      // Only label the first message in a run from the same
                      // person — but a task card breaks the run, so the bubble
                      // under one is labelled again even from the same sender.
                      showAuthor={
                        previous?.senderId !== message.senderId ||
                        taskByMessageId.has(previous.id)
                      }
                    />
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}

        {isSendingPhoto || photoError ? (
          <View
            style={[
              styles.photoStatus,
              { backgroundColor: colors.surface, borderTopColor: colors.border },
            ]}>
            {isSendingPhoto ? <ActivityIndicator size="small" color={colors.textTertiary} /> : null}
            <Text variant="caption" color={photoError ? 'danger' : 'textSecondary'} style={styles.flex}>
              {photoError ?? t('chat.photoUploading')}
            </Text>
          </View>
        ) : null}

        <ChatComposer
          onSend={sendMessage}
          onOpenActions={() => setSheet('actions')}
          bottomInset={isKeyboardOpen ? Spacing.sm : clearance}
        />
      </KeyboardAvoidingView>

      <Sheet
        visible={sheet !== 'none'}
        title={sheet === 'task' ? t('composer.title') : t('chatActions.title')}
        description={sheet === 'task' ? t('composer.description') : undefined}
        onClose={() => setSheet('none')}>
        {sheet === 'actions' ? (
          <ChatActionsList
            canCreateTask={hasFamily}
            isPremium={isPremium}
            isSendingPhoto={isSendingPhoto}
            onCreateTask={() => setSheet('task')}
            onSendPhoto={() => void sendPhoto()}
            /*
              Closed before the push, for the reason the Map's place sheet
              closes before the same push: the paywall is presented as a modal,
              and stacking it on a live `Sheet` is two modals in one frame.
            */
            onUpgrade={() => {
              setSheet('none');
              router.push('/premium');
            }}
          />
        ) : null}

        {/* Unmounted on close, which is what clears the draft — the form keeps
            its fields in local state and has no reset of its own. */}
        {sheet === 'task' ? (
          <TaskComposerForm
            members={members}
            currentUserId={user?.id}
            onCreate={createTask}
            onClose={() => setSheet('none')}
          />
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  avatars: { flexDirection: 'row' },
  avatarOverlap: { marginLeft: -12 },
  headerText: { flex: 1, gap: 2 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  messages: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  photoStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  dayDivider: { alignItems: 'center', marginVertical: Spacing.md },
  dayPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 999,
  },
});
