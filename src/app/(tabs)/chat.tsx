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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatActionsList } from '@/components/chat/chat-actions-sheet';
import { PhotoComposer } from '@/components/chat/photo-composer';
import { ChatComposer } from '@/components/chat/chat-composer';
import { MessageBubble } from '@/components/chat/message-bubble';
import { TaskMessageCard } from '@/components/chat/task-message-card';
import { TaskComposerForm } from '@/components/tasks/task-composer';
import { Avatar, ConfirmDialog, EmptyState, Sheet, Text } from '@/components/ui';
import { dayLabel } from '@/data/format';
import type { TaskStatus } from '@/data/types';
import { errorText } from '@/services/result';
import {
  compressImage,
  newMessageId,
  pickImage,
  uploadChatImage,
  type PickedAsset,
} from '@/services/chatMediaService';
import { groupByDay } from '@/services/chatService';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTabBarMetrics } from '@/hooks/use-tab-bar';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { MaxContentWidth, Spacing } from '@/theme';

/**
 * How long to wait for one modal to finish sliding away before presenting the
 * next.
 *
 * The picker is presented by the OS from the same root view controller the
 * `Sheet`'s `Modal` is dismissing from, and asking iOS to present over a
 * controller that is mid-dismissal is the one that silently does nothing —
 * the same two-modals-in-one-frame hazard that keeps this screen down to a
 * single `Sheet`. `animationType="slide"` runs about 300 ms, so this waits it
 * out rather than racing it. Android and web present their pickers as their
 * own activity or a file input and need no such gap.
 *
 * It is now paid **twice**, in both directions: the sheet closes before the
 * picker opens, and the picker closes before the sheet comes back holding the
 * confirmation step. The second one is the same hazard with the roles swapped
 * — our `Modal` presenting over the picker's dismissal — and skipping it is a
 * sheet that never appears, leaving a photo picked and nothing to send it with.
 */
const MODAL_DISMISS_MS = 350;

const modalDismissed = () =>
  Platform.OS === 'ios'
    ? new Promise((resolve) => setTimeout(resolve, MODAL_DISMISS_MS))
    : Promise.resolve();

/**
 * How far the conversation must actually travel under the finger before the
 * drag is read as "I have stopped typing" and the keyboard is put away.
 *
 * `keyboardDismissMode="on-drag"` — what this screen used to carry — fires on
 * `onScrollBeginDrag`, which lands the moment a touch moves by a pixel. It has
 * no notion of distance, so nudging the list to read the line above the
 * composer, or brushing it on the way to a bubble, closed the keyboard and lost
 * the draft's place. RN's own source names a second cost on Android
 * (`ScrollView.js`, `_handleScrollBeginDrag`): that event also fires when a
 * finger *stops* momentum, so tapping to halt a fling dismissed the keyboard
 * too.
 *
 * 28 px is above thumb jitter and the few pixels a scroll view gives back when
 * a touch lands on a moving list, and well under a deliberate flick — the same
 * order as a platform pan slop, which is the threshold this is standing in for.
 *
 * iOS's native `interactive` was the other candidate and is what WhatsApp uses,
 * but it does not survive contact with `KeyboardAvoidingView`: that component
 * subscribes to `keyboardWillShow`/`keyboardWillHide` only (see its
 * `componentDidMount`), and an interactive dismissal reports its progress as
 * `keyboardWillChangeFrame`, so the composer would hold its full keyboard-height
 * padding — visibly detaching from the keyboard sliding away beneath it — until
 * the gesture committed. Tracking the frame properly means
 * `react-native-keyboard-controller`, which is a dependency this project has
 * argued itself out of adding for less.
 */
