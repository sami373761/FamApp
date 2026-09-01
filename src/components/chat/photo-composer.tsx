/**
 * The step between choosing a photo and sending it.
 *
 * **It exists to make sending deliberate.** Before it, the picker's own "Done"
 * was the send: one tap in the OS's UI and the photo was in the family chat,
 * with no moment in which to notice the wrong one had been chosen. Now the
 * picker only picks, and this is where the send happens — which is also the
 * only place a caption could ever have been typed, since there is no other
 * point at which the photo is chosen but not yet gone.
 *
 * The preview is the **original** file, not the re-encoded one. Compression is
 * deliberately deferred until "Send" is pressed, so a photo somebody thinks
 * better of costs a decode and an encode that were never needed — and showing
 * the original is the honest preview anyway, since it is what was picked.
 *
 * Content only, no `Sheet` of its own: Chat drives one sheet across four modes
 * because presenting one native modal while dismissing another in the same
 * frame is unreliable on iOS. For the same reason there is no
 * `KeyboardAvoidingView` here — `Sheet` owns the app's only one inside a modal,
 * and a second nested in it would apply the inset twice and lift the panel
 * clear off the keyboard it was avoiding. What this owes instead is a scroll
 * view that *yields* (`flexShrink: 1`), so the keyboard shrinks the middle and
 * the footer row stays on screen.
 */

import { useState } from 'react';
import { Image } from 'expo-image';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button, Text, TextField } from '@/components/ui';
import type { PickedAsset } from '@/services/chatMediaService';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

/** Mirrors `messages_content_length`, the same ceiling a typed message answers to. */
const MAX_CAPTION_LENGTH = 500;

type PhotoComposerProps = {
  asset: PickedAsset;
  /** Discards the selection entirely — nothing has been uploaded yet. */
  onCancel: () => void;
  /** The caption is trimmed to null by the service; passed as typed. */
  onSend: (caption: string) => void;
};

export function PhotoComposer({ asset, onCancel, onSend }: PhotoComposerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const [caption, setCaption] = useState('');

  /**
   * The preview keeps the photo's own shape rather than cropping it to a fixed
   * well the way the chat bubble does — this is the "is this the right one?"
   * moment, and answering it against a crop of the picture would be answering
   * a different question. Bounded so a tall portrait cannot push the caption
   * field and the buttons off a short window before the keyboard is even up.
   */
  const ratio = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 1;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.preview,
            { aspectRatio: ratio, maxHeight: height * 0.4, backgroundColor: colors.surfaceMuted },
          ]}>
          <Image
            source={{ uri: asset.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessibilityLabel={t('photoComposer.previewA11y')}
            // A local file that is about to be re-encoded and thrown away;
            // caching it would copy bytes with no second reader.
            cachePolicy="none"
          />
        </View>

        <TextField
          label={t('photoComposer.captionLabel')}
          placeholder={t('photoComposer.captionPlaceholder')}
          value={caption}
          onChangeText={setCaption}
          multiline
          maxLength={MAX_CAPTION_LENGTH}
          returnKeyType="done"
        />

        <Text variant="label" color="textTertiary">
          {t('photoComposer.hint')}
        </Text>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          label={t('common.cancel')}
          variant="secondary"
          size="md"
          onPress={onCancel}
          style={styles.action}
        />
        <Button
          label={t('photoComposer.send')}
          size="md"
          onPress={() => onSend(caption)}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Bounded by the sheet's own `maxHeight`, which is what the keyboard shrinks.
  root: { flexShrink: 1, gap: Spacing.md },
  scroll: { flexShrink: 1 },
  content: { gap: Spacing.md, paddingBottom: Spacing.sm },
  preview: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  actions: { flexDirection: 'row', gap: Spacing.sm, paddingBottom: Spacing.sm },
  action: { flex: 1 },
});
