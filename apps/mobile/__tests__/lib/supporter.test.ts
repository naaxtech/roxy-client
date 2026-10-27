/**
 * Roxy Supporter, client side (spec 2026-10-26 §1 › Client, Kill switch,
 * Analytics; plan docs/superpowers/plans/2026-10-26-supporter-s1-entitlements.md).
 *
 * The rules these pin:
 *   - Fail closed. No public SDK key for this platform, a secret key by
 *     mistake, or the server kill switch off → 'unavailable', and the
 *     RevenueCat SDK is never called.
 *   - The SDK is configured ONCE, with her Supabase id as appUserID; an
 *     account switch is a logIn, a sign-out a logOut.
 *   - What is unlocked is the server's answer (her own supporter_entitlements
 *     row, cross-checked with is_supporter), never the SDK's cache. The SDK
 *     only shapes what the paywall shows.
 *   - Cancelling the store sheet is quiet; an error gets a human sentence.
 *   - After paying, the server row is polled on a bounded backoff; when it is
 *     late she is told the payment arrived, never that perks are on.
 */

jest.mock('react-native-purchases', () => {
  const PURCHASES_ERROR_CODE = {
    UNKNOWN_ERROR: '0',
    PURCHASE_CANCELLED_ERROR: '1',
    STORE_PROBLEM_ERROR: '2',
    PURCHASE_NOT_ALLOWED_ERROR: '3',
    PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: '5',
    PRODUCT_ALREADY_PURCHASED_ERROR: '6',
    NETWORK_ERROR: '10',
    RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR: '13',
    PAYMENT_PENDING_ERROR: '20',
    OFFLINE_CONNECTION_ERROR: '35',
  };
  const Purchases = {
    configure: jest.fn(),
    setLogHandler: jest.fn(),
    logIn: jest.fn(async () => ({ created: false })),
    logOut: jest.fn(async () => ({})),
    getOfferings: jest.fn(),
    getCustomerInfo: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
  };
  return { __esModule: true, default: Purchases, PURCHASES_ERROR_CODE };
});
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('../../lib/analytics', () => ({
  Analytics: {
    supporterPaywallViewed: jest.fn(),
    supporterPurchaseStarted: jest.fn(),
    supporterPurchaseCompleted: jest.fn(),
    supporterPurchaseFailed: jest.fn(),
    supporterRestored: jest.fn(),
  },
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), logBreadcrumb: jest.fn() }));

import {
  createSupporter,
  POLL_DELAYS_MS,
  supporterLegalLinks,
  supporterStatusLabel,
  yearlySavingPercent,
  type SupporterDeps,
  type SupporterPlan,
} from '../../lib/supporter';

const Purchases = jest.requireMock('react-native-purchases').default as Record<string, jest.Mock>;
const { supabase } = jest.requireMock('../../lib/supabase') as { supabase: { rpc: jest.Mock; from: jest.Mock } };
const { Analytics } = jest.requireMock('../../lib/analytics') as { Analytics: Record<string, jest.Mock> };

const FUTURE = '2026-11-27T12:00:00+00:00';
const PAST = '2026-09-27T12:00:00+00:00';
const NOW = new Date('2026-10-27T12:00:00Z').getTime();

type Row = { status: string; period_ends_at: string | null; store: string | null; product_id: string | null };

/** What the server says right now; tests change it mid-poll to model webhook lag. */
let server: {
  enabled: boolean | 'error';
  row: Row | null;
  isSupporter: boolean;
  reads: number;
};

