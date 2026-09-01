import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { MaxContentWidth, Spacing } from '@/theme';

type ScreenProps = {
  children: ReactNode;
  /** Wraps content in a ScrollView. Turn off for screens that manage their own list. */
  scroll?: boolean;
  /** Removes the default horizontal gutter (used by full-bleed screens like Map). */
  padded?: boolean;
  /**
   * Which insets to apply. Tab screens omit 'bottom' because the tab bar
   * already sits in that inset.
   */
  edges?: readonly Edge[];
  contentContainerStyle?: ViewStyle;
  /** Adds pull-to-refresh. Ignored unless `scroll` is set. */
  onRefresh?: () => void;
  refreshing?: boolean;
};

/**
 * Standard screen shell: safe-area insets, themed background, and a max content
 * width so layouts stay readable on tablets and web.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top'],
  contentContainerStyle,
  onRefresh,
  refreshing = false,
}: ScreenProps) {
  const { colors } = useTheme();

  const inner = (
    <View style={[styles.constrain, padded && styles.padded, contentContainerStyle]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={edges}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.textTertiary}
                colors={[colors.primary]}
              />
            ) : undefined
          }>
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: Spacing.xxl },
  constrain: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  padded: { paddingHorizontal: Spacing.lg },
});
