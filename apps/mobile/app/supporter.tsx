import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TouchableOpacity } from '../components/ui/PressableScale';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { Skeleton, SkeletonGroup } from '../components/feedback';
import { PERK_LEAD, SupporterPerks, SupporterTag } from '../components/supporter/SupporterPerks';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAccess } from '../hooks/useAccess';
import { Analytics } from '../lib/analytics';
import { a11yState } from '../lib/a11yState';
import { logError } from '../lib/errorLogger';
import { routeParam } from '../lib/routeParams';
import { MIN_TOUCH_TARGET } from '../lib/touchTargets';
import { TYPE, emphasized } from '../lib/typography';
import { MARGIN, RADII, SPACE, type ThemeColors } from '../lib/theme';
import {
  isSupporterPerk,
  supporter,
  supporterLegalLinks,
  supporterStatusLabel,
  type ActiveSupporter,
  type PausedSupporter,
  type SupporterPlan,
  type SupporterPlanId,
  type SupporterPlans,
  type SupporterSource,
} from '../lib/supporter';

type ReadyPlans = Extract<SupporterPlans, { status: 'ready' }>;

type Screen =
  | { phase: 'loading' }
  | { phase: 'unavailable'; why: 'soon' | 'applicant' }
  | { phase: 'error' }
  | { phase: 'offer'; plans: ReadyPlans }
  | { phase: 'active'; state: ActiveSupporter }
  | { phase: 'paused'; state: PausedSupporter }
  | { phase: 'success'; state: ActiveSupporter }
  | { phase: 'processing'; pending: boolean };

type Message = { tone: 'error' | 'info'; text: string };

const NOTHING_TO_RESTORE = 'No Roxy Supporter subscription found for this store account.';
const NOT_YET = 'Not through yet. It can take a few minutes — check again shortly, or ask us for help.';
const CHECK_FAILED = 'We couldn’t check just now. Check your connection and try again.';

/**
 * Spec › Commercial gate › Support: "Help with Supporter" goes to the app's
 * existing support channel. That is Settings › Support › Feedback & ideas
 * (`/you/feedback`, read by the team, with a status she can follow), which
 * takes a category and a prefilled message — the same door Roxy chat's
 * "report a reply" uses. `/support` is donations and feature voting, with no
 * way to ask for help.
 */
const SUPPORTER_HELP = {
  pathname: '/(tabs)/you/feedback',
  params: { category: 'other', prefillMessage: 'About Roxy Supporter: ' },
} as const;

/** "Cancel any time …": where she actually cancels on this platform. */
function cancelWhere(os: string): string {
  if (os === 'web') return 'Cancel any time on this page.';
  if (os === 'android') return 'Cancel any time in Google Play.';
  return 'Cancel any time in your store settings.';
}

function priceLine(plan: SupporterPlan): string {
  if (plan.id === 'monthly') return `${plan.priceString} a month`;
  return plan.pricePerMonthString
    ? `${plan.priceString} a year · ${plan.pricePerMonthString} a month`
    : `${plan.priceString} a year`;
}

/**
 * Roxy Supporter's paywall (spec 2026-10-26 §1 › Paywall, Entry points, Kill
 * switch). `?reason=<perk>` (chapters | incognito | banner | merchant |
 * sticker) leads with the perk that brought her; `?source=you` is the You row.
 *
 * Every state is deliberate: plans loading (a skeleton at the final layout,
 * never a spinner), "Coming soon" (kill switch off, no key, no offering), an
 * applicant ("opens once you're in"), a load error with Retry, the offer, a
 * purchase in flight (the primary button busy), a cancel (quiet), a failure (a
 * human sentence and the same button again), "Payment received" when the
 * webhook is late, and success only when the server row says so.
 *
 * Honest by construction (direction › Bans › Premium dark patterns): prices
 * are the store's own strings; the yearly saving is computed from them, never
 * typed; monthly is the default choice; no countdown, no scarcity, no
 * confirmshaming; it never opens by itself. Restore is native-only (Web
 * Billing has none) and Manage subscription is one tap from the active state.
 */
