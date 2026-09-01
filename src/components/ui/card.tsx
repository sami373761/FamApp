import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Shadow, Spacing } from '@/theme';

type CardProps = {
  children: ReactNode;
  /** Supplying this turns the card into a pressable surface. */
  onPress?: () => void;
  style?: ViewStyle;
  padded?: boolean;
};

/** Elevated surface used for every grouped block of content. */
export function Card({ children, onPress, style, padded = true }: CardProps) {
  const { colors } = useTheme();

  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  };

  if (onPress) {
    return (
      // A card is a surface, not a control: `tap` is the lightest thing the
      // engine does, because a list of them would otherwise chatter — and the
      // dip is softer than a button's for the same reason. The same 3% on
      // something this wide is a visibly larger movement than it is on a chip.
      <PressableScale
        onPress={onPress}
        feedback="tap"
        scaleTo={0.98}
        style={[styles.card, base, padded && styles.padded, style]}>
        {children}
      </PressableScale>
    );
  }

  return <View style={[styles.card, base, padded && styles.padded, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    ...Shadow.card,
  },
  padded: { padding: Spacing.lg },
});
