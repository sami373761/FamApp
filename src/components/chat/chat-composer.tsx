import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { MAX_MESSAGE_LENGTH } from '@/services/chatService';
import { Radius, Spacing } from '@/theme';

type ChatComposerProps = {
  /** Resolves to an error message to show, or null once the row is stored. */
  onSend: (text: string) => Promise<string | null>;
  /** Opens the "+" menu — creating a task, and eventually sending a photo. */
  onOpenActions: () => void;
  /**
   * Room kept under the bar for the floating tab island. Padding rather than a
   * gap, so the composer's own surface still runs to the bottom of the screen
   * and the island reads as floating over it rather than over the canvas.
   */
  bottomInset?: number;
};

/**
 * Message input bar.
 *
 * The leading "+" is the app's main way into task creation, which is why it
 * sits at the composer's own edge rather than behind a tab: making a task is
 * something you do mid-conversation, about the conversation. Sending text is
 * real — the draft is only cleared once the insert has come back.
 */
export function ChatComposer({ onSend, onOpenActions, bottomInset = 0 }: ChatComposerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_MESSAGE_LENGTH && !isSending;

  async function send() {
    if (!canSend) return;

    setIsSending(true);
    setError(null);

    const failure = await onSend(trimmed);

    // The draft survives a failure so nothing typed is ever lost.
    if (failure) setError(failure);
    else setDraft('');

    setIsSending(false);
  }

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: bottomInset },
      ]}>
      {error ? (
        <Text variant="caption" color="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <View style={styles.bar}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('chat.addA11y')}
          accessibilityHint={t('chat.addHint')}
          onPress={onOpenActions}
          feedback="tap"
          hitSlop={6}
          style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="add" size={24} color={colors.primary} />
        </PressableScale>

        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('chat.composerPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={MAX_MESSAGE_LENGTH}
          editable={!isSending}
          style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
        />

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('chat.sendA11y')}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() => void send()}
          // Sending is the composer's primary action, and the only one here
          // that writes a row.
          feedback="press"
          hitSlop={6}
          style={[
            styles.iconButton,
            { backgroundColor: canSend ? colors.primary : colors.surfaceMuted },
          ]}>
          {isSending ? (
            <ActivityIndicator size="small" color={colors.textTertiary} />
          ) : (
            <Ionicons name="send" size={18} color={canSend ? colors.onPrimary : colors.textTertiary} />
          )}
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
  error: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 40,
    // Caps growth at roughly five lines before the field scrolls internally.
    maxHeight: 120,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    fontSize: 15,
  },
});
