import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

/**
 * Welcome screen — deliberately minimal: logo, app name and the two ways in.
 *
 * Those two ways are now sign-up and sign-in rather than create/join: a family
 * belongs to an account, so `create-family` and `join-family` are not even
 * mounted until there is a session (see `RootNavigator`). Choosing between
 * creating and joining happens on the other side of auth.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.brand}>
          <View style={[styles.logo, { backgroundColor: colors.primary }]}>
            <Ionicons name="people" size={36} color={colors.onPrimary} />
          </View>

          <Text variant="display" center>
            FamApp
          </Text>
        </View>

        <View style={styles.actions}>
          <Button label={t('welcome.getStarted')} onPress={() => router.push('/sign-up')} />
          <Button
            label={t('welcome.haveAccount')}
            variant="secondary"
            onPress={() => router.push('/sign-in')}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', paddingVertical: Spacing.xxxl },
  brand: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg },
  logo: {
    width: 76,
    height: 76,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { gap: Spacing.md },
});
