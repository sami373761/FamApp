import { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useSafeBack } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

type NavHeaderProps = {
  title?: string;
  /** Hides the back control on root screens. */
  showBack?: boolean;
  /**
   * Where back goes when the stack is empty — a screen reached by URL, or the
   * first screen of a `Stack.Protected` branch. Without one the control is not
   * rendered at all rather than rendered dead.
   */
  backFallback?: Href;
  /** Text action on the trailing side — "Skip", "Done". Same shape as `Section`. */
  actionLabel?: string;
  onActionPress?: () => void;
  /** Blocks the action while a write is in flight. */
  actionDisabled?: boolean;
};

/** Lightweight header for stack screens (the native header is disabled). */
export function NavHeader({
  title,
  showBack = true,
  backFallback,
  actionLabel,
  onActionPress,
  actionDisabled = false,
}: NavHeaderProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const goBack = useSafeBack(backFallback);

  // A chevron that cannot go anywhere is worse than no chevron: it reads as a
  // way out and is not one. The stack depth of a mounted screen does not change
  // underneath it, so reading this at render is stable.
  const canGoBack = showBack && (!!backFallback || router.canGoBack());

  return (
    <View style={styles.header}>
      {canGoBack ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('common.goBack')}
          onPress={goBack}
          feedback="tap"
          // A 38pt square: the standard dip barely registers at this size.
          scaleTo={0.92}
          hitSlop={8}
          style={[styles.back, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </PressableScale>
      ) : (
        <View style={styles.back} />
      )}

      {title ? <Text variant="subheading">{title}</Text> : null}

      {actionLabel ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ disabled: actionDisabled }}
          disabled={actionDisabled}
          onPress={onActionPress}
          feedback="tap"
          scaleTo={0.94}
          hitSlop={8}
          // After the animated opacity, so a disabled action stays flat however
          // the press animation last left it.
          style={[styles.action, actionDisabled && styles.dimmed]}>
          {/* Accent, not primary: a header action is never the filled CTA. */}
          <Text variant="captionStrong" color="accent">
            {actionLabel}
          </Text>
        </PressableScale>
      ) : (
        // Spacer keeps the title optically centred against the back button.
        <View style={styles.back} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: { minWidth: 38, height: 38, alignItems: 'flex-end', justifyContent: 'center' },
  dimmed: { opacity: 0.4 },
});
