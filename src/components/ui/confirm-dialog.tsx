import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useHaptics } from '@/hooks/use-haptics';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Motion, Radius, Shadow, Spacing } from '@/theme';

/** How small the card starts. Nearer to 1 than a sheet's travel: the dialog is
 *  already in the middle of the screen, so it only has to arrive, not travel. */
const ENTER_SCALE = 0.94;

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
  /**
   * The mark above the title. `danger` supplies its own, because a destructive
   * question is worth recognising before it is read; a neutral one renders none
   * unless the caller asks, since an icon on every dialog stops meaning
   * anything on the one that needs it.
   */
  icon?: keyof typeof Ionicons.glyphMap;
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
 *
 * The entrance is driven here for the same reason `Sheet`'s is: `animationType`
 * fades the whole window, so the card and its scrim arrive as one flat layer.
 * Separating them lets the scrim fade where it is while the card scales up out
 * of it, which is the difference between a dialog appearing and a dialog
 * arriving.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  icon,
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const haptic = useHaptics();

  const useNativeDriver = Platform.OS !== 'web';

  // The Modal outlives `visible` by one animation; see `Sheet`.
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: Motion.duration.base,
        easing: Easing.out(Easing.cubic),
        useNativeDriver,
      }).start();

      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: Motion.duration.exit,
      easing: Easing.in(Easing.quad),
      useNativeDriver,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [progress, useNativeDriver, visible]);

  /*
    A refusal is the one outcome the user is not expecting, and it lands inside
    a dialog they are already looking at — so nothing else on screen moves to
    announce it. The error pattern is what makes it register.
  */
  useEffect(() => {
    if (error) haptic('error');
  }, [error, haptic]);

  const mark = icon ?? (tone === 'danger' ? 'alert-circle' : undefined);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      // Android's hardware back, and Escape on web.
      onRequestClose={loading ? undefined : onCancel}>
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: colors.overlay, opacity: progress },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.dismiss', { title })}
            disabled={loading}
            onPress={onCancel}
            style={styles.flex}
          />
        </Animated.View>

        {/* The backdrop is a sibling rather than this card's parent, so a press
            landing here was never going to reach it. */}
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: progress,
              transform: [
                {
                  /*
                    A hair past its own size before it settles. The overshoot is
                    shaped here rather than in the easing so `progress` stays a
                    clean 0 → 1 — a back curve on the timing itself would push
                    the opacity above 1 as well, which is a clamp waiting to be
                    forgotten.
                  */
                  scale: progress.interpolate({
                    inputRange: [0, 0.7, 1],
                    outputRange: [ENTER_SCALE, 1.012, 1],
                  }),
                },
              ],
            },
          ]}>
          {mark ? (
            <View
              style={[
                styles.mark,
                { backgroundColor: tone === 'danger' ? colors.dangerSoft : colors.primarySoft },
              ]}>
              <Ionicons
                name={mark}
                size={22}
                color={tone === 'danger' ? colors.danger : colors.primary}
              />
            </View>
          ) : null}

          <Text variant="heading">{title}</Text>

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
        </Animated.View>
      </View>
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
    // One step up from a card: a dialog sits above everything else on screen
    // and its corner should say so.
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    ...Shadow.floating,
  },
  mark: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // Sits a little clear of the title it introduces.
    marginBottom: Spacing.xs,
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