function installServer() {
  supabase.rpc.mockImplementation(async (fn: string, args?: { p_uid?: string }) => {
    if (fn === 'supporter_enabled') {
      return server.enabled === 'error'
        ? { data: null, error: { message: 'boom' } }
        : { data: server.enabled, error: null };
    }
    if (fn === 'is_supporter') {
      expect(args).toEqual({ p_uid: 'u1' });
      return { data: server.isSupporter, error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  });
  supabase.from.mockImplementation((table: string) => {
    expect(table).toBe('supporter_entitlements');
    return {
      select: () => ({
        eq: (col: string, val: string) => {
          expect([col, val]).toEqual(['user_id', 'u1']);
          return {
            maybeSingle: async () => {
              server.reads += 1;
              return { data: server.row, error: null };
            },
          };
        },
      }),
    };
  });
}

const activeRow = (over: Partial<Row> = {}): Row => ({
  status: 'active',
  period_ends_at: FUTURE,
  store: 'play_store',
  product_id: 'roxy_supporter_monthly:monthly',
  ...over,
});

const sleeps: number[] = [];

function client(over: Partial<SupporterDeps> = {}) {
  return createSupporter({
    keys: { android: 'goog_public_key', web: 'rcb_public_key' },
    platformOS: 'android',
    currentUserId: () => 'u1',
    now: () => NOW,
    sleep: async (ms: number) => { sleeps.push(ms); },
    ...over,
  });
}

const customer = (active: Record<string, { willRenew: boolean }> = {}, managementURL: string | null = null) => ({
  entitlements: { active, all: active },
  managementURL,
});

const pkg = (id: string, price: number, priceString: string, currencyCode = 'USD', pricePerMonthString: string | null = null) => ({
  identifier: id,
  packageType: id === '$rc_monthly' ? 'MONTHLY' : 'ANNUAL',
  product: { identifier: id, price, priceString, currencyCode, pricePerMonthString },
});

const OFFERING = {
  identifier: 'default',
  monthly: pkg('$rc_monthly', 4.99, '$4.99'),
  annual: pkg('$rc_annual', 39.99, '$39.99', 'USD', '$3.33'),
  availablePackages: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  sleeps.length = 0;
  server = { enabled: true, row: null, isSupporter: false, reads: 0 };
  installServer();
  Purchases.getCustomerInfo.mockResolvedValue(customer());
  Purchases.getOfferings.mockResolvedValue({ all: { default: OFFERING }, current: OFFERING });
});

const sdkCalls = () =>
  ['configure', 'logIn', 'logOut', 'getOfferings', 'getCustomerInfo', 'purchasePackage', 'restorePurchases']
    .reduce((n, k) => n + Purchases[k].mock.calls.length, 0);

describe('fail closed', () => {
  it('no public key for this platform: unavailable, and neither the server nor the SDK is asked', async () => {
    const c = client({ keys: { android: undefined, web: 'rcb_public_key' } });
    expect(await c.getState()).toEqual({ status: 'unavailable' });
    expect(await c.loadPlans()).toEqual({ status: 'unavailable' });
    await c.syncIdentity('u1');
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(sdkCalls()).toBe(0);
  });

  it('a whitespace key counts as missing', async () => {
    const c = client({ keys: { android: '   ' } });
    expect(await c.getState()).toEqual({ status: 'unavailable' });
    expect(sdkCalls()).toBe(0);
  });

  it('a SECRET key shipped by mistake is refused, never handed to the SDK', async () => {
    const c = client({ keys: { android: 'sk_live_secret' } });
    expect(await c.getState()).toEqual({ status: 'unavailable' });
    await c.syncIdentity('u1');
    expect(sdkCalls()).toBe(0);
  });

  it('iOS has no key yet, so it is unavailable rather than misconfigured', async () => {
    const c = client({ platformOS: 'ios' });
    expect(await c.getState()).toEqual({ status: 'unavailable' });
    expect(sdkCalls()).toBe(0);
  });

  it('kill switch off: unavailable everywhere, and no SDK call at all', async () => {
    server.enabled = false;
    server.row = activeRow();
    server.isSupporter = true;
    const c = client();
    await c.syncIdentity('u1');
    expect(await c.getState()).toEqual({ status: 'unavailable' });
    expect(await c.loadPlans()).toEqual({ status: 'unavailable' });
    expect(await c.buy({ id: 'monthly' } as SupporterPlan)).toEqual({ kind: 'unavailable' });
    expect(await c.restore()).toEqual({ kind: 'unavailable' });
    expect(sdkCalls()).toBe(0);
  });

  it('cannot read the kill switch: an error to retry, still no SDK call', async () => {
    server.enabled = 'error';
    const c = client();
    expect(await c.getState()).toEqual({ status: 'error' });
    expect(await c.loadPlans()).toEqual({ status: 'error' });
    expect(sdkCalls()).toBe(0);
  });

  it('signed out: unavailable', async () => {
    const c = client({ currentUserId: () => null });
    expect(await c.getState()).toEqual({ status: 'unavailable' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('an installed build without the native module (configure throws) is unavailable, not a crash', async () => {
    Purchases.configure.mockImplementationOnce(() => { throw new Error('[RevenueCat] Native module (RNPurchases) not found'); });
    const c = client();
    expect(await c.loadPlans()).toEqual({ status: 'unavailable' });
    expect(await c.buy({ id: 'monthly', pkg: OFFERING.monthly } as unknown as SupporterPlan)).toEqual({ kind: 'unavailable' });
    expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  });
});

describe('identity follows the session', () => {
  it('configures once, with her Supabase id as appUserID and the platform key', async () => {
    const c = client();
    await c.syncIdentity('u1');
    await c.syncIdentity('u1');
    await c.loadPlans();
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.configure).toHaveBeenCalledWith({ apiKey: 'goog_public_key', appUserID: 'u1' });
    expect(Purchases.logIn).not.toHaveBeenCalled();
  });

  it('uses the Web Billing key on web', async () => {
    const c = client({ platformOS: 'web' });
    await c.syncIdentity('u1');
    expect(Purchases.configure).toHaveBeenCalledWith({ apiKey: 'rcb_public_key', appUserID: 'u1' });
  });

  it('installs a quiet log handler BEFORE configure (RevenueCat logs carry the app user id)', async () => {
    const c = client();
    await c.syncIdentity('u1');
    expect(Purchases.setLogHandler).toHaveBeenCalledTimes(1);
    expect(Purchases.setLogHandler.mock.invocationCallOrder[0])
      .toBeLessThan(Purchases.configure.mock.invocationCallOrder[0]);
    const handler = Purchases.setLogHandler.mock.calls[0][0] as (level: string, msg: string) => void;
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    handler('INFO', 'Identifying App User ID: u1');
    expect(spy).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    spy.mockRestore();
    info.mockRestore();
  });

  it('an account switch is a logIn, not a second configure', async () => {
    const c = client();
    await c.syncIdentity('u1');
    await c.syncIdentity('u2');
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.logIn).toHaveBeenCalledWith('u2');
  });

  it('sign-out is one logOut; a second sign-out event does nothing', async () => {
    const c = client();
    await c.syncIdentity('u1');
    await c.syncIdentity(null);
    await c.syncIdentity(null);
    expect(Purchases.logOut).toHaveBeenCalledTimes(1);
  });

  it('sign-in after a sign-out logs the new member in', async () => {
    const c = client();
    await c.syncIdentity('u1');
    await c.syncIdentity(null);
    await c.syncIdentity('u1');
    expect(Purchases.logIn).toHaveBeenCalledWith('u1');
  });

  it('a sign-out before the SDK was ever configured makes no SDK call', async () => {
    const c = client();
    await c.syncIdentity(null);
    expect(sdkCalls()).toBe(0);
  });

  it('concurrent syncs for one member still configure exactly once', async () => {
    const c = client();
    await Promise.all([c.syncIdentity('u1'), c.syncIdentity('u1'), c.loadPlans()]);
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
  });
});

describe('what is unlocked comes from the server', () => {
  it('her live row + is_supporter → active, with the period end', async () => {
    server.row = activeRow();
    server.isSupporter = true;
    Purchases.getCustomerInfo.mockResolvedValue(customer({ supporter: { willRenew: true } }));
    const s = await client().getState();
    expect(s).toEqual(expect.objectContaining({
      status: 'active', inGrace: false, willRenew: true, store: 'play_store',
      productId: 'roxy_supporter_monthly:monthly',
    }));
    expect(s.status === 'active' && s.periodEndsAt?.toISOString()).toBe('2026-11-27T12:00:00.000Z');
  });

  it('the SDK saying "entitled" unlocks nothing while the server has no row', async () => {
    Purchases.getCustomerInfo.mockResolvedValue(customer({ supporter: { willRenew: true } }));
    expect(await client().getState()).toEqual({ status: 'free' });
  });

  it('a lapsed period is free, whatever the status column says', async () => {
    server.row = activeRow({ period_ends_at: PAST });
    server.isSupporter = false;
    expect(await client().getState()).toEqual({ status: 'free' });
  });

  it('expired and refunded rows are free', async () => {
    for (const status of ['expired', 'refunded']) {
      server.row = activeRow({ status });
      expect(await client().getState()).toEqual({ status: 'free' });
    }
  });

  it('grace (billing issue) still counts, and says so', async () => {
    server.row = activeRow({ status: 'grace' });
    server.isSupporter = true;
    expect(await client().getState()).toEqual(expect.objectContaining({ status: 'active', inGrace: true }));
  });

  it('a lifetime row (period "infinity") is active with no end date', async () => {
    server.row = activeRow({ period_ends_at: 'infinity' });
    server.isSupporter = true;
    expect(await client().getState()).toEqual(expect.objectContaining({ status: 'active', periodEndsAt: null }));
  });

  it('a live row the gate does not honour (sandbox outside a test window) is free', async () => {
    server.row = activeRow();
    server.isSupporter = false;
    expect(await client().getState()).toEqual({ status: 'free' });
  });

  it('a failed row read is an error, never a guess', async () => {
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'x' } }) }) }),
    }));
    expect(await client().getState()).toEqual({ status: 'error' });
  });

  it('willRenew is a display hint only: unknown when the SDK cannot answer', async () => {
    server.row = activeRow();
    server.isSupporter = true;
    Purchases.getCustomerInfo.mockRejectedValue(new Error('offline'));
    expect(await client().getState()).toEqual(expect.objectContaining({ status: 'active', willRenew: null }));
  });
});

