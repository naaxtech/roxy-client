import { Platform } from 'react-native';
import { format } from 'date-fns';
import Purchases, { PURCHASES_ERROR_CODE } from 'react-native-purchases';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { supabase } from './supabase';
import { Analytics } from './analytics';
import { logBreadcrumb, logError } from './errorLogger';
import { useAuthStore } from '../store/authStore';

/**
 * Roxy Supporter, the client half of slice S1 (spec
 * docs/superpowers/specs/2026-10-26-roxy-supporter-design.md §1 › Client,
 * Paywall, Kill switch, Analytics). The server half is migration 140 and the
 * `revenuecat-webhook` edge function.
 *
 * One file owns RevenueCat for the whole app, on both platforms:
 * `react-native-purchases` drives Google Play Billing on Android and switches
 * itself to its bundled RevenueCat Web Billing when `Platform.OS === 'web'`,
 * so roxy.expo.app and the APK run the same code.
 * src: https://github.com/RevenueCat/react-native-purchases/blob/10.15.1/src/utils/environment.ts · react-native-purchases 10.15.1 · 2026-10-27
 *
 * The rules:
 *   1. **Fail closed.** No public SDK key for this platform (or a secret key by
 *      mistake), or the server kill switch `supporter_enabled()` off → status
 *      'unavailable', and the SDK is never called. One exception for the
 *      switch: a member who still holds a live subscription row is 'paused'
 *      (told she is subscribed, perks off), and on web her Manage link is
 *      read from the SDK — a paying member must always be able to cancel.
 *   2. **The server decides what is unlocked.** `getState()` reads her own
 *      `supporter_entitlements` row (RLS: owner SELECT only) and asks
 *      `is_supporter(uid)` — the same function every perk gate calls — so a
 *      sandbox purchase outside a test window is not shown as active. The
 *      SDK's CustomerInfo only shapes the paywall (an already-paid notice, the
 *      renew/ends wording, the management link).
 *   3. **Configured once**, with her Supabase user id as `appUserID` (the
 *      webhook maps `app_user_id` back to her). An account switch is a
 *      `logIn`, a sign-out a `logOut`.
 *   4. **Never claim perks early.** After a store purchase the server row is
 *      polled on a bounded backoff (`POLL_DELAYS_MS`); if the webhook is late
 *      the outcome is 'processing' ("Payment received …"), not 'success'.
 */

/** The RevenueCat entitlement identifier both products attach to (S1 plan › Owner steps). */
export const SUPPORTER_ENTITLEMENT = 'supporter';

/**
 * Waits between server reads after a purchase or restore: one read at once,
 * then after 1, 2, 3, 5 and 8 s — six reads, 19 s at most. RevenueCat retries
 * a failed webhook over minutes, so past this she is told the payment arrived
 * and the You row catches up on its own (it re-reads on every change event).
 * src: https://www.revenuecat.com/docs/integrations/webhooks · 2026-10-27 (retries ≈ 2.5 → 40 min)
 */
export const POLL_DELAYS_MS = [1000, 2000, 3000, 5000, 8000] as const;

/** The perks, in the spec's order. The paywall's `?reason=` is one of these. */
export const SUPPORTER_PERKS = ['chapters', 'incognito', 'banner', 'merchant', 'sticker'] as const;
export type SupporterPerk = (typeof SUPPORTER_PERKS)[number];

export function isSupporterPerk(value: unknown): value is SupporterPerk {
  return typeof value === 'string' && (SUPPORTER_PERKS as readonly string[]).includes(value);
}

/** Where a paywall view came from: a perk gate, the You row, or a bare link. */
export type SupporterSource = SupporterPerk | 'you' | 'direct';

export type SupporterPlanId = 'monthly' | 'yearly';

export type SupporterPlan = {
  id: SupporterPlanId;
  /** The store's localized price, e.g. "$4.99" or "₱279.00". Never built here. */
  priceString: string;
  price: number;
  currencyCode: string;
  /** The store's own per-month figure (yearly only is useful). */
  pricePerMonthString: string | null;
  pkg: PurchasesPackage;
};

