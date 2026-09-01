/**
 * FamApp Gold — the paywall.
 *
 * **The purchase is still a mock; the subscription is no longer one.** There is
 * no store, no receipt and no payment SDK — the two prices are constants in
 * this file and nothing is charged. What the CTA now does is call
 * `purchaseService.purchasePlan`, which goes through `set_family_premium()` and
 * writes `families.is_premium` / `families.premium_until`. So the *offer* is
 * fiction and the *state* is a row: a family that subscribes stays subscribed
 * across a reload, on every member's device, and the saved-place ceiling
 * actually moves. When a store exists, the receipt is verified inside that RPC
 * and nothing on this screen changes.
 *
 * That is why the screen has three faces rather than one:
 *
 * | family | hero | body |
 * | --- | --- | --- |
 * | never subscribed | the offer | plans + "Start 7-day free trial" |
 * | Gold, unexpired | "you're on Gold", with the date it runs to | benefits only |
 * | Gold, lapsed | when it ran out | plans + "Renew" |
 *
 * The middle one is the reason the plan picker is conditional: showing prices
 * to somebody who already pays is asking them to buy what they have. What they
 * get instead is the date and the four benefits, which are now a list of what
 * is theirs rather than a list of what is not.
 *
 * **The benefits are still mostly copy, and only one of them is enforced.**
 * Saved places is the ceiling this migration actually split (2 free, 10 on
 * Gold, in a trigger). The member trigger still caps every family at 10
 * whatever they pay, the task trigger counts 20 per family, chat photos are
 * unbuilt and nothing sends a push — so those three describe what Gold *would*
 * unlock. Each line names a finite number; "unlimited" is not available to this
 * screen, because no schema could back it.
 *
 * The one thing that must stay free is knowing where the family is: Home's
 * `LiveStatusPill` and the "at a place" sentence are a fold over rows everyone
 * can already read (`membersAtPlaces`), and Gold sells the *push notification*
 * for arriving and leaving, not the fact itself.
 *
 * Reached from two places, both of which push it: Home's `PremiumBanner` and
 * Profile's "FamApp Gold" row. It is presented as a modal, so the way out is
 * `NavHeader`'s chevron — with a `backFallback`, because on web this route is
 * reachable by URL and would otherwise have nothing under it.
 *
 * Gold is `warning`. It is the amber the palette already carries, so the whole
 * flow adds no colour; `primary` is reserved for what the family does, and the
 * CTA is the one green thing here because buying is the action.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BenefitRow } from '@/components/premium/benefit-row';
import { PlanCard } from '@/components/premium/plan-card';
import { Badge, Button, Card, GradientSurface, NavHeader, Screen, Text } from '@/components/ui';
import { fullDate } from '@/data/format';
import { isPremiumExpired, type PremiumPlan } from '@/data/premium';
import { useFamily } from '@/hooks/useFamily';
import { useHaptics } from '@/hooks/use-haptics';
import { useIsMounted, useSafeBack } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { purchasePlan, restorePurchases } from '@/services/purchaseService';
import { errorText } from '@/services/result';
import { Radius, Spacing } from '@/theme';

/** How long the confirmation stays up before the screen closes itself. */
const CONFIRMATION_MS = 1400;

/** Which of the two writes is in flight; they share the CTA row. */
type Pending = 'none' | 'purchase' | 'restore';

