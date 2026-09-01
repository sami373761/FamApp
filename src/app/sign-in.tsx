import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button, NavHeader, Screen, Text, TextField } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { errorText } from '@/services/result';
import { Spacing } from '@/theme';

export default function SignInScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { signInWithEmail, signInWithGoogle } = useAuth();
  // A successful sign-in flips a guard in `RootNavigator`, which unmounts this
  // screen while the handler below is still mid-await. Every `setState` past an
  // await is therefore conditional on the screen still being there.
  const isMounted = useIsMounted();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'email' | 'google' | null>(null);

  const canSubmit = email.trim().length > 3 && password.length > 0 && pending === null;

  // No navigation on success: the session lands in AuthContext and the root
  // navigator swaps the stack out from under this screen.
  async function submit() {
    if (!canSubmit) return;

    setPending('email');
    setError(null);

    const { error: failure } = await signInWithEmail(email, password);

    if (!isMounted()) return;

    if (failure) {
      setError(errorText(i18n, failure));
      setPending(null);
    }
  }

  async function submitGoogle() {
    setPending('google');
    setError(null);

    const { error: failure } = await signInWithGoogle();

    if (!isMounted()) return;

    // Cancelling is a deliberate choice, not something to scold the user about.
    if (failure && failure.code !== 'OAUTH_CANCELLED') setError(errorText(i18n, failure));
    setPending(null);
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {/* Reachable by URL on web, where nothing sits underneath it. */}
      <NavHeader title={t('signIn.title')} backFallback="/" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.flex}>
          <Text variant="title" style={styles.heading}>
            {t('signIn.heading')}
          </Text>
          <Text variant="body" color="textSecondary">
            {t('signIn.subtitle')}
          </Text>

          <View style={styles.form}>
            <TextField
              label={t('signIn.email')}
              value={email}
              onChangeText={setEmail}
              placeholder={t('signIn.emailPlaceholder')}
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              editable={pending === null}
            />

            <TextField
              label={t('signIn.password')}
              value={password}
              onChangeText={setPassword}
              placeholder={t('signIn.passwordPlaceholder')}
              secureTextEntry
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={pending === null}
              error={error ?? undefined}
            />
          </View>

          <Button
            label={t('signIn.submit')}
            disabled={!canSubmit}
            loading={pending === 'email'}
            onPress={submit}
            style={styles.submit}
          />

          <View style={styles.divider}>
            <View style={[styles.rule, { backgroundColor: colors.separator }]} />
            <Text variant="caption" color="textTertiary">
              {t('common.or')}
            </Text>
            <View style={[styles.rule, { backgroundColor: colors.separator }]} />
          </View>

          <Button
            label={t('signIn.google')}
            variant="secondary"
            loading={pending === 'google'}
            disabled={pending !== null}
            onPress={submitGoogle}
            leading={<Ionicons name="logo-google" size={18} color={colors.text} />}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.replace('/sign-up')}
          style={styles.footer}>
          <Text variant="caption" color="textSecondary">
            {t('signIn.newHere')}
          </Text>
          <Text variant="captionStrong" color="accent">
            {t('signIn.createAccount')}
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: { marginTop: Spacing.lg },
  form: { gap: Spacing.lg, marginTop: Spacing.xl },
  submit: { marginTop: Spacing.xl },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginVertical: Spacing.xl,
  },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
});
