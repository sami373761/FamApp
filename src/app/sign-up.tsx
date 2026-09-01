import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, NavHeader, Screen, Text, TextField } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { errorText } from '@/services/result';
import { Spacing } from '@/theme';

/** Matches the `minimum_password_length` configured on the Supabase project. */
const MIN_PASSWORD_LENGTH = 6;

/** Matches `auth.email.otp_length` on the Supabase project. */
const CODE_LENGTH = 6;

/**
 * Seconds before "Send a new code" re-enables, matching the project's
 * `auth.email.max_frequency`. Asking early is a `RATE_LIMITED` failure, so the
 * countdown is there to keep the user from earning one.
 */
const RESEND_COOLDOWN = 60;

/**
 * Sign-up is two steps on one screen: credentials, then the 6-digit code that
 * arrives by email. Verifying mints a session, and the session — not a
 * `router` call — is what moves the user on (see `RootNavigator`).
 */
type Step = 'credentials' | 'verify';

export default function SignUpScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { signUpWithEmail, verifyEmailOtp, resendSignUpOtp, signInWithGoogle } = useAuth();
  // Both `submit` (confirmations off) and `verify` mint a session, which flips a
  // guard in `RootNavigator` and unmounts this screen mid-await. Nothing past an
  // await may assume it is still on screen.
  const isMounted = useIsMounted();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<'email' | 'google' | 'verify' | 'resend' | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const canSubmit =
    email.trim().length > 3 && password.length >= MIN_PASSWORD_LENGTH && pending === null;
  const canVerify = code.length === CODE_LENGTH && pending === null;

  // Self-rescheduling rather than an interval: one timer per tick, and it stops
  // itself at zero without needing a second piece of state to say so.
  useEffect(() => {
    if (resendIn <= 0) return;

    const timer = setTimeout(() => setResendIn(resendIn - 1), 1000);

    return () => clearTimeout(timer);
  }, [resendIn]);

  async function submit() {
    if (!canSubmit) return;

    setPending('email');
    setError(null);

    const { data, error: failure } = await signUpWithEmail(email, password);

    if (!isMounted()) return;

    if (failure) {
      setError(errorText(i18n, failure));
      setPending(null);
      return;
    }

    setPending(null);

    // A session here means confirmations are off on the project and there is no
    // code to ask for — the navigator has already moved on.
    if (!data.needsEmailConfirmation) return;

    setStep('verify');
    setNotice(null);
    setResendIn(RESEND_COOLDOWN);
  }

  async function verify() {
    if (!canVerify) return;

    setPending('verify');
    setError(null);
    setNotice(null);

    const { error: failure } = await verifyEmailOtp(email, code);

    if (!isMounted()) return;

    if (failure) {
      setError(errorText(i18n, failure));
      setCode('');
      setPending(null);
      return;
    }

    // Deliberately no navigation and no state reset: the new session reaches
    // `AuthProvider` through `onAuthStateChange`, which unmounts this screen.
    setPending(null);
  }

  async function resend() {
    if (pending !== null || resendIn > 0) return;

    setPending('resend');
    setError(null);
    setNotice(null);

    const { error: failure } = await resendSignUpOtp(email);

    if (!isMounted()) return;

    if (failure) {
      setError(errorText(i18n, failure));
      setPending(null);
      return;
    }

    setCode('');
    setNotice(t('signUp.resentNotice', { email: email.trim() }));
    setResendIn(RESEND_COOLDOWN);
    setPending(null);
  }

  function editEmail() {
    setStep('credentials');
    setCode('');
    setError(null);
    setNotice(null);
  }

  async function submitGoogle() {
    setPending('google');
    setError(null);

    const { error: failure } = await signInWithGoogle();

    if (!isMounted()) return;

    if (failure && failure.code !== 'OAUTH_CANCELLED') setError(errorText(i18n, failure));
    setPending(null);
  }

  if (step === 'verify') {
    return (
      <Screen edges={['top', 'bottom']}>
        {/* Back would leave sign-up entirely; the account already exists and
            only needs confirming, so the way out is to correct the address. */}
        <NavHeader
          title={t('signUp.verifyTitle')}
          showBack={false}
          actionLabel={t('signUp.changeEmail')}
          onActionPress={editEmail}
          actionDisabled={pending !== null}
        />

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.flex}>
            <Text variant="title" style={styles.heading}>
              {t('signUp.verifyHeading')}
            </Text>
            <Text variant="body" color="textSecondary">
              {t('signUp.verifySubtitle', { length: CODE_LENGTH, email: email.trim() })}
            </Text>

            <View style={styles.form}>
              <TextField
                label={t('signUp.codeLabel')}
                value={code}
                // The field only ever holds a code, so non-digits and overflow
                // are dropped on the way in rather than rejected on submit.
                onChangeText={(next) =>
                  setCode(next.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH))
                }
                placeholder="123456"
                keyboardType="number-pad"
                autoComplete="one-time-code"
                returnKeyType="go"
                onSubmitEditing={verify}
                editable={pending === null}
                error={error ?? undefined}
              />
            </View>

            {notice ? (
              <Card style={styles.notice}>
                <Ionicons name="mail-outline" size={20} color={colors.accent} />
                <Text variant="caption" color="textSecondary" style={styles.flex}>
                  {notice}
                </Text>
              </Card>
            ) : null}

            <Button
              label={t('signUp.verify')}
              disabled={!canVerify}
              loading={pending === 'verify'}
              onPress={verify}
              style={styles.submit}
            />

            <Button
              label={
                resendIn > 0
                  ? t('signUp.resendIn', { seconds: resendIn })
                  : t('signUp.resend')
              }
              variant="ghost"
              disabled={pending !== null || resendIn > 0}
              loading={pending === 'resend'}
              onPress={resend}
              style={styles.resend}
            />
          </View>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {/* Reachable by URL on web, where nothing sits underneath it. */}
      <NavHeader title={t('signUp.title')} backFallback="/" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.flex}>
          <Text variant="title" style={styles.heading}>
            {t('signUp.heading')}
          </Text>
          <Text variant="body" color="textSecondary">
            {t('signUp.subtitle')}
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
              placeholder={t('signUp.passwordPlaceholder', { count: MIN_PASSWORD_LENGTH })}
              secureTextEntry
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={pending === null}
              error={
                passwordTooShort
                  ? t('signUp.passwordTooShort', { count: MIN_PASSWORD_LENGTH })
                  : (error ?? undefined)
              }
            />
          </View>

          <Button
            label={t('signUp.submit')}
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
            label={t('signUp.google')}
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
          onPress={() => router.replace('/sign-in')}
          style={styles.footer}>
          <Text variant="caption" color="textSecondary">
            {t('signUp.haveAccount')}
          </Text>
          <Text variant="captionStrong" color="accent">
            {t('signUp.signIn')}
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
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xl },
  submit: { marginTop: Spacing.xl },
  resend: { marginTop: Spacing.md },
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