describe('plans come from the store', () => {
  it('reads the current offering; prices are the store’s own strings', async () => {
    const p = await client().loadPlans();
    expect(p.status).toBe('ready');
    if (p.status !== 'ready') return;
    expect(p.monthly).toEqual(expect.objectContaining({ id: 'monthly', priceString: '$4.99' }));
    expect(p.yearly).toEqual(expect.objectContaining({ id: 'yearly', priceString: '$39.99', pricePerMonthString: '$3.33' }));
    expect(p.yearlySavingPercent).toBe(33);
    expect(p.alreadyPaid).toBe(false);
  });

  it('no current offering (RevenueCat not set up) is unavailable', async () => {
    Purchases.getOfferings.mockResolvedValue({ all: {}, current: null });
    expect(await client().loadPlans()).toEqual({ status: 'unavailable' });
  });

  it('an offering with neither package is unavailable', async () => {
    Purchases.getOfferings.mockResolvedValue({ all: {}, current: { ...OFFERING, monthly: null, annual: null } });
    expect(await client().loadPlans()).toEqual({ status: 'unavailable' });
  });

  it('a failed fetch is an error to retry', async () => {
    Purchases.getOfferings.mockRejectedValue(Object.assign(new Error('net'), { code: '10' }));
    expect(await client().loadPlans()).toEqual({ status: 'error' });
  });

  it('alreadyPaid: the store has her payment but the server row has not landed', async () => {
    Purchases.getCustomerInfo.mockResolvedValue(customer({ supporter: { willRenew: true } }));
    const p = await client().loadPlans();
    expect(p.status === 'ready' && p.alreadyPaid).toBe(true);
  });
});

