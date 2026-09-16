import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ImageViewer } from '@/components/chat/image-viewer';
import { Avatar } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { clockTime, memberName } from '@/data/format';
import type { ChatMessage, FamilyMember } from '@/data/types';
import { useHaptics } from '@/hooks/use-haptics';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { forgetSignedMediaUrl, getSignedMediaUrl } from '@/services/chatMediaService';
import { Radius, Spacing } from '@/theme';

type MessageBubbleProps = {
  message: ChatMessage;
  /** Resolved by the caller — undefined for a member who has since left. */
  sender?: FamilyMember;
  /** True when this message was sent by the signed-in user. */
  isOwn: boolean;
  /** False when the previous message came from the same person — hides the avatar/name. */
  showAuthor: boolean;
  /**
   * Whether the long press has anything to open — the screen's reading of what
   * this message can do, which is `messages: delete own or admin` for the
   * delete row and "there is a family and some text" for the task row. False
   * makes the bubble inert rather than opening a menu with nothing live in it.
   */
  canAct?: boolean;
  /**
   * Asks the screen to open the message menu. The bubble neither deletes
   * anything nor creates anything itself — it only reports the gesture.
   */
  onRequestActions?: () => void;
};

/** WhatsApp-style bubble: own messages right-aligned and tinted, others left. */
export function MessageBubble({
  message,
  sender,
  isOwn,
  showAuthor,
  canAct = false,
  onRequestActions,
}: MessageBubbleProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const haptic = useHaptics();

  /**
   * A pending photo has no row yet — nothing to delete, and nothing a task
   * could be linked to — so long-pressing one would offer actions against
   * something the server has never heard of. The send is a second or two long
   * and finishes on its own; waiting it out is the simpler story than a cancel
   * that has to unpick a half-finished upload.
   */
  const canLongPress = canAct && !!onRequestActions && !message.pending;

  /**
   * Fired here rather than left to `PressableScale`, whose one haptic answers
   * `onPress` — a tap on a bubble does nothing at all and must stay silent,
   * while the long press has just opened a menu and should be felt. `tap` is
   * the effect for reaching a list of choices; the destructive `warning` moved
   * to the delete row's own confirmation, which is where something is actually
   * being risked.
   */
  const handleLongPress = () => {
    if (!canLongPress) return;

    haptic('tap');
    onRequestActions?.();
  };

  return (
    <View style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}>
      {!isOwn ? (
        <View style={styles.avatarSlot}>
          {showAuthor && sender ? (
            <Avatar
              initials={sender.initials}
              colorIndex={sender.colorIndex}
              avatar={sender.avatar}
              size="sm"
            />
          ) : null}
        </View>
      ) : null}

      <PressableScale
        // `none`: a bubble is not a button, and a tap on one does nothing at
        // all — buzzing for that would be feedback for a non-event.
        feedback="none"
        disabled={!canLongPress}
        onLongPress={handleLongPress}
        accessibilityRole={canLongPress ? 'button' : undefined}
        accessibilityHint={canLongPress ? i18n.t('chat.actionsHint') : undefined}
        style={[
          styles.bubble,
          {
            backgroundColor: isOwn ? colors.primary : colors.surface,
            borderColor: isOwn ? 'transparent' : colors.border,
          },
          isOwn ? styles.bubbleOwn : styles.bubbleOther,
        ]}>
        {!isOwn && showAuthor && sender ? (
          <Text variant="captionStrong" color="textSecondary" style={styles.author}>
            {memberName(i18n, sender)}
          </Text>
        ) : null}

        {/*
          Two sources for one well. A pending photo is the local file this
          device just wrote and has no object path to sign; a sent one is a path
          and nothing else. They are separate components rather than one with a
          nullable path because almost nothing is shared — the pending one signs
          nothing, caches nothing, cannot fail and cannot be opened full screen.
        */}
        {message.type === 'image' && message.pending ? (
          <PendingImage uri={message.pending.localUri} />
        ) : message.type === 'image' && message.mediaUrl ? (
          <ChatImage
            path={message.mediaUrl}
            label={i18n.t('chat.photoA11y', {
              name: sender ? memberName(i18n, sender) : i18n.t('common.someone'),
            })}
            onLongPress={canLongPress ? handleLongPress : undefined}
          />
        ) : null}

        {message.content ? (
          <Text variant="body" style={isOwn ? { color: colors.onPrimary } : undefined}>
            {message.content}
          </Text>
        ) : null}

        <View style={styles.meta}>
          <Text variant="label" style={{ color: isOwn ? colors.onPrimary : colors.textTertiary }}>
            {clockTime(i18n, message.createdAt)}
          </Text>
          {/*
            The tick is "the family has this now", so a photo still uploading
            must not show one — it gets the clock every messaging app uses for
            the same moment. `createdAt` beside it is this device's guess until
            the row lands, which is the one thing on a pending bubble that can
            be a second or two wrong, and the least of anything worth saying.
          */}
          {isOwn ? (
            <Ionicons
              name={message.pending ? 'time-outline' : 'checkmark-done'}
              size={13}
              color={colors.onPrimary}
            />
          ) : null}
        </View>
      </PressableScale>
    </View>
  );
}

