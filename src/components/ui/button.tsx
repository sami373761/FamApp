import { ActivityIndicator, StyleSheet, View, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import type { HapticFeedback } from '@/hooks/use-haptics';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/theme';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'lg';

/**
 * `danger` is a soft fill rather than a solid red one. Solid `danger` carries
 * white text acceptably in light mode and badly in dark, where the token
 * lightens; the soft pair is the same background/foreground relationship the
 * danger `Badge` uses and holds up in both schemes.
 */
const LABEL_COLOR: Record<ButtonVariant, 'onPrimary' | 'accent' | 'danger'> = {
  primary: 'onPrimary',
  secondary: 'accent',
  ghost: 'accent',
  danger: 'danger',
};

/**
 * Weight follows the variant, not the size: a filled CTA and the confirm of a
 * destructive dialog are the two presses worth feeling, and `danger` gets the
 * warning pattern rather than a plain knock so the hand registers it as the
 * different kind of action it is.
 */
const FEEDBACK: Record<ButtonVariant, HapticFeedback> = {
  primary: 'press',
  secondary: 'tap',
  ghost: 'tap',
  danger: 'warning',
};

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Rendered before the label — typically an icon. */
  leading?: React.ReactNode;
  style?: ViewStyle;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  loading = false,
  leading,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const surface: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: colors.primary },
    secondary: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    ghost: { backgroundColor: 'transparent' },
    danger: { backgroundColor: colors.dangerSoft },
  };

  // Secondary and ghost buttons are secondary actions, so they carry the accent
  // colour; the filled brand green is reserved for the primary action.
  const labelColor = LABEL_COLOR[variant];

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      feedback={FEEDBACK[variant]}
      style={[
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        surface[variant],
        // After the animated opacity, so a disabled button stays flat at 0.4
        // however the press animation last left it.
        isDisabled && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors[labelColor]} />
      ) : (
        <View style={styles.content}>
          {leading}
          <Text variant="subheading" color={labelColor}>
            {label}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  md: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
  lg: { paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xl },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  disabled: { opacity: 0.4 },
});