export type SupporterPlans =
  | { status: 'unavailable' }
  | { status: 'error' }
  | {
      status: 'ready';
      monthly: SupporterPlan | null;
      yearly: SupporterPlan | null;
      yearlySavingPercent: number | null;
      /** The store already has her payment but the server row has not landed. */
      alreadyPaid: boolean;
    };

export type ActiveSupporter = {
  status: 'active';
  /** Billing issue: still a Supporter until the store's grace period ends. */
  inGrace: boolean;
  /** Null for a lifetime entitlement (`period_ends_at = 'infinity'`). */
  periodEndsAt: Date | null;
  /** From the SDK, display only. Null when it cannot say. */
  willRenew: boolean | null;
  store: string | null;
  productId: string | null;
};

/**
 * The kill switch is off, but she holds a live subscription row: she is
 * still paying, so she is told so and can manage it. Perks stay off
 * (is_supporter is false while the switch is off; that is the switch's job).
 */
export type PausedSupporter = {
  status: 'paused';
  inGrace: boolean;
  periodEndsAt: Date | null;
  store: string | null;
  productId: string | null;
};

export type SupporterState =
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'free' }
  | ActiveSupporter
  | PausedSupporter;

export type PurchaseOutcome =
  | { kind: 'success'; state: ActiveSupporter }
  | { kind: 'processing' }
  | { kind: 'pending' }
  | { kind: 'cancelled' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'unavailable' };

export type RestoreOutcome =
  | { kind: 'success'; state: ActiveSupporter }
  | { kind: 'processing' }
  | { kind: 'nothing' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'unavailable' }
  | { kind: 'unsupported' };

export type SupporterKeys = { android?: string; web?: string };