describe('the yearly saving is computed from the store prices', () => {
  const plan = (price: number, currencyCode = 'USD') => ({ price, currencyCode }) as SupporterPlan;
  it('rounds DOWN, so it never over-claims', () => {
    expect(yearlySavingPercent(plan(4.99), plan(39.99))).toBe(33);
    expect(yearlySavingPercent(plan(10), plan(100))).toBe(16);
  });
  it('says nothing across currencies, without a monthly, or when yearly saves nothing', () => {
    expect(yearlySavingPercent(plan(4.99), plan(39.99, 'EUR'))).toBeNull();
    expect(yearlySavingPercent(null, plan(39.99))).toBeNull();
    expect(yearlySavingPercent(plan(4.99), plan(59.88))).toBeNull();
    expect(yearlySavingPercent(plan(0), plan(10))).toBeNull();
  });
});

const monthlyPlan = async (c: ReturnType<typeof client>) => {
  const p = await c.loadPlans();
  if (p.status !== 'ready' || !p.monthly) throw new Error('no plan');
  return p.monthly;
};

describe('buying', () => {
  it('cancelling the store sheet is quiet: no failure event, no message', async () => {
    const c = client();
    const plan = await monthlyPlan(c);
    Purchases.purchasePackage.mockRejectedValue(Object.assign(new Error('cancelled'), { code: '1', userCancelled: true }));
    expect(await c.buy(plan)).toEqual({ kind: 'cancelled' });
    expect(Analytics.supporterPurchaseStarted).toHaveBeenCalledWith('monthly');
    expect(Analytics.supporterPurchaseFailed).not.toHaveBeenCalled();
  });

  it('the cancelled code alone (userCancelled null) is still a cancel', async () => {
    const c = client();
    const plan = await monthlyPlan(c);
    Purchases.purchasePackage.mockRejectedValue(Object.assign(new Error('x'), { code: '1', userCancelled: null }));
    expect(await c.buy(plan)).toEqual({ kind: 'cancelled' });
  });

  it('an error gets a human sentence and a failure event with the code name, never the SDK text', async () => {
    const c = client();
    const plan = await monthlyPlan(c);
    Purchases.purchasePackage.mockRejectedValue(
      Object.assign(new Error('There was a problem with the store. user u1'), { code: '2', userCancelled: false }),
    );
    const out = await c.buy(plan);
    expect(out).toEqual({ kind: 'error', code: 'STORE_PROBLEM_ERROR', message: expect.any(String) });
    if (out.kind === 'error') expect(out.message).not.toMatch(/u1|problem with the store/);
    expect(Analytics.supporterPurchaseFailed).toHaveBeenCalledWith('STORE_PROBLEM_ERROR');
    expect(Analytics.supporterPurchaseCompleted).not.toHaveBeenCalled();
  });

  it('a non-SDK throw is an UNKNOWN error, still human', async () => {
    const c = client();
    const plan = await monthlyPlan(c);
    Purchases.purchasePackage.mockRejectedValue(new TypeError('x is undefined'));
    expect(await c.buy(plan)).toEqual({ kind: 'error', code: 'UNKNOWN_ERROR', message: expect.any(String) });
  });

  it('a payment the store holds as pending is not a failure', async () => {
    const c = client();
    const plan = await monthlyPlan(c);
    Purchases.purchasePackage.mockRejectedValue(Object.assign(new Error('pending'), { code: '20' }));
    expect(await c.buy(plan)).toEqual({ kind: 'pending' });
    expect(Analytics.supporterPurchaseFailed).not.toHaveBeenCalled();
  });

  it('paid, and the webhook lands during the poll: success from the server row', async () => {
    let polls = 0;
    const lagging = client({
      sleep: async (ms) => {
        sleeps.push(ms);
        polls += 1;
        if (polls === 2) { server.row = activeRow(); server.isSupporter = true; }
      },
    });
    const plan = await monthlyPlan(lagging);
    const listener = jest.fn();
    lagging.subscribe(listener);
    Purchases.purchasePackage.mockResolvedValue({ productIdentifier: 'roxy_supporter_monthly', customerInfo: customer() });
    const out = await lagging.buy(plan);
    expect(Purchases.purchasePackage).toHaveBeenCalledWith(OFFERING.monthly);
    expect(out.kind).toBe('success');
    expect(sleeps).toEqual(POLL_DELAYS_MS.slice(0, 2));
    expect(Analytics.supporterPurchaseCompleted).toHaveBeenCalledWith('monthly');
    expect(listener).toHaveBeenCalled();
  });

  it('paid, but the server never confirms: bounded, and "processing" — never success', async () => {
    const c = client();
    const plan = await monthlyPlan(c);
    Purchases.purchasePackage.mockResolvedValue({ productIdentifier: 'x', customerInfo: customer({ supporter: { willRenew: true } }) });
    const readsBefore = server.reads;
    const out = await c.buy(plan);
    expect(out).toEqual({ kind: 'processing' });
    expect(sleeps).toEqual([...POLL_DELAYS_MS]);
    expect(server.reads - readsBefore).toBe(POLL_DELAYS_MS.length + 1);
    expect(POLL_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(30_000);
  });

  it('re-checks the kill switch before opening the store sheet', async () => {
    const c = client();
    const plan = await monthlyPlan(c);
    server.enabled = false;
    expect(await c.buy(plan)).toEqual({ kind: 'unavailable' });
    expect(Purchases.purchasePackage).not.toHaveBeenCalled();
    expect(Analytics.supporterPurchaseStarted).not.toHaveBeenCalled();
  });
});

describe('restore', () => {
  it('is hidden on web: RevenueCat Web Billing has no restore', async () => {
    const c = client({ platformOS: 'web' });
    expect(c.canRestore()).toBe(false);
    expect(await c.restore()).toEqual({ kind: 'unsupported' });
    expect(Purchases.restorePurchases).not.toHaveBeenCalled();
    expect(client().canRestore()).toBe(true);
  });

  it('finds her subscription and the server agrees: success, supporter_restored', async () => {
    Purchases.restorePurchases.mockImplementation(async () => {
      server.row = activeRow();
      server.isSupporter = true;
      return customer({ supporter: { willRenew: true } });
    });
    const out = await client().restore();
    expect(out.kind).toBe('success');
    expect(Analytics.supporterRestored).toHaveBeenCalledTimes(1);
  });

  it('nothing to restore: says so, no restored event', async () => {
    Purchases.restorePurchases.mockResolvedValue(customer());
    expect(await client().restore()).toEqual({ kind: 'nothing' });
    expect(Analytics.supporterRestored).not.toHaveBeenCalled();
  });

  it('a restore error is human', async () => {
    Purchases.restorePurchases.mockRejectedValue(Object.assign(new Error('net'), { code: '10' }));
    expect(await client().restore()).toEqual({ kind: 'error', code: 'NETWORK_ERROR', message: expect.any(String) });
  });
});

describe('manage subscription', () => {
  const active = {
    status: 'active' as const, inGrace: false, periodEndsAt: new Date(FUTURE), willRenew: true,
    store: 'play_store', productId: 'roxy_supporter_monthly:monthly',
  };

  it('prefers the management URL RevenueCat reports', async () => {
    Purchases.getCustomerInfo.mockResolvedValue(customer({}, 'https://play.google.com/store/account/subscriptions'));
    expect(await client().manageUrl(active)).toBe('https://play.google.com/store/account/subscriptions');
  });

  it('falls back to the Play deep link for her product (base plan stripped)', async () => {
    expect(await client().manageUrl(active))
      .toBe('https://play.google.com/store/account/subscriptions?sku=roxy_supporter_monthly&package=com.roxy.app');
  });

  it('on web with no portal URL there is nothing to open', async () => {
    expect(await client({ platformOS: 'web' }).manageUrl({ ...active, store: 'rc_billing' })).toBeNull();
  });

  it('ignores a non-https URL', async () => {
    Purchases.getCustomerInfo.mockResolvedValue(customer({}, 'javascript:alert(1)'));
    expect(await client({ platformOS: 'web' }).manageUrl(active)).toBeNull();
  });
});

describe('the You row status', () => {
  const base = {
    status: 'active' as const, inGrace: false, periodEndsAt: new Date(FUTURE), willRenew: true as boolean | null,
    store: 'play_store', productId: 'x',
  };
  it('reads like the brief', () => {
    expect(supporterStatusLabel(base)).toBe('Active · renews 27 Nov 2026');
    expect(supporterStatusLabel({ ...base, willRenew: null })).toBe('Active · renews 27 Nov 2026');
    expect(supporterStatusLabel({ ...base, willRenew: false })).toBe('Active · ends 27 Nov 2026');
    expect(supporterStatusLabel({ ...base, inGrace: true })).toBe('Active · check payment');
    expect(supporterStatusLabel({ ...base, periodEndsAt: null })).toBe('Active');
  });
  it('says nothing when she is not a Supporter', () => {
    expect(supporterStatusLabel({ status: 'free' })).toBeNull();
    expect(supporterStatusLabel({ status: 'unavailable' })).toBeNull();
  });
});

describe('Terms and Privacy links', () => {
  it('only https URLs are drawn; unset means no dead link', () => {
    expect(supporterLegalLinks({ terms: 'https://roxy.example/terms', privacy: 'http://roxy.example/p' }))
      .toEqual({ terms: 'https://roxy.example/terms', privacy: null });
    expect(supporterLegalLinks({ terms: undefined, privacy: ' ' })).toEqual({ terms: null, privacy: null });
  });
});