const KEYBOARD_DISMISS_DRAG_PX = 28;

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
    beginImage,
    discardImage,
    sendImage,
    deleteMessage,
    createTask,
    setTaskStatus,
    currentMember,
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

  // One sheet, four states — not four sheets. Dismissing a native modal while
  // presenting another in the same frame is unreliable on iOS, so "Create task"
  // and the photo confirmation each change what the open sheet holds rather
  // than handing off to a second one.
  const [sheet, setSheet] = useState<'none' | 'actions' | 'task' | 'photo'>('none');
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  // The photo flow outlives the sheet that starts it — the picker closes it —
  // so its progress and its failure belong to the screen, in the strip above
  // the composer. `ChatComposer` keeps its own error slot for the draft it
  // owns; a photo has no draft to preserve, so the two never share a line.
  /**
   * `preparing` is the picker and the gaps either side of it, which have
   * nothing to show yet; `uploading` is the compress-and-transfer, which has a
   * bubble showing it. See `pickPhoto` and `confirmPhoto` for why the
   * difference is worth a third value over a boolean.
   */
  const [photoStage, setPhotoStage] = useState<'idle' | 'preparing' | 'uploading'>('idle');
  const [photoError, setPhotoError] = useState<string | null>(null);

  /** The picked file waiting on the confirmation sheet. Never uploaded as-is. */
  const [pendingAsset, setPendingAsset] = useState<PickedAsset | null>(null);

  /** The message a long press asked about, plus that dialog's own two states. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The sheet's row stays busy for the whole flow — re-opening it mid-upload
  // and finding "Send photo" ready to press again would invite a second one.
  const isSendingPhoto = photoStage !== 'idle';

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
   * Where the list stood when the current drag started, or null when no finger
   * is driving it — which is also what makes momentum and the `scrollToEnd`
   * below unable to dismiss anything. Cleared once a drag has dismissed, so one
   * continuous drag can only spend the keyboard once.
   *
   * A ref rather than state: it changes on every scroll frame and nothing
   * renders from it.
   */
  const dragOrigin = useRef<number | null>(null);

  const handleScrollBeginDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    dragOrigin.current = event.nativeEvent.contentOffset.y;
  }, []);

  /**
   * The intent test. Either direction counts — reading back through the day and
   * chasing the newest message are both somebody looking rather than typing —
   * but only past `KEYBOARD_DISMISS_DRAG_PX`.
   */
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const origin = dragOrigin.current;

    if (origin === null) return;
    if (Math.abs(event.nativeEvent.contentOffset.y - origin) < KEYBOARD_DISMISS_DRAG_PX) return;

    dragOrigin.current = null;
    Keyboard.dismiss();
  }, []);

  const handleScrollEndDrag = useCallback(() => {
    dragOrigin.current = null;
  }, []);

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
   *
   * **Picking no longer sends.** This half stops at the confirmation sheet: it
   * opens the picker and, if something comes back, puts the sheet up again in
   * `photo` mode holding the original file. Nothing is compressed, nothing is
   * uploaded and no row exists yet, so backing out of that sheet costs one
   * discarded selection and no network at all.
   *
   * The strip above the composer carries this half, because there is nothing
   * else on screen to show for it — the picker is the OS's own surface and the
   * gap on either side of it is ours.
   */
  const pickPhoto = useCallback(async () => {
    setSheet('none');
    setPhotoError(null);

    if (!profile?.family_id) return;

    setPhotoStage('preparing');

    await modalDismissed();

    if (!isMounted()) return;

    const picked = await pickImage();

    if (!isMounted()) return;

    if (picked.error) {
      setPhotoError(errorText(i18n, picked.error));
      setPhotoStage('idle');
      return;
    }

    // Null data with no error is a cancel, which is an answer and not a fault.
    if (!picked.data) {
      setPhotoStage('idle');
      return;
    }

    // The picker's own dismissal has to finish before our sheet is presented
    // over the same controller — see `MODAL_DISMISS_MS`.
    await modalDismissed();

    if (!isMounted()) return;

    setPendingAsset(picked.data);
    setPhotoStage('idle');
    setSheet('photo');
  }, [i18n, isMounted, profile?.family_id]);

  /**
   * The other half: what "Send" in the confirmation sheet actually does.
   *
   * Compress, upload, post — and the bubble goes up *first*, on the original
   * file, so the photo is in the conversation from the moment the user commits
   * to it rather than after a re-encode they have no reason to wait through.
   * The two files look the same; the compressed one differs only in bytes.
   *
   * Every failure takes the bubble back out and reports itself in the strip,
   * which is the one thing the bubble cannot do for itself.
   */
  const confirmPhoto = useCallback(
    async (caption: string) => {
      const asset = pendingAsset;

      setSheet('none');
      setPendingAsset(null);

      if (!asset || !profile?.family_id) return;

      // Decided once, used three times: the placeholder, the object name and
      // the row's primary key are one id, which is what lets the confirmed
      // message replace the bubble instead of arriving underneath it.
      const messageId = newMessageId();

      // The photo joins the conversation here, before a byte has been sent.
      beginImage(messageId, asset.uri, caption);
      setPhotoStage('uploading');

      const compressed = await compressImage(asset);

      if (compressed.error) {
        // Unguarded by `isMounted`: the placeholder is in the family context,
        // not in this screen, so leaving the tab mid-send must still take it
        // back out — otherwise it sits there as a photo that is forever going.
        discardImage(messageId);

        if (!isMounted()) return;

        setPhotoError(errorText(i18n, compressed.error));
        setPhotoStage('idle');
        return;
      }

      const uploaded = await uploadChatImage(profile.family_id, messageId, compressed.data);

      if (uploaded.error) {
        discardImage(messageId);

        if (!isMounted()) return;

        setPhotoError(errorText(i18n, uploaded.error));
        setPhotoStage('idle');
        return;
      }

      // `sendImage` removes the placeholder itself if the insert fails, for the
      // same reason and with the same indifference to this screen being mounted.
      const failure = await sendImage(messageId, uploaded.data, caption);

      if (!isMounted()) return;

      setPhotoError(failure);
      setPhotoStage('idle');
    },
    [beginImage, discardImage, i18n, isMounted, pendingAsset, profile?.family_id, sendImage],
  );

  /**
   * Long-pressing a bubble asks to delete it; this is the answer.
   *
   * The write stays *inside* `ConfirmDialog` — the dialog holds its own
   * spinner and renders a refusal in place rather than dismissing and leaving
   * the failure to be reported somewhere else. `deleteMessage` is optimistic,
   * so the bubble is already gone by the time this resolves; on a refusal it
   * comes back and the reason appears in the dialog that is still open.
   */
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;

    setDeleteError(null);
    setIsDeleting(true);

    const failure = await deleteMessage(pendingDelete);

    if (!isMounted()) return;

    setIsDeleting(false);

    if (failure) {
      setDeleteError(failure);
      return;
    }

    setPendingDelete(null);
  }, [deleteMessage, isMounted, pendingDelete]);

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
            // Dragging the conversation still puts the keyboard away, in
            // either direction — reading back through the day is the clearest
            // signal that somebody has stopped typing. But *this screen*
            // decides when a drag has meant it, so the built-in mode is off;
            // see `KEYBOARD_DISMISS_DRAG_PX`.
            keyboardDismissMode="none"
            onScrollBeginDrag={handleScrollBeginDrag}
            onScroll={handleScroll}
            onScrollEndDrag={handleScrollEndDrag}
            // iOS sends `onScroll` once per drag at the default 0, which would
            // leave the test above reading only the first frame of a gesture.
            scrollEventThrottle={16}
            // A tap that lands on something still counts, and one that lands on
            // nothing dismisses — which is the "tap outside" half. Without this
            // the first tap anywhere in the list is swallowed, so opening a
            // photo or long-pressing a bubble would need two.
            keyboardShouldPersistTaps="handled"
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
                      // Mirrors `messages: delete own or admin`, which is the
                      // policy that actually decides. Unlike `canActOnTask`
                      // this is not a courtesy over a permissive policy — a
                      // non-owner who got past it would have the delete refused
                      // by RLS and the bubble put back.
                      canDelete={isOwn || !!currentMember?.isAdmin}
                      onRequestDelete={() => {
                        setDeleteError(null);
                        setPendingDelete(message.id);
                      }}
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

        {/*
          Only while there is no bubble to look at, plus failures. Once the
          photo is in the stream under its own veil this strip would be the
          second place on one screen saying the upload is running.
        */}
        {photoStage === 'preparing' || photoError ? (
          <View
            style={[
              styles.photoStatus,
              { backgroundColor: colors.surface, borderTopColor: colors.border },
            ]}>
            {photoError ? null : <ActivityIndicator size="small" color={colors.textTertiary} />}
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
            onSendPhoto={() => void pickPhoto()}
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

        {/* Same reason it is unmounted on close: the caption lives in the
            composer's own state, so discarding the selection discards the
            draft with it rather than leaving it to greet the next photo. */}
        {sheet === 'photo' && pendingAsset ? (
          <PhotoComposer
            asset={pendingAsset}
            onCancel={() => {
              setSheet('none');
              setPendingAsset(null);
            }}
            onSend={(caption) => void confirmPhoto(caption)}
          />
        ) : null}
      </Sheet>

      {/*
        The screen owns one dialog rather than each bubble owning its own: a
        `Modal` per message would mount two hundred of them to ask one question.
        It can never be open at the same time as the `Sheet` above — a long
        press happens on the message list, which the sheet covers.
      */}
      <ConfirmDialog
        visible={pendingDelete !== null}
        title={t('chat.deleteTitle')}
        message={t('chat.deleteMessage')}
        confirmLabel={t('chat.deleteConfirm')}
        tone="danger"
        loading={isDeleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError(null);
        }}
      />
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
