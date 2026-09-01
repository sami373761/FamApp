import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Shadow, Spacing } from '@/theme';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  /** Say what will actually happen, including what cannot be undone. */
  message: string;
  confirmLabel: string;
  /** Defaults to the translated "Cancel"; pass one only to say something else. */
  cancelLabel?: string;
  /** `danger` for anything that destroys data. */
  tone?: 'primary' | 'danger';
  /** Keeps the dialog open with the action spinning while the write is in flight. */
  loading?: boolean;
  /** Rendered inside the dialog, so a failure does not close it. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The one way the app asks "are you sure?".
 *
 * A `Modal` rather than RN's `Alert`, which does not exist on web — and the
 * destructive actions this guards (removing a member, deleting an account) have
 * to be confirmable on every target the app runs on. Keeping the write inside
 * the dialog is what lets a failed confirmation report itself in place instead
 * of dismissing and leaving the caller to surface an error somewhere else.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's hardware back, and Escape on web.
      onRequestClose={loading ? undefined : onCancel}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.dismiss', { title })}
        disabled={loading}
        onPress={onCancel}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        {/*
          The card swallows presses so tapping inside it does not fall through
          to the backdrop and dismiss the dialog.
        */}
        <Pressable
          accessibilityViewIsModal
          onPress={() => undefined}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="subheading">{title}</Text>

          <Text variant="body" color="textSecondary">
            {message}
          </Text>

          {error ? (
            <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              <Text variant="caption" color="danger" style={styles.flex}>
                {error}
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              label={cancelLabel ?? t('common.cancel')}
              variant="secondary"
              size="md"
              disabled={loading}
              onPress={onCancel}
              style={styles.flex}
            />
            <Button
              label={confirmLabel}
              variant={tone === 'danger' ? 'danger' : 'primary'}
              size="md"
              loading={loading}
              onPress={onConfirm}
              style={styles.flex}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    gap: Spacing.md,
    padding: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    ...Shadow.floating,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
});
