import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { MaxContentWidth, Radius, Shadow, Spacing } from '@/theme';

type SheetProps = {
  visible: boolean;
  /** Named for screen readers even when no visible title is wanted. */
  title: string;
  /** Hides the title row for a sheet whose content speaks for itself. */
  showTitle?: boolean;
  /** Optional line under the title — what this sheet is for. */
  description?: string;
  /** Blocks dismissal while a write is in flight. */
  dismissible?: boolean;
  onClose: () => void;
  children: ReactNode;
};

/**
 * A panel that rises from the bottom edge — the app's action sheet and its
 * modal forms.
 *
 * A `Modal` for the same reason `ConfirmDialog` is one: RN's `ActionSheetIOS`
 * is iOS-only and `Alert` does not exist on web, and this app has to behave the
 * same on all three targets. `ConfirmDialog` stays separate rather than being
 * rebuilt on top of this: it is a centred question with two answers, not a
 * surface, and collapsing the two would blur when to reach for which.
 *
 * Dismissal is deliberately available three ways — backdrop, hardware back and
 * Escape (both via `onRequestClose`), and whatever the content offers — because
 * a sheet that traps the user is the crash they report as one.
 */
export function Sheet({
  visible,
  title,
  showTitle = true,
  description,
  dismissible = true,
  onClose,
  children,
}: SheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Android's hardware back, and Escape on web.
      onRequestClose={dismissible ? onClose : undefined}>
      {/*
        The keyboard is handled here rather than inside each sheet's content,
        because a `KeyboardAvoidingView` nested in another one applies the inset
        twice and lifts the panel clear off the keyboard it was avoiding.

        Android needs `height` rather than nothing: a `Modal` is its own window
        and does not inherit the activity's `adjustResize`, so without it a
        focused field at the bottom of a sheet sits under the keyboard.
      */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss', { title })}
          disabled={!dismissible}
          onPress={onClose}
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          {/* Swallows presses so tapping inside the panel does not fall
              through to the backdrop and dismiss it. */}
          <Pressable
            accessibilityViewIsModal
            onPress={() => undefined}
            style={[
              styles.panel,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                // The home indicator sits under the last row otherwise.
                paddingBottom: Spacing.lg + insets.bottom,
              },
            ]}>
            <View style={[styles.grabber, { backgroundColor: colors.separator }]} />

            {showTitle ? (
              <View style={styles.heading}>
                <Text variant="subheading">{title}</Text>
                {description ? (
                  <Text variant="caption" color="textSecondary">
                    {description}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Bottom-aligned: the panel rises from the edge the thumb is already near.
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    width: '100%',
    maxWidth: MaxContentWidth,
    // Bounded by the backdrop, which is what the keyboard shrinks — so content
    // that scrolls (`flexShrink: 1`) yields instead of pushing its own footer
    // off the bottom of the screen.
    maxHeight: '100%',
    alignSelf: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    ...Shadow.floating,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    alignSelf: 'center',
    marginBottom: Spacing.xs,
  },
  heading: { gap: 2 },
});
