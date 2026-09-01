import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { clockTime, memberName } from '@/data/format';
import type { ChatMessage, FamilyMember } from '@/data/types';
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
};

/** WhatsApp-style bubble: own messages right-aligned and tinted, others left. */
export function MessageBubble({ message, sender, isOwn, showAuthor }: MessageBubbleProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();

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

      <View
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

        {message.type === 'image' && message.mediaUrl ? (
          <ChatImage
            path={message.mediaUrl}
            label={i18n.t('chat.photoA11y', {
              name: sender ? memberName(i18n, sender) : i18n.t('common.someone'),
            })}
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
          {isOwn ? <Ionicons name="checkmark-done" size={13} color={colors.onPrimary} /> : null}
        </View>
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
function ChatImage({ path, label }: { path: string; label: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isMounted = useIsMounted();
  const [status, setStatus] = useState<ChatImageStatus>('signing');
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setStatus('signing');
    setUrl(null);

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

  return (
    <View style={[styles.image, { backgroundColor: colors.surfaceMuted }]}>
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
          accessibilityLabel={label}
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
    </View>
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
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
});