/**
 * The photo this device is still uploading.
 *
 * It is the *real* picked image, not a grey block: the file has existed on
 * disk since the picker returned it, and the bubble goes up the moment the user
 * presses Send — before the re-encode, so there is no wait to show a photo the
 * device is already holding. The veil over it is what says "not yet": a scrim in the
 * same `overlay` token every modal backdrop uses, plus a spinner.
 *
 * Not pressable, and that is the point of the distinction rather than an
 * oversight — full screen means the stored photo, and there is not one yet.
 * The bubble becomes pressable on its own when `sendImage` swaps this row for
 * the confirmed one, with no transition to arrange: the well is the same size
 * and holds the same picture.
 *
 * `cachePolicy="none"` because a `file://` URI is already local; caching it
 * would copy bytes the device is about to delete from its own cache directory.
 */
function PendingImage({ uri }: { uri: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={t('chat.photoSending')}
      style={[styles.image, { backgroundColor: colors.surfaceMuted }]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="none"
      />

      <View style={[styles.imageOverlay, { backgroundColor: colors.overlay }]}>
        <ActivityIndicator size="small" color={colors.viewerOnCanvas} />
      </View>
    </View>
  );
}

type ChatImageStatus = 'signing' | 'loading' | 'loaded' | 'failed';

/**
 * A photo message, which is three states rather than a source.
 *
 * `media_url` is an object path in a **private** bucket, so nothing can be
 * rendered until `chatMediaService` has signed it — which is a network call,
 * and the reason `signing` exists as a state of its own rather than being
 * folded into the image's own load. The well underneath is the same
 * `surfaceMuted` recess the placeholder always used, so the bubble does not
 * change size as the three states move through it.
 *
 * The failure is *terminal on purpose* and does not retry. Two of the ordinary
 * reasons — the 10-day media sweep took the object, or the caller has left the
 * family the key names — will still be true on the next attempt, and a bubble
 * that re-signs on every scroll pass would spend a request each time to arrive
 * at the same answer. The cached URL is dropped on the way out so a later
 * remount signs a fresh one rather than retrying a URL that has since expired.
 */
function ChatImage({
  path,
  label,
  onLongPress,
}: {
  path: string;
  label: string;
  /**
   * Forwarded from the bubble, because this pressable would otherwise swallow
   * it. RN gives the touch to the deepest view that claims it, and on a photo
   * message the picture *is* most of the bubble — so without this, long-pressing
   * the obvious target does nothing and only the thin margin around it works.
   */
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isMounted = useIsMounted();
  const [status, setStatus] = useState<ChatImageStatus>('signing');
  const [url, setUrl] = useState<string | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  /*
    The reset is adjusted during render rather than at the top of the effect
    below. A recycled bubble is a different photo, and resetting from an effect
    leaves one frame in which the *old* photo's signed URL is rendered under the
    new path — as well as being the cascading render React Compiler refuses. The
    effect is left with the one thing that has to happen after the commit: the
    request.
  */
  const [signedPath, setSignedPath] = useState(path);

  if (path !== signedPath) {
    setSignedPath(path);
    setStatus('signing');
    setUrl(null);
    // Leaving the viewer open across that swap would show the new photo under
    // the old one's gesture.
    setIsViewerOpen(false);
  }

  useEffect(() => {
    let cancelled = false;

    void getSignedMediaUrl(path).then(({ data, error }) => {
      if (cancelled || !isMounted()) return;

      if (error || !data) {
        setStatus('failed');
        return;
      }

      setUrl(data);
      setStatus('loading');
    });

    return () => {
      cancelled = true;
    };
  }, [isMounted, path]);

  // Only a photo that is actually on screen can be opened: there is nothing to
  // show full size while it is still signing, and a failed one would open onto
  // the same failure with more ceremony.
  const canOpen = status === 'loaded' && url !== null;

  return (
    <>
      <PressableScale
        accessibilityRole={canOpen ? 'imagebutton' : 'image'}
        accessibilityLabel={label}
        accessibilityHint={canOpen ? t('chat.photoOpenHint') : undefined}
        disabled={!canOpen}
        onPress={() => setIsViewerOpen(true)}
        onLongPress={onLongPress}
        style={[styles.image, { backgroundColor: colors.surfaceMuted }]}>
        {url ? (
          <Image
            // `cacheKey` is the object path, not the URL: a signed URL changes
            // every hour but the bytes behind it never do, so keying the disk
            // cache on the path is what stops an expiry re-downloading a photo
            // the device already has. It is the same reason the *row* stores a
            // path — today's signing scheme is not what identifies the object.
            source={{ uri: url, cacheKey: path }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            // The bubble states the photo; the pressable around it owns the
            // label and the role, so repeating it here would have a screen
            // reader announce the same photo twice.
            cachePolicy="disk"
            recyclingKey={path}
            onLoad={() => isMounted() && setStatus('loaded')}
            onError={() => {
              forgetSignedMediaUrl(path);
              if (isMounted()) setStatus('failed');
            }}
          />
        ) : null}

        {status === 'failed' ? (
          <View style={styles.imageOverlay}>
            <Ionicons name="image-outline" size={24} color={colors.textTertiary} />
            <Text variant="label" color="textTertiary" center>
              {t('chat.photoFailed')}
            </Text>
          </View>
        ) : status !== 'loaded' ? (
          // The skeleton is the well itself plus a spinner — nothing is drawn
          // over the image once it lands, so there is no fade to fight with.
          <View style={styles.imageOverlay}>
            <ActivityIndicator size="small" color={colors.textTertiary} />
          </View>
        ) : null}
      </PressableScale>

      {/*
        Mounted beside the bubble rather than inside it, and only once it has a
        URL: the viewer re-signs nothing, it borrows the one this bubble already
        resolved. Closing is local state, so a photo opened and shut leaves the
        message list exactly where it was.
      */}
      <ImageViewer
        visible={isViewerOpen}
        url={url}
        path={path}
        label={label}
        onClose={() => setIsViewerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, marginBottom: Spacing.sm },
  rowOwn: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  // Reserves avatar width so consecutive messages stay aligned.
  avatarSlot: { width: 32 },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  bubbleOwn: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4 },
  author: { marginBottom: 2 },
  image: {
    width: 220,
    // 4:3, so a portrait and a landscape photo both crop to the same well and
    // a run of photos does not make the day's messages jump about.
    height: 165,
    borderRadius: Radius.md,
    overflow: 'hidden',
    marginBottom: Spacing.xs,
  },
  imageOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
});