export default function PremiumScreen() {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const haptic = useHaptics();
  const { family, isPremium, refresh } = useFamily();
  // Pushed from Home and from Profile, and reachable by URL on web — so the
  // fallback is the tab bar rather than either of the two screens that push it.
  const goBack = useSafeBack('/(tabs)');
  const isMounted = useIsMounted();

  // Annual by default: it is the plan with the trial, and the one the badge
  // recommends. Making the reader opt *in* to the better deal loses most of them.
  const [plan, setPlan] = useState<PremiumPlan>('annual');
  const [pending, setPending] = useState<Pending>('none');
  /** The sentence that replaces the CTA once a write has landed. */
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The screen dismisses itself on a delay, and the user can beat it there with
  // the chevron or the hardware back — leaving a timer to fire into an
  // unmounted screen.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const hasLapsed = isPremiumExpired(family);

  /**
   * Buys the selected plan.
   *
   * The order matters: write, then `refresh()`, then confirm. `isPremium` comes
   * from the family row, so the context has to have re-read it before this
   * screen closes — otherwise Profile and Home are still showing the offer to
   * somebody who has just taken it. Confirming first would be quicker and would
   * be claiming the write landed before knowing it did.
   *
   * The confirmation is rendered in place of the CTA rather than through
   * `Alert`, which does not exist on web, or a second `Modal`, which cannot be
   * presented while this screen is being dismissed. It replaces the button so
   * the answer lands where the finger already is.
   */
  async function subscribe() {
    if (pending !== 'none' || confirmation) return;

    setPending('purchase');
    setError(null);

    const { error: failure } = await purchasePlan(plan);

    if (!isMounted()) return;

    if (failure) {
      setPending('none');
      setError(errorText(i18n, failure));
      return;
    }

    await refresh();

    if (!isMounted()) return;

    setPending('none');
    haptic('success');
    setConfirmation(t('premium.confirmed'));

    timer.current = setTimeout(() => {
      if (isMounted()) goBack();
    }, CONFIRMATION_MS);
  }

  /**
   * Re-reads the grant the family already holds.
   *
   * It does not close the screen. Restoring is a *check* — the answer is the
   * hero above, which the refresh has just updated — and dismissing on it would
   * hide the very thing that was asked for.
   */
  async function restore() {
    if (pending !== 'none' || confirmation) return;

    setPending('restore');
    setError(null);

    const { error: failure } = await restorePurchases();

    if (!isMounted()) return;

    if (failure) {
      setPending('none');
      setError(errorText(i18n, failure));
      return;
    }

    await refresh();

    if (!isMounted()) return;

    setPending('none');
    haptic('success');
    setError(null);
    setConfirmation(t('premium.restored'));
  }

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <NavHeader title={t('premium.name')} backFallback="/(tabs)" />

      <GradientSurface tone="warning" style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: colors.surface }]}>
          <Ionicons
            name={isPremium ? 'checkmark-circle' : 'sparkles'}
            size={26}
            color={colors.warning}
          />
        </View>

        {/* The badge is the fastest read on the screen: it says which of the
            three faces this is before any sentence has been parsed. */}
        {isPremium ? <Badge label={t('premium.activeBadge')} tone="warning" /> : null}

        <Text variant="title" center>
          {isPremium
            ? t('premium.activeTitle')
            : hasLapsed
              ? t('premium.expiredTitle')
              : t('premium.title')}
        </Text>
        <Text variant="body" color="textSecondary" center>
          {isPremium ? t('premium.activeSubtitle') : t('premium.subtitle')}
        </Text>

        {/*
          The date, and only when there is one to show. `premium_until` is
          nullable — a grant with no end recorded is a real state — so this says
          so rather than printing a placeholder date nothing stores.
        */}
        {family?.premiumUntil ? (
          <Text variant="captionStrong" color="warning" center>
            {isPremium
              ? t('premium.until', { date: fullDate(i18n, family.premiumUntil) })
              : t('premium.expiredOn', { date: fullDate(i18n, family.premiumUntil) })}
          </Text>
        ) : isPremium ? (
          <Text variant="caption" color="textSecondary" center>
            {t('premium.noEndDate')}
          </Text>
        ) : null}
      </GradientSurface>

      <Card style={styles.benefits}>
        <Text variant="heading">
          {isPremium ? t('premium.benefitsActive') : t('premium.benefits')}
        </Text>

        <BenefitRow
          icon="people"
          title={t('premium.benefitMembers')}
          description={t('premium.benefitMembersBody')}
        />
        <BenefitRow
          icon="bookmark"
          title={t('premium.benefitPlaces')}
          description={t('premium.benefitPlacesBody')}
        />
        <BenefitRow
          icon="images"
          title={t('premium.benefitPhotos')}
          description={t('premium.benefitPhotosBody')}
        />
        <BenefitRow
          icon="albums"
          title={t('premium.benefitTasks')}
          description={t('premium.benefitTasksBody')}
        />
        <BenefitRow
          icon="notifications"
          title={t('premium.benefitAlerts')}
          description={t('premium.benefitAlertsBody')}
        />
      </Card>

      {/*
        No prices for a family that already pays. The picker and the CTA are one
        decision, so they appear and disappear together — a "Subscribe" button
        under no plan would have nothing to buy.
      */}
      {isPremium ? null : (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('premium.plans')}
          style={styles.plans}>
          <Text variant="heading">{t('premium.plans')}</Text>

          <PlanCard
            name={t('premium.planAnnual')}
            price={t('premium.planAnnualPrice')}
            per={t('premium.planAnnualPer')}
            badge={t('premium.planAnnualBadge')}
            note={t('premium.planAnnualTrial')}
            selected={plan === 'annual'}
            onSelect={() => setPlan('annual')}
            a11yLabel={t('premium.a11ySelect', { plan: t('premium.planAnnual') })}
          />

          <PlanCard
            name={t('premium.planMonthly')}
            price={t('premium.planMonthlyPrice')}
            per={t('premium.planMonthlyPer')}
            selected={plan === 'monthly'}
            onSelect={() => setPlan('monthly')}
            a11yLabel={t('premium.a11ySelect', { plan: t('premium.planMonthly') })}
          />
        </View>
      )}

      {error ? (
        <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <Text variant="caption" color="danger" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : null}

      {confirmation ? (
        // The live region is the wrapper because `Card` takes no accessibility
        // props. A screen reader has to be told: this replaces the control the
        // user just pressed, and an unannounced swap reads as the button
        // having vanished.
        <View accessibilityLiveRegion="polite" style={styles.confirmationWrap}>
          {/* One object rather than an array: `Card`'s `style` is a `ViewStyle`,
              not a `StyleProp`, so the green edge has to be merged in here. */}
          <Card style={{ ...styles.confirmation, borderColor: colors.primary }}>
            <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            <Text variant="bodyStrong" color="primary" style={styles.flex}>
              {confirmation}
            </Text>
          </Card>
        </View>
      ) : isPremium ? null : (
        <Button
          label={
            hasLapsed
              ? t('premium.ctaRenew')
              : plan === 'annual'
                ? t('premium.ctaTrial')
                : t('premium.ctaMonthly')
          }
          onPress={() => void subscribe()}
          loading={pending === 'purchase'}
          disabled={pending !== 'none'}
          style={styles.cta}
        />
      )}

      {/*
        Restore stays available in every state, including while Gold is active:
        it is the button somebody presses when the app is *not* showing what
        they expect, which is exactly when the screen looks wrong to them.
      */}
      <Button
        label={t('premium.restore')}
        variant="ghost"
        size="md"
        onPress={() => void restore()}
        loading={pending === 'restore'}
        disabled={pending !== 'none' || !!confirmation}
        style={styles.restore}
      />

      <Text variant="caption" color="textTertiary" center style={styles.footnote}>
        {t('premium.footnote')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.xl,
    marginTop: Spacing.md,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  benefits: { gap: Spacing.lg, marginTop: Spacing.xl },
  plans: { gap: Spacing.md, marginTop: Spacing.xl },
  cta: { marginTop: Spacing.xl },
  restore: { marginTop: Spacing.sm },
  confirmationWrap: { marginTop: Spacing.xl },
  confirmation: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Radius.lg,
  },
  flex: { flex: 1 },
  footnote: { marginTop: Spacing.md },
});