export type SupporterDeps = {
  keys: SupporterKeys;
  platformOS: string;
  currentUserId: () => string | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type SupporterClient = {
  syncIdentity: (userId: string | null) => Promise<void>;
  getState: () => Promise<SupporterState>;
  /** getState for "Check again": also tells subscribers (the You row) once she is confirmed. */
  recheck: () => Promise<SupporterState>;
  loadPlans: () => Promise<SupporterPlans>;
  buy: (plan: SupporterPlan) => Promise<PurchaseOutcome>;
  restore: () => Promise<RestoreOutcome>;
  canRestore: () => boolean;
  manageUrl: (state: SupporterState) => Promise<string | null>;
  subscribe: (listener: () => void) => () => void;
};

/** The Play app id (app.json › android.package), for the subscription deep link. */
const ANDROID_PACKAGE = 'com.roxy.app';

/**
 * Google Play's subscription centre; with `sku` + `package` it opens her
 * subscription's own management page.
 * src: https://developer.android.com/google/play/billing/subscriptions#deep-link · 2026-10-27
 */
const PLAY_SUBSCRIPTIONS = 'https://play.google.com/store/account/subscriptions';

/**
 * The platform's public SDK key, or null. Fails closed: missing, blank, or a
 * secret key (`sk_…`, which must never ship in an app) all mean "no key".
 * Android keys are `goog_…`, Web Billing keys `rcb_…`; iOS has no app yet.
 */
export function revenueCatKey(platformOS: string, keys: SupporterKeys): string | null {
  const raw = platformOS === 'android' ? keys.android : platformOS === 'web' ? keys.web : undefined;
  const key = (raw ?? '').trim();
  if (!key) return null;
  if (key.startsWith('sk_')) return null;
  return key;
}

/**
 * The yearly plan's saving against twelve months, from the store's prices,
 * rounded DOWN so the tag never over-claims. Null when it cannot be said
 * honestly (no monthly, different currencies, or no saving).
 */
export function yearlySavingPercent(
  monthly: Pick<SupporterPlan, 'price' | 'currencyCode'> | null,
  yearly: Pick<SupporterPlan, 'price' | 'currencyCode'> | null,
): number | null {
  if (!monthly || !yearly) return null;
  if (monthly.currencyCode !== yearly.currencyCode) return null;
  if (!(monthly.price > 0) || !(yearly.price > 0)) return null;
  const pct = Math.floor((1 - yearly.price / (monthly.price * 12)) * 100);
  return pct >= 1 ? pct : null;
}

/** The You row's status, e.g. "Active · renews 27 Nov 2026"; null when not a Supporter. */
export function supporterStatusLabel(state: SupporterState): string | null {
  if (state.status === 'paused') return 'Active · perks paused';
  if (state.status !== 'active') return null;
  if (state.inGrace) return 'Active · check payment';
  if (!state.periodEndsAt) return 'Active';
  const date = format(state.periodEndsAt, 'd MMM yyyy');
  return state.willRenew === false ? `Active · ends ${date}` : `Active · renews ${date}`;
}

// Read once: babel-preset-expo inlines EXPO_PUBLIC_* at build time (the same
// pattern as lib/captcha.ts). Public URLs, not secrets.
const BUILD_LEGAL = {
  terms: process.env.EXPO_PUBLIC_TERMS_URL,
  privacy: process.env.EXPO_PUBLIC_PRIVACY_URL,
};

function httpsOrNull(raw: string | null | undefined): string | null {
  const url = (raw ?? '').trim();
  return /^https:\/\/\S+$/.test(url) ? url : null;
}

/** Terms and Privacy for the paywall. Unset (or not https) → null → not drawn. */
export function supporterLegalLinks(
  raw: { terms?: string; privacy?: string } = BUILD_LEGAL,
): { terms: string | null; privacy: string | null } {
  return { terms: httpsOrNull(raw.terms), privacy: httpsOrNull(raw.privacy) };
}

/** RevenueCat's error code ("2") → its stable name ("STORE_PROBLEM_ERROR"); no PII either way. */
function codeName(code: string | undefined): string {
  const codes = PURCHASES_ERROR_CODE as unknown as Record<string, string>;
  const name = Object.keys(codes).find((k) => codes[k] === code);
  return name ?? 'UNKNOWN_ERROR';
}

/**
 * The parts of a rejection the SDK documents: `code` (PURCHASES_ERROR_CODE)
 * and `userCancelled` (deprecated in favour of the cancelled code, so both
 * are honoured).
 * src: https://unpkg.com/@revenuecat/purchases-typescript-internal@19.14.1/dist/errors.d.ts · react-native-purchases 10.15.1 · 2026-10-27
 */
function readError(e: unknown): { code: string | undefined; cancelled: boolean } {
  const err = (e ?? {}) as { code?: unknown; userCancelled?: unknown };
  const code = typeof err.code === 'string' ? err.code : undefined;
  return {
    code,
    cancelled: code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR || err.userCancelled === true,
  };
}

/** A sentence she can act on. Never the SDK's own text (it can carry ids). */
function purchaseErrorCopy(code: string | undefined, platformOS: string): string {
  const store = platformOS === 'web' ? 'The payment page' : 'Google Play';
  switch (code) {
    case PURCHASES_ERROR_CODE.NETWORK_ERROR:
    case PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR:
      return 'You’re offline. Check your connection and try again.';
    case PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR:
      return `${store} had a problem. Try again in a moment.`;
    case PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR:
      return 'Purchases aren’t allowed on this account or device.';
    case PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
      return 'This plan isn’t available right now. Try the other one, or come back later.';
    case PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR:
      return platformOS === 'web'
        ? 'You already have Roxy Supporter on this account.'
        : 'You already have Roxy Supporter on this store account. Try Restore purchases.';
    case PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR:
    case PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR:
      return 'This subscription belongs to another Roxy account.';
    default:
      return 'The payment didn’t go through. Try again.';
  }
}

function restoreErrorCopy(code: string | undefined): string {
  if (code === PURCHASES_ERROR_CODE.NETWORK_ERROR || code === PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR) {
    return 'You’re offline. Check your connection and try again.';
  }
  return 'We couldn’t check your purchases. Try again in a moment.';
}

/** True when CustomerInfo carries the Supporter entitlement. Paywall display only. */
function storeHasSupporter(info: CustomerInfo | null | undefined): boolean {
  return Boolean(info?.entitlements?.active?.[SUPPORTER_ENTITLEMENT]);
}

/** `period_ends_at` as PostgREST sends it: an ISO string, or 'infinity' for a lifetime row. */
function periodEnd(raw: string | null): { live: (now: number) => boolean; date: Date | null } {
  if (raw === 'infinity') return { live: () => true, date: null };
  const t = raw ? Date.parse(raw) : NaN;
  if (Number.isNaN(t)) return { live: () => false, date: null };
  return { live: (now) => t > now, date: new Date(t) };
}

type EntitlementRow = {
  status: string;
  period_ends_at: string | null;
  store: string | null;
  product_id: string | null;
  environment: string;
};

type ServerRead = 'error' | { status: 'free' } | Omit<ActiveSupporter, 'willRenew'>;

const BUILD_KEYS: SupporterKeys = {
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
  web: process.env.EXPO_PUBLIC_REVENUECAT_WEB_KEY,
};

function signedInId(): string | null {
  try {
    return useAuthStore.getState().user?.id ?? null;
  } catch {
    return null;
  }
}

const DEFAULT_DEPS: SupporterDeps = {
  keys: BUILD_KEYS,
  platformOS: Platform.OS,
  currentUserId: signedInId,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * One RevenueCat client. The app uses the `supporter` instance below; tests
 * build their own with fixed keys, platform, clock and sleep.
 */
export function createSupporter(overrides: Partial<SupporterDeps> = {}): SupporterClient {
  const deps: SupporterDeps = { ...DEFAULT_DEPS, ...overrides };
  const apiKey = revenueCatKey(deps.platformOS, deps.keys);

  let configured = false;
  /** Set when configure threw (an installed build without the native module): unavailable. */
  let broken = false;
  /** Who the SDK is identified as; null = nobody (never configured, or logged out). */
  let sdkUser: string | null = null;
  const listeners = new Set<() => void>();

  // SDK identity changes run one at a time, so two auth events (or a sync and
  // a paywall load) can never both configure.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  function sdkFailure(op: string, e: unknown): void {
    // A sanitized error: RevenueCat messages can carry the app user id, which
    // is her Supabase id and must never reach a log unhashed (CLAUDE.md §10).
    logError(new Error(`revenuecat ${op} failed: ${codeName(readError(e).code)}`), `supporter.${op}`);
  }

  /** RevenueCat's own log lines name the app user id: keep them out of the console (and PostHog's replay log). */
  function quietLogs(level: string): void {
    // LOG_LEVEL values are the strings VERBOSE | DEBUG | INFO | WARN | ERROR.
    // src: https://unpkg.com/@revenuecat/purchases-typescript-internal@19.14.1/dist/enums.d.ts · react-native-purchases 10.15.1 · 2026-10-27
    if (String(level) === 'ERROR') logBreadcrumb('supporter_sdk_error');
  }

  /**
   * Identify the SDK as `uid`: configure on first use, logIn on a switch.
   * `Purchases.configure({ apiKey, appUserID })` is synchronous and throws when
   * the native module is missing; `logIn(appUserID)` resolves a LogInResult.
   * src: https://github.com/RevenueCat/react-native-purchases/blob/10.15.1/src/purchases.ts#L586 · react-native-purchases 10.15.1 · 2026-10-27
   */
  async function identify(uid: string): Promise<boolean> {
    if (!apiKey || broken) return false;
    if (!configured) {
      try {
        // Before configure: configure installs a console handler only when none is set.
        Purchases.setLogHandler(quietLogs);
        Purchases.configure({ apiKey, appUserID: uid });
        configured = true;
        sdkUser = uid;
        return true;
      } catch (e) {
        broken = true;
        sdkFailure('configure', e);
        return false;
      }
    }
    if (sdkUser !== uid) {
      try {
        await Purchases.logIn(uid);
        sdkUser = uid;
      } catch (e) {
        sdkFailure('logIn', e);
        return false;
      }
    }
    return true;
  }

  /** The SDK, identified as whoever is signed in now. False = do not call it. */
  function ensureSdk(): Promise<boolean> {
    const uid = deps.currentUserId();
    if (!apiKey || !uid) return Promise.resolve(false);
    return serial(() => identify(uid));
  }

  /** `supporter_enabled()`: true / false, or null when it could not be read. */
  async function readEnabled(): Promise<boolean | null> {
    try {
      const { data, error } = await supabase.rpc('supporter_enabled');
      if (error) {
        logError(error, 'supporter.enabled');
        return null;
      }
      return data === true;
    } catch (e) {
      logError(e, 'supporter.enabled');
      return null;
    }
  }

  /** Her own supporter_entitlements row (RLS: owner SELECT only). */
  function ownRow(uid: string) {
    return supabase
      .from('supporter_entitlements')
      .select('status, period_ends_at, store, product_id, environment')
      .eq('user_id', uid)
      .maybeSingle();
  }

  /** The row's subscription when it is live now (active or grace, inside its period); else null. */
  function liveSubscription(row: EntitlementRow | null): Omit<ActiveSupporter, 'status' | 'willRenew'> | null {
    if (!row || !(row.status === 'active' || row.status === 'grace')) return null;
    const end = periodEnd(row.period_ends_at);
    if (!end.live(deps.now())) return null;
    return { inGrace: row.status === 'grace', periodEndsAt: end.date, store: row.store, productId: row.product_id };
  }

  /** Her own row, cross-checked with the gate every perk asks. */
  async function readServer(uid: string): Promise<ServerRead> {
    try {
      const [rowRes, gateRes] = await Promise.all([ownRow(uid), supabase.rpc('is_supporter', { p_uid: uid })]);
      if (rowRes.error || gateRes.error) {
        logError(rowRes.error ?? gateRes.error, 'supporter.serverState');
        return 'error';
      }
      if (gateRes.data !== true) return { status: 'free' };
      const sub = liveSubscription(rowRes.data as EntitlementRow | null);
      return sub ? { status: 'active', ...sub } : { status: 'free' };
    } catch (e) {
      logError(e, 'supporter.serverState');
      return 'error';
    }
  }

  /**
   * Kill switch off: is she still paying? Her row alone decides — the gate is
   * off for everyone while the switch is. Null = no live subscription.
   */
  async function readPaused(uid: string): Promise<PausedSupporter | null | 'error'> {
    try {
      const { data, error } = await ownRow(uid);
      if (error) {
        logError(error, 'supporter.pausedState');
        return 'error';
      }
      const row = data as EntitlementRow | null;
      // Production only: a store tester's sandbox subscription is not money
      // she pays (is_supporter counts sandbox only in a test window, which a
      // client cannot read, so it is never assumed here).
      const sub = row?.environment === 'production' ? liveSubscription(row) : null;
      return sub ? { status: 'paused', ...sub } : null;
    } catch (e) {
      logError(e, 'supporter.pausedState');
      return 'error';
    }
  }

  async function customerInfo(): Promise<CustomerInfo | null> {
    if (!(await ensureSdk())) return null;
    try {
      return await Purchases.getCustomerInfo();
    } catch (e) {
      sdkFailure('getCustomerInfo', e);
      return null;
    }
  }

  /** Read the server until it confirms, on POLL_DELAYS_MS. Null when it never did. */
  async function waitForServer(uid: string): Promise<ActiveSupporter | null> {
    for (let i = 0; i <= POLL_DELAYS_MS.length; i += 1) {
      if (i > 0) await deps.sleep(POLL_DELAYS_MS[i - 1]);
      const s = await readServer(uid);
      if (s !== 'error' && s.status === 'active') return { ...s, willRenew: null };
    }
    return null;
  }

  function notify(): void {
    for (const l of [...listeners]) {
      try { l(); } catch (e) { logError(e, 'supporter.listener'); }
    }
  }

  /** Key, session and kill switch, in that order (cheapest first). */
  async function gate(): Promise<{ uid: string; enabled: boolean } | 'unavailable' | 'error'> {
    if (!apiKey) return 'unavailable';
    const uid = deps.currentUserId();
    if (!uid) return 'unavailable';
    const enabled = await readEnabled();
    if (enabled === null) return 'error';
    return { uid, enabled };
  }

  /** The gate for anything that sells or touches the store: the switch off is simply unavailable. */
  async function sellGate(): Promise<{ uid: string } | 'unavailable' | 'error'> {
    const g = await gate();
    if (typeof g === 'string') return g;
    return g.enabled ? { uid: g.uid } : 'unavailable';
  }

  /** What she has right now, as the server says. */
  async function readState(): Promise<SupporterState> {
    const g = await gate();
    if (g === 'unavailable') return { status: 'unavailable' };
    if (g === 'error') return { status: 'error' };
    if (!g.enabled) {
      // Perks are off for everyone, but a member who pays is told so and
      // keeps Manage subscription; everyone else sees "Coming soon".
      const paused = await readPaused(g.uid);
      if (paused === 'error') return { status: 'error' };
      return paused ?? { status: 'unavailable' };
    }
    const s = await readServer(g.uid);
    if (s === 'error') return { status: 'error' };
    if (s.status !== 'active') return { status: 'free' };
    // Display hint only: whether the store will renew it (she may have cancelled).
    const info = await customerInfo();
    const ent = info?.entitlements?.active?.[SUPPORTER_ENTITLEMENT];
    return { ...s, willRenew: ent ? ent.willRenew : null };
  }

  function toPlan(id: SupporterPlanId, pkg: PurchasesPackage | null | undefined): SupporterPlan | null {
    if (!pkg?.product) return null;
    return {
      id,
      priceString: pkg.product.priceString,
      price: pkg.product.price,
      currencyCode: pkg.product.currencyCode,
      pricePerMonthString: pkg.product.pricePerMonthString ?? null,
      pkg,
    };
  }

  return {
    async syncIdentity(userId) {
      if (!apiKey) return;
      await serial(async () => {
        if (userId === null) {
          if (configured && !broken && sdkUser !== null) {
            sdkUser = null;
            try {
              // Leaves an anonymous RevenueCat user behind; the next sign-in logs in over it.
              await Purchases.logOut();
            } catch (e) {
              sdkFailure('logOut', e);
            }
          }
          return;
        }
        if (configured) {
          await identify(userId);
          return;
        }
        // First sign-in on this launch: configure now (so a purchase the store
        // finished while the app was closed is synced at once), but only while
        // the kill switch is on — off means no SDK call at all.
        if ((await readEnabled()) === true) await identify(userId);
      });
    },

    getState() {
      return readState();
    },

    async recheck() {
      const state = await readState();
      // The You row only re-reads on mount or on this signal (buy and restore send it too).
      if (state.status === 'active' || state.status === 'paused') notify();
      return state;
    },

    async loadPlans() {
      const g = await sellGate();
      if (g === 'unavailable') return { status: 'unavailable' };
      if (g === 'error') return { status: 'error' };
      if (!(await ensureSdk())) return { status: 'unavailable' };
      let current;
      try {
        // getOfferings() → { all, current }; current carries the standard
        // `monthly` ($rc_monthly) and `annual` ($rc_annual) packages.
        // src: https://unpkg.com/@revenuecat/purchases-typescript-internal@19.14.1/dist/offerings.d.ts · react-native-purchases 10.15.1 · 2026-10-27
        current = (await Purchases.getOfferings()).current;
      } catch (e) {
        sdkFailure('getOfferings', e);
        return { status: 'error' };
      }
      if (!current) return { status: 'unavailable' };
      const monthly = toPlan('monthly', current.monthly);
      const yearly = toPlan('yearly', current.annual);
      if (!monthly && !yearly) return { status: 'unavailable' };
      const info = await customerInfo();
      return {
        status: 'ready',
        monthly,
        yearly,
        yearlySavingPercent: yearlySavingPercent(monthly, yearly),
        alreadyPaid: storeHasSupporter(info),
      };
    },

    async buy(plan) {
      // The kill switch again, right before money moves.
      const g = await sellGate();
      if (g === 'unavailable') return { kind: 'unavailable' };
      if (g === 'error') {
        return { kind: 'error', code: 'UNKNOWN_ERROR', message: 'We couldn’t reach Roxy. Check your connection and try again.' };
      }
      if (!(await ensureSdk())) return { kind: 'unavailable' };
      Analytics.supporterPurchaseStarted(plan.id);
      try {
        // purchasePackage(pkg) resolves { productIdentifier, customerInfo, transaction };
        // a rejection carries `code` and `userCancelled`.
        // src: https://github.com/RevenueCat/react-native-purchases/blob/10.15.1/src/purchases.ts#L972 · react-native-purchases 10.15.1 · 2026-10-27
        await Purchases.purchasePackage(plan.pkg);
      } catch (e) {
        const err = readError(e);
        if (err.cancelled) return { kind: 'cancelled' };
        if (err.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return { kind: 'pending' };
        const code = codeName(err.code);
        Analytics.supporterPurchaseFailed(code);
        logBreadcrumb('supporter_purchase_failed', { code });
        return { kind: 'error', code, message: purchaseErrorCopy(err.code, deps.platformOS) };
      }
      Analytics.supporterPurchaseCompleted(plan.id);
      const confirmed = await waitForServer(g.uid);
      notify();
      return confirmed ? { kind: 'success', state: confirmed } : { kind: 'processing' };
    },

    async restore() {
      // Web Billing's restorePurchases only re-reads CustomerInfo; the paywall hides it there.
      // src: https://github.com/RevenueCat/react-native-purchases/blob/10.15.1/src/browser/nativeModule.ts#L86 · react-native-purchases 10.15.1 · 2026-10-27
      if (deps.platformOS === 'web') return { kind: 'unsupported' };
      const g = await sellGate();
      if (g === 'unavailable') return { kind: 'unavailable' };
      if (g === 'error') return { kind: 'error', code: 'UNKNOWN_ERROR', message: restoreErrorCopy(undefined) };
      if (!(await ensureSdk())) return { kind: 'unavailable' };
      let info: CustomerInfo;
      try {
        info = await Purchases.restorePurchases();
      } catch (e) {
        const { code } = readError(e);
        sdkFailure('restorePurchases', e);
        return { kind: 'error', code: codeName(code), message: restoreErrorCopy(code) };
      }
      if (!storeHasSupporter(info)) return { kind: 'nothing' };
      Analytics.supporterRestored();
      const confirmed = await waitForServer(g.uid);
      notify();
      return confirmed ? { kind: 'success', state: confirmed } : { kind: 'processing' };
    },

    canRestore() {
      return deps.platformOS !== 'web';
    },

    async manageUrl(state) {
      if (!apiKey) return null;
      const sub = state.status === 'active' || state.status === 'paused' ? state : null;
      // Paid in Play (or we never learned the store) on Android: the Play page
      // below is right. Any other store's subscription (a web one) can only be
      // managed through the portal link RevenueCat reports.
      const playStore = !sub?.store || sub.store === 'play_store';
      // Paused (kill switch off) with a Play subscription on Android: the Play
      // page is enough, so the SDK stays untouched. Otherwise the link exists
      // only in CustomerInfo, so that one read is allowed: she must be able
      // to cancel.
      if (!(state.status === 'paused' && deps.platformOS === 'android' && playStore)) {
        // CustomerInfo.managementURL: "If this user has an active Play Store
        // subscription, this will point there". Null without an active one.
        // src: https://unpkg.com/@revenuecat/purchases-typescript-internal@19.14.1/dist/customerInfo.d.ts · react-native-purchases 10.15.1 · 2026-10-27
        const info = await customerInfo();
        const reported = httpsOrNull(info?.managementURL ?? null);
        if (reported) return reported;
      }
      // No link rather than a store that does not hold her subscription.
      if (deps.platformOS !== 'android' || !playStore) return null;
      // Play product ids arrive as "productId:basePlanId"; the deep link wants the productId.
      const sku = sub && sub.store === 'play_store' && sub.productId
        ? sub.productId.split(':')[0]
        : null;
      return sku
        ? `${PLAY_SUBSCRIPTIONS}?sku=${encodeURIComponent(sku)}&package=${ANDROID_PACKAGE}`
        : PLAY_SUBSCRIPTIONS;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The app's one RevenueCat client. */
export const supporter = createSupporter();

/** Root layout calls this whenever the signed-in id changes (null = signed out). */
export function syncSupporterIdentity(userId: string | null): Promise<void> {
  return supporter.syncIdentity(userId);
}

export function getSupporterState(): Promise<SupporterState> {
  return supporter.getState();
}