export default function SupporterScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const s = useMemo(() => styles(colors), [colors]);
  const params = useLocalSearchParams<{ reason?: string; source?: string }>();
  const reason = routeParam(params.reason);
  const lead = isSupporterPerk(reason) ? reason : null;
  // Only known values reach analytics: a link can carry anything in a query.
  const source: SupporterSource = lead ?? (routeParam(params.source) === 'you' ? 'you' : 'direct');
  const { loading: accessLoading, kind } = useAccess();
  const legal = useMemo(() => supporterLegalLinks(), []);
  const canRestore = supporter.canRestore();

  const [screen, setScreen] = useState<Screen>({ phase: 'loading' });
  const [selected, setSelected] = useState<SupporterPlanId>('monthly');
  const [busy, setBusy] = useState<'buy' | 'restore' | 'check' | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [manageUrl, setManageUrl] = useState<string | null>(null);

  // Unmount, not per-run: a purchase that resolves after she left must not
  // set state on a dead screen (the lib has already told the You row).
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    Analytics.supporterPaywallViewed(source);
  }, [source]);

  const load = useCallback(async () => {
    setScreen({ phase: 'loading' });
    setMessage(null);
    const state = await supporter.getState();
    if (!mounted.current) return;
    if (state.status === 'unavailable') { setScreen({ phase: 'unavailable', why: 'soon' }); return; }
    if (state.status === 'error') { setScreen({ phase: 'error' }); return; }
    if (state.status === 'active') { setScreen({ phase: 'active', state }); return; }
    // Kill switch off, but she pays: say so, never "Coming soon".
    if (state.status === 'paused') { setScreen({ phase: 'paused', state }); return; }
    const plans = await supporter.loadPlans();
    if (!mounted.current) return;
    if (plans.status === 'unavailable') { setScreen({ phase: 'unavailable', why: 'soon' }); return; }
    if (plans.status === 'error') { setScreen({ phase: 'error' }); return; }
    // The store has her money; the server row is on its way. Never sell twice.
    if (plans.alreadyPaid) { setScreen({ phase: 'processing', pending: false }); return; }
    setSelected(plans.monthly ? 'monthly' : 'yearly');
    setScreen({ phase: 'offer', plans });
  }, []);

  useEffect(() => {
    if (accessLoading) return;
    if (kind === 'pending') { setScreen({ phase: 'unavailable', why: 'applicant' }); return; }
    void load();
  }, [accessLoading, kind, load]);

  const subscribedState = screen.phase === 'active' || screen.phase === 'paused' ? screen.state : null;
  useEffect(() => {
    if (!subscribedState) return undefined;
    let current = true;
    void supporter.manageUrl(subscribedState)
      .then((url) => { if (current) setManageUrl(url); })
      .catch((e: unknown) => logError(e, 'supporter.manageUrl'));
    return () => { current = false; };
  }, [subscribedState]);

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/you' as never);
  };

  const open = (url: string) => {
    void Linking.openURL(url).catch((e: unknown) => {
      logError(e, 'supporter.openUrl');
      setMessage({ tone: 'error', text: 'That page didn’t open. Try again.' });
    });
  };

  const plan: SupporterPlan | null = screen.phase === 'offer'
    ? (selected === 'yearly' ? screen.plans.yearly : screen.plans.monthly)
    : null;

  const onBuy = async () => {
    if (!plan || busy) return;
    setBusy('buy');
    setMessage(null);
    const out = await supporter.buy(plan);
    if (!mounted.current) return;
    setBusy(null);
    switch (out.kind) {
      case 'success': setScreen({ phase: 'success', state: out.state }); break;
      case 'processing': setScreen({ phase: 'processing', pending: false }); break;
      case 'pending': setScreen({ phase: 'processing', pending: true }); break;
      case 'unavailable': setScreen({ phase: 'unavailable', why: 'soon' }); break;
      case 'error': setMessage({ tone: 'error', text: out.message }); break;
      case 'cancelled': break; // She closed the store sheet: nothing to say.
    }
  };

  const onRestore = async () => {
    if (busy) return;
    setBusy('restore');
    setMessage(null);
    const out = await supporter.restore();
    if (!mounted.current) return;
    setBusy(null);
    switch (out.kind) {
      case 'success': setScreen({ phase: 'success', state: out.state }); break;
      case 'processing': setScreen({ phase: 'processing', pending: false }); break;
      case 'nothing': setMessage({ tone: 'info', text: NOTHING_TO_RESTORE }); break;
      case 'error': setMessage({ tone: 'error', text: out.message }); break;
      case 'unavailable': setScreen({ phase: 'unavailable', why: 'soon' }); break;
      case 'unsupported': break;
    }
  };

  /**
   * Paid but not confirmed: ask the server again (the same read the paywall
   * opens with). recheck also tells the You row when she is confirmed.
   */
  const onCheck = async () => {
    if (busy) return;
    setBusy('check');
    setMessage(null);
    const state = await supporter.recheck();
    if (!mounted.current) return;
    setBusy(null);
    switch (state.status) {
      case 'active': setScreen({ phase: 'success', state }); break;
      case 'paused': setScreen({ phase: 'paused', state }); break;
      case 'free': setMessage({ tone: 'info', text: NOT_YET }); break;
      case 'error': setMessage({ tone: 'error', text: CHECK_FAILED }); break;
      case 'unavailable': setScreen({ phase: 'unavailable', why: 'soon' }); break;
    }
  };

  const helpLink = (
    <TouchableOpacity
      testID="supporter-help"
      onPress={() => router.push(SUPPORTER_HELP as never)}
      accessibilityRole="link"
      accessibilityLabel="Help with Supporter"
      style={s.link}
    >
      <Text style={s.linkLabel}>Help with Supporter</Text>
    </TouchableOpacity>
  );

  const restoreLink = canRestore ? (
    <TouchableOpacity
      testID="supporter-restore"
      onPress={() => { void onRestore(); }}
      disabled={busy !== null}
      accessibilityRole="button"
      accessibilityLabel="Restore purchases"
      {...a11yState({ busy: busy === 'restore', disabled: busy !== null })}
      style={s.link}
    >
      <Text style={s.linkLabel}>{busy === 'restore' ? 'Checking…' : 'Restore purchases'}</Text>
    </TouchableOpacity>
  ) : null;

  const manageButton = manageUrl ? (
    <TouchableOpacity
      testID="supporter-manage"
      onPress={() => open(manageUrl)}
      accessibilityRole="link"
      accessibilityLabel="Manage subscription"
      style={s.quietButton}
    >
      <Text style={s.quietLabel}>Manage subscription</Text>
    </TouchableOpacity>
  ) : null;

  const messageView = message ? (
    <Text
      testID="supporter-message"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[s.message, { color: message.tone === 'error' ? colors.dangerInk : colors.ink2 }]}
    >
      {message.text}
    </Text>
  ) : null;

  const renderBody = () => {
    switch (screen.phase) {
      case 'loading':
        return (
          <SkeletonGroup testID="supporter-loading" accessibilityLabel="Loading Roxy Supporter" style={s.content}>
            <Skeleton width={96} height={24} radius={RADII.pill} />
            <Skeleton width="80%" height={32} />
            <Skeleton width="60%" height={16} />
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} width="100%" height={40} />)}
            <Skeleton width="100%" height={72} radius={RADII.md} />
            <Skeleton width="100%" height={72} radius={RADII.md} />
            <Skeleton width="100%" height={52} radius={RADII.pill} />
          </SkeletonGroup>
        );

      case 'unavailable':
        return (
          <View style={s.content} testID="supporter-unavailable">
            <SupporterTag />
            {screen.why === 'applicant' ? (
              <>
                <Text style={s.headline} accessibilityRole="header">Roxy Supporter opens once you’re in</Text>
                <Text style={s.body}>It’s for approved members. You’ll find it on You once a reviewer admits you.</Text>
              </>
            ) : (
              <>
                <Text style={s.headline} accessibilityRole="header">Roxy Supporter is coming soon</Text>
                <Text style={s.body}>We’re putting the finishing touches on it. Here’s what it will include.</Text>
                <SupporterPerks lead={lead} />
              </>
            )}
          </View>
        );

      case 'error':
        return (
          <View style={s.content} testID="supporter-error">
            <Text style={s.headline} accessibilityRole="header">Couldn’t load Roxy Supporter</Text>
            <Text style={s.body}>Check your connection and try again.</Text>
            <PrimaryButton label="Try again" onPress={() => { void load(); }} testID="supporter-retry" />
          </View>
        );

      case 'processing':
        return (
          <View style={s.content} testID="supporter-processing">
            <SupporterTag />
            {screen.pending ? (
              <>
                <Text style={s.headline} accessibilityRole="header">Payment pending</Text>
                <Text style={s.body}>The store is still processing your payment. Your perks will appear once it goes through.</Text>
              </>
            ) : (
              <>
                <Text style={s.headline} accessibilityRole="header">Thank you</Text>
                <Text style={s.body}>Payment received — your perks will appear in a minute.</Text>
              </>
            )}
            {messageView}
            {/* A way out when the server is slow: ask again, restore, or ask us. */}
            <PrimaryButton
              label="Check again"
              onPress={() => { void onCheck(); }}
              busy={busy === 'check'}
              disabled={busy === 'restore'}
              testID="supporter-check"
            />
            <TouchableOpacity
              testID="supporter-done"
              onPress={leave}
              accessibilityRole="button"
              accessibilityLabel="Done"
              style={s.quietButton}
            >
              <Text style={s.quietLabel}>Done</Text>
            </TouchableOpacity>
            <View style={s.links}>
              {screen.pending ? null : restoreLink}
              {helpLink}
            </View>
          </View>
        );

      case 'paused':
        return (
          <View style={s.content} testID="supporter-paused">
            <SupporterTag />
            <Text style={s.headline} accessibilityRole="header">Your Supporter subscription is active</Text>
            <Text style={s.body}>
              Your perks are paused for a moment while we fix something on our side. Your subscription itself hasn’t changed.
            </Text>
            {screen.state.inGrace ? (
              <Text style={[s.body, { color: colors.warningInk }]}>
                There’s a problem with your payment. Update it in Manage subscription to keep your subscription.
              </Text>
            ) : null}
            {manageButton}
            {messageView}
            <View style={s.links}>{helpLink}</View>
          </View>
        );

      case 'success':
        return (
          <View style={s.content} testID="supporter-success">
            <SupporterTag pop />
            <Text style={s.headline} accessibilityRole="header">You’re a Roxy Supporter</Text>
            <Text style={s.body}>Thank you for backing Roxy. Here’s what’s yours now.</Text>
            <SupporterPerks lead={lead} />
            <PrimaryButton label="Done" onPress={leave} testID="supporter-done" />
          </View>
        );

      case 'active': {
        const status = supporterStatusLabel(screen.state);
        return (
          <View style={s.content} testID="supporter-active">
            <SupporterTag />
            <Text style={s.headline} accessibilityRole="header">You’re a Roxy Supporter</Text>
            {status ? <Text style={s.status}>{status}</Text> : null}
            {screen.state.inGrace ? (
              <Text style={[s.body, { color: colors.warningInk }]}>
                There’s a problem with your payment. Update it in Manage subscription to keep your perks.
              </Text>
            ) : null}
            <SupporterPerks lead={lead} />
            {manageButton}
            {messageView}
            <View style={s.links}>{helpLink}</View>
          </View>
        );
      }

      case 'offer': {
        const { monthly, yearly, yearlySavingPercent } = screen.plans;
        const options = [monthly, yearly].filter((p): p is SupporterPlan => p !== null);
        return (
          <View style={s.content}>
            <SupporterTag />
            <Text style={s.headline} accessibilityRole="header">
              {lead ? PERK_LEAD[lead] : 'Back Roxy, get a little extra'}
            </Text>
            <Text style={s.body}>Roxy stays free. Supporters keep it going, and get a few extras.</Text>
            <SupporterPerks lead={lead} />
            <View style={s.freeBox}>
              <Text style={s.body}>
                Free for everyone, always: Ghost mode, communities near you, online communities, block and report.
              </Text>
            </View>

            <View style={s.plans} accessibilityRole="radiogroup" accessibilityLabel="Choose a plan">
              {options.map((p) => {
                const on = p.id === selected;
                const saving = p.id === 'yearly' ? yearlySavingPercent : null;
                const title = p.id === 'monthly' ? 'Monthly' : 'Yearly';
                const line = priceLine(p);
                return (
                  <TouchableOpacity
                    key={p.id}
                    testID={`supporter-plan-${p.id}`}
                    onPress={() => setSelected(p.id)}
                    disabled={busy !== null}
                    accessibilityRole="radio"
                    accessibilityLabel={saving ? `${title}, ${line}, save ${saving}%` : `${title}, ${line}`}
                    {...a11yState({ checked: on, selected: on })}
                    style={[s.plan, { backgroundColor: on ? colors.pinkContainer : colors.surface }]}
                  >
                    <Ionicons
                      name={on ? 'radio-button-on' : 'radio-button-off'}
                      size={24}
                      color={on ? colors.onPinkContainer : colors.control}
                    />
                    <View style={s.planCopy}>
                      <Text style={[s.planTitle, { color: on ? colors.onPinkContainer : colors.ink }]}>{title}</Text>
                      <Text style={[s.planPrice, { color: on ? colors.onPinkContainer : colors.ink2 }]}>{line}</Text>
                    </View>
                    {saving ? (
                      <View style={[s.save, { backgroundColor: on ? colors.surface : colors.raised }]}>
                        <Text style={s.saveLabel}>{`Save ${saving}%`}</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            {messageView}
            <PrimaryButton
              label="Become a Supporter"
              onPress={() => { void onBuy(); }}
              busy={busy === 'buy'}
              disabled={busy === 'restore' || !plan}
              testID="supporter-buy"
            />
            {plan ? (
              <Text style={s.disclosure}>
                {`Renews every ${plan.id === 'monthly' ? 'month' : 'year'} at ${plan.priceString} until you cancel. ${cancelWhere(Platform.OS)}`}
              </Text>
            ) : null}

            <View style={s.links}>
              {restoreLink}
              {helpLink}
              {legal.terms ? (
                <TouchableOpacity
                  testID="supporter-terms"
                  onPress={() => open(legal.terms as string)}
                  accessibilityRole="link"
                  accessibilityLabel="Terms"
                  style={s.link}
                >
                  <Text style={s.linkLabel}>Terms</Text>
                </TouchableOpacity>
              ) : null}
              {legal.privacy ? (
                <TouchableOpacity
                  testID="supporter-privacy"
                  onPress={() => open(legal.privacy as string)}
                  accessibilityRole="link"
                  accessibilityLabel="Privacy"
                  style={s.link}
                >
                  <Text style={s.linkLabel}>Privacy</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      }
    }
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={leave}
          style={s.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          aria-label="Back"
          testID="supporter-back"
        >
          <Ionicons name="arrow-back-outline" size={24} color={colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1} accessibilityRole="header">Roxy Supporter</Text>
      </View>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" testID="supporter-paywall">
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[1],
    paddingHorizontal: SPACE[1], minHeight: 56,
  },
  headerBtn: {
    minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { ...TYPE.title, color: colors.ink, flex: 1 },
  scroll: { paddingBottom: SPACE[7] },
  content: { paddingHorizontal: MARGIN, paddingTop: SPACE[2], gap: SPACE[4] },
  headline: { ...TYPE.headline, color: colors.ink },
  body: { ...TYPE.body, color: colors.ink2 },
  status: { ...emphasized('label'), color: colors.ink },
  freeBox: { backgroundColor: colors.surface, borderRadius: RADII.md, padding: MARGIN },
  plans: { gap: SPACE[2] },
  plan: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    minHeight: 72, paddingHorizontal: MARGIN, borderRadius: RADII.md,
  },
  planCopy: { flex: 1 },
  planTitle: { ...TYPE.label },
  planPrice: { ...TYPE.body },
  save: { borderRadius: RADII.pill, paddingHorizontal: SPACE[2], paddingVertical: SPACE[0] },
  saveLabel: { ...emphasized('meta'), color: colors.ink },
  message: { ...TYPE.body },
  disclosure: { ...TYPE.meta, color: colors.ink2, textAlign: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: SPACE[2] },
  link: { minHeight: MIN_TOUCH_TARGET, paddingHorizontal: SPACE[2], justifyContent: 'center' },
  linkLabel: { ...TYPE.label, color: colors.pinkInk },
  quietButton: {
    minHeight: 52, borderRadius: RADII.pill, backgroundColor: colors.raised,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE[5],
  },
  quietLabel: { ...TYPE.button, color: colors.ink },
});
