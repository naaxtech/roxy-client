import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

/**
 * The Roxy Supporter paywall, `/supporter` (spec 2026-10-26 §1 › Paywall).
 *
 * Every state is deliberate: plans loading (skeleton at the final layout),
 * "Coming soon" while the kill switch is off or the build has no key, an
 * error with Retry, the offer, a purchase in flight, a cancel (quiet), a
 * failure (a human sentence and the same button again), "payment received"
 * when the webhook is late, and success only once the server says so. Prices
 * are the store's strings; the yearly saving is computed from them.
 */

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../hooks/useThemeColors', () => ({
  useThemeColors: () => jest.requireActual('../../lib/theme').THEMES.light,
}));
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
let mockAccess: { loading: boolean; kind: string } = { loading: false, kind: 'member' };
jest.mock('../../hooks/useAccess', () => ({ useAccess: () => mockAccess }));
jest.mock('../../lib/analytics', () => ({ Analytics: { supporterPaywallViewed: jest.fn() } }));

// The client is built inside the factory (it runs before this file's own
// consts exist, because imports are hoisted) and fetched back below.
jest.mock('../../lib/supporter', () => ({
  ...jest.requireActual('../../lib/supporter'),
  supporter: {
    getState: jest.fn(),
    recheck: jest.fn(),
    loadPlans: jest.fn(),
    buy: jest.fn(),
    restore: jest.fn(),
    canRestore: jest.fn(() => true),
    manageUrl: jest.fn(),
    subscribe: jest.fn(() => () => undefined),
  },
  supporterLegalLinks: jest.fn(),
}));

// eslint-disable-next-line import/first
import SupporterScreen from '../../app/supporter';

const { Analytics } = jest.requireMock('../../lib/analytics') as { Analytics: Record<string, jest.Mock> };
const supporterMock = jest.requireMock('../../lib/supporter') as {
  supporter: Record<'getState' | 'recheck' | 'loadPlans' | 'buy' | 'restore' | 'canRestore' | 'manageUrl' | 'subscribe', jest.Mock>;
  supporterLegalLinks: jest.Mock;
};
const mockClient = supporterMock.supporter;
let mockLegal: { terms: string | null; privacy: string | null } = {
  terms: 'https://roxy.example/terms',
  privacy: 'https://roxy.example/privacy',
};

const MONTHLY = { id: 'monthly', priceString: '₱279.00', price: 279, currencyCode: 'PHP', pricePerMonthString: '₱279.00', pkg: { identifier: '$rc_monthly' } };
const YEARLY = { id: 'yearly', priceString: '₱2,190.00', price: 2190, currencyCode: 'PHP', pricePerMonthString: '₱182.50', pkg: { identifier: '$rc_annual' } };
const READY = { status: 'ready', monthly: MONTHLY, yearly: YEARLY, yearlySavingPercent: 34, alreadyPaid: false };
const ACTIVE = {
  status: 'active', inGrace: false, periodEndsAt: new Date('2026-11-27T12:00:00Z'), willRenew: true,
  store: 'play_store', productId: 'roxy_supporter_monthly',
};

let openURL: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockCanGoBack = true;
  mockAccess = { loading: false, kind: 'member' };
  mockLegal = { terms: 'https://roxy.example/terms', privacy: 'https://roxy.example/privacy' };
  mockClient.getState.mockResolvedValue({ status: 'free' });
  mockClient.recheck.mockReset().mockResolvedValue({ status: 'free' });
  mockClient.loadPlans.mockResolvedValue(READY);
  mockClient.canRestore.mockReturnValue(true);
  mockClient.manageUrl.mockResolvedValue('https://play.google.com/store/account/subscriptions');
  mockClient.subscribe.mockReturnValue(() => undefined);
  supporterMock.supporterLegalLinks.mockImplementation(() => mockLegal);
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

const offer = async () => {
  const v = render(<SupporterScreen />);
  await v.findByTestId('supporter-buy');
  return v;
};

describe('loading and the offer', () => {
  it('holds the plans’ shape while they load (no spinner)', async () => {
    mockClient.getState.mockReturnValue(new Promise(() => undefined));
    const v = render(<SupporterScreen />);
    expect(v.getByTestId('supporter-loading')).toBeTruthy();
    expect(v.queryByTestId('supporter-buy')).toBeNull();
  });

  it('shows the perks in plain words and both plans at the store’s own prices', async () => {
    const v = await offer();
    expect(v.getByTestId('supporter-paywall')).toBeTruthy();
    for (const perk of ['City chapters anywhere', 'Incognito', 'Profile banner and skins', 'Apply to sell', 'Supporter sticker']) {
      expect(v.getByText(perk)).toBeTruthy();
    }
    const monthly = v.getByTestId('supporter-plan-monthly');
    const yearly = v.getByTestId('supporter-plan-yearly');
    expect(within(monthly).getByText('₱279.00 a month')).toBeTruthy();
    expect(within(yearly).getByText('₱2,190.00 a year · ₱182.50 a month')).toBeTruthy();
    expect(within(yearly).getByText('Save 34%')).toBeTruthy();
    expect(JSON.stringify(v.toJSON())).not.toContain('4.99');
  });

  it('starts on monthly (no pre-selected bigger charge) and marks the choice for screen readers', async () => {
    const v = await offer();
    expect(v.getByTestId('supporter-plan-monthly').props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(v.getByTestId('supporter-plan-yearly').props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
    fireEvent.press(v.getByTestId('supporter-plan-yearly'));
    expect(v.getByTestId('supporter-plan-yearly').props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(v.getByText(/Renews every year at ₱2,190.00 until you cancel/)).toBeTruthy();
  });

  it('omits the saving when the store prices give none', async () => {
    mockClient.loadPlans.mockResolvedValue({ ...READY, yearlySavingPercent: null });
    const v = await offer();
    expect(v.queryByText(/Save/)).toBeNull();
  });

  it('records the view once, with where she came from', async () => {
    mockParams = { source: 'you' };
    await offer();
    expect(Analytics.supporterPaywallViewed).toHaveBeenCalledTimes(1);
    expect(Analytics.supporterPaywallViewed).toHaveBeenCalledWith('you');
  });

  it('?reason=<perk> leads with the perk that brought her', async () => {
    mockParams = { reason: 'chapters' };
    const v = await offer();
    expect(v.getByText('Join chapters in any city')).toBeTruthy();
    const perks = within(v.getByTestId('supporter-perks')).getAllByTestId(/^supporter-perk-/);
    expect(perks[0].props.testID).toBe('supporter-perk-chapters');
    expect(Analytics.supporterPaywallViewed).toHaveBeenCalledWith('chapters');
  });

  it('an unknown reason or source is not passed through to analytics', async () => {
    mockParams = { reason: '<script>', source: 'jane@example.com' };
    await offer();
    expect(Analytics.supporterPaywallViewed).toHaveBeenCalledWith('direct');
  });

  it('links Terms and Privacy when they exist, and draws no dead link when they do not', async () => {
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-terms'));
    expect(openURL).toHaveBeenCalledWith('https://roxy.example/terms');
    fireEvent.press(v.getByTestId('supporter-privacy'));
    expect(openURL).toHaveBeenCalledWith('https://roxy.example/privacy');
    mockLegal = { terms: null, privacy: null };
    const w = render(<SupporterScreen />);
    await w.findByTestId('supporter-buy');
    expect(w.queryByTestId('supporter-terms')).toBeNull();
    expect(w.queryByTestId('supporter-privacy')).toBeNull();
  });
});

describe('unavailable and errors', () => {
  it('kill switch off / no key: "Coming soon", no buy button', async () => {
    mockClient.getState.mockResolvedValue({ status: 'unavailable' });
    const v = render(<SupporterScreen />);
    const box = await v.findByTestId('supporter-unavailable');
    expect(within(box).getByText('Roxy Supporter is coming soon')).toBeTruthy();
    expect(v.queryByTestId('supporter-buy')).toBeNull();
    expect(mockClient.loadPlans).not.toHaveBeenCalled();
  });

  it('no offering from the store is "Coming soon" too', async () => {
    mockClient.loadPlans.mockResolvedValue({ status: 'unavailable' });
    const v = render(<SupporterScreen />);
    expect(await v.findByTestId('supporter-unavailable')).toBeTruthy();
  });

  it('an applicant is told it opens once she is in, and nothing is asked of the server', async () => {
    mockAccess = { loading: false, kind: 'pending' };
    const v = render(<SupporterScreen />);
    const box = await v.findByTestId('supporter-unavailable');
    expect(within(box).getByText('Roxy Supporter opens once you’re in')).toBeTruthy();
    expect(mockClient.getState).not.toHaveBeenCalled();
  });

  it('a failed load says so and retries', async () => {
    mockClient.getState.mockResolvedValueOnce({ status: 'error' });
    const v = render(<SupporterScreen />);
    expect(await v.findByText('Couldn’t load Roxy Supporter')).toBeTruthy();
    fireEvent.press(v.getByTestId('supporter-retry'));
    expect(await v.findByTestId('supporter-buy')).toBeTruthy();
    expect(mockClient.getState).toHaveBeenCalledTimes(2);
  });
});

describe('buying', () => {
  it('buys the chosen plan; success only once the server says so; Done returns her', async () => {
    mockClient.buy.mockResolvedValue({ kind: 'success', state: ACTIVE });
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-plan-yearly'));
    fireEvent.press(v.getByTestId('supporter-buy'));
    expect(await v.findByText('You’re a Roxy Supporter')).toBeTruthy();
    expect(mockClient.buy).toHaveBeenCalledWith(YEARLY);
    fireEvent.press(v.getByTestId('supporter-done'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('Done with nowhere to go back to lands on You', async () => {
    mockCanGoBack = false;
    mockClient.buy.mockResolvedValue({ kind: 'success', state: ACTIVE });
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-buy'));
    fireEvent.press(await v.findByTestId('supporter-done'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/you');
  });

  it('marks the button busy while the store sheet is up', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    mockClient.buy.mockReturnValue(new Promise((r) => { resolve = r; }));
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-buy'));
    await waitFor(() => expect(v.getByTestId('supporter-buy').props.accessibilityState).toEqual(expect.objectContaining({ busy: true })));
    resolve({ kind: 'cancelled' });
    await waitFor(() => expect(v.getByTestId('supporter-buy').props.accessibilityState).toEqual(expect.objectContaining({ busy: false })));
  });

  it('a cancel is quiet: no message, the offer stays', async () => {
    mockClient.buy.mockResolvedValue({ kind: 'cancelled' });
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-buy'));
    await waitFor(() => expect(mockClient.buy).toHaveBeenCalled());
    await waitFor(() => expect(v.getByTestId('supporter-buy').props.accessibilityState.busy).toBe(false));
    expect(v.queryByTestId('supporter-message')).toBeNull();
    expect(v.getByTestId('supporter-plan-monthly')).toBeTruthy();
  });

  it('a failure gets the human sentence as an alert, and the same button tries again', async () => {
    mockClient.buy
      .mockResolvedValueOnce({ kind: 'error', code: 'NETWORK_ERROR', message: 'You’re offline. Check your connection and try again.' })
      .mockResolvedValueOnce({ kind: 'success', state: ACTIVE });
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-buy'));
    const msg = await v.findByTestId('supporter-message');
    expect(within(msg).getByText('You’re offline. Check your connection and try again.')).toBeTruthy();
    expect(msg.props.accessibilityRole).toBe('alert');
    fireEvent.press(v.getByTestId('supporter-buy'));
    expect(await v.findByText('You’re a Roxy Supporter')).toBeTruthy();
  });

  it('paid but the server is late: "Payment received", never "you’re a Supporter"', async () => {
    mockClient.buy.mockResolvedValue({ kind: 'processing' });
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-buy'));
    expect(await v.findByText('Payment received — your perks will appear in a minute.')).toBeTruthy();
    expect(v.queryByText('You’re a Roxy Supporter')).toBeNull();
  });

  it('a payment the store holds as pending says so', async () => {
    mockClient.buy.mockResolvedValue({ kind: 'pending' });
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-buy'));
    expect(await v.findByText('Payment pending')).toBeTruthy();
  });

  it('already paid in the store, server row not here yet: no second purchase offered', async () => {
    mockClient.loadPlans.mockResolvedValue({ ...READY, alreadyPaid: true });
    const v = render(<SupporterScreen />);
    expect(await v.findByText('Payment received — your perks will appear in a minute.')).toBeTruthy();
    expect(v.queryByTestId('supporter-buy')).toBeNull();
  });
});

describe('paid but not confirmed: a way out', () => {
  const paidLate = async () => {
    mockClient.buy.mockResolvedValue({ kind: 'processing' });
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-buy'));
    await v.findByTestId('supporter-processing');
    return v;
  };

  it('"Check again" re-reads the server: confirmed → success', async () => {
    const v = await paidLate();
    mockClient.recheck.mockResolvedValue(ACTIVE);
    fireEvent.press(v.getByTestId('supporter-check'));
    expect(await v.findByTestId('supporter-success')).toBeTruthy();
    // recheck, not getState: it also tells the You row she is confirmed.
    expect(mockClient.recheck).toHaveBeenCalledTimes(1);
  });

  it('"Check again" while the server still has nothing says so and stays put; an error says so too', async () => {
    const v = await paidLate();
    mockClient.recheck.mockResolvedValueOnce({ status: 'free' }).mockResolvedValueOnce({ status: 'error' });
    fireEvent.press(v.getByTestId('supporter-check'));
    expect(await v.findByText(/Not through yet/)).toBeTruthy();
    expect(v.getByTestId('supporter-processing')).toBeTruthy();
    fireEvent.press(v.getByTestId('supporter-check'));
    expect(await v.findByText(/couldn’t check/i)).toBeTruthy();
    expect(v.getByTestId('supporter-processing')).toBeTruthy();
  });

  it('offers Restore on native, and says so when the store has nothing', async () => {
    const v = await paidLate();
    mockClient.restore.mockResolvedValueOnce({ kind: 'nothing' });
    fireEvent.press(v.getByTestId('supporter-restore'));
    expect(await v.findByText('No Roxy Supporter subscription found for this store account.')).toBeTruthy();
    mockClient.restore.mockResolvedValueOnce({ kind: 'success', state: ACTIVE });
    fireEvent.press(v.getByTestId('supporter-restore'));
    expect(await v.findByTestId('supporter-success')).toBeTruthy();
  });

  it('no Restore where the platform has none (web)', async () => {
    mockClient.canRestore.mockReturnValue(false);
    const v = await paidLate();
    expect(v.queryByTestId('supporter-restore')).toBeNull();
    expect(v.getByTestId('supporter-check')).toBeTruthy();
  });

  it('"Help with Supporter" opens the support channel with the topic filled in', async () => {
    const v = await paidLate();
    fireEvent.press(v.getByTestId('supporter-help'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(tabs)/you/feedback',
      params: { category: 'other', prefillMessage: 'About Roxy Supporter: ' },
    });
  });

  it('a store-pending payment can be checked again and has help too', async () => {
    mockClient.buy.mockResolvedValue({ kind: 'pending' });
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-buy'));
    await v.findByText('Payment pending');
    expect(v.getByTestId('supporter-check')).toBeTruthy();
    expect(v.getByTestId('supporter-help')).toBeTruthy();
  });
});

describe('Help with Supporter (spec › Commercial gate › Support)', () => {
  it('is on the offer and on her status page', async () => {
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-help'));
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/(tabs)/you/feedback' }));
    mockClient.getState.mockResolvedValue(ACTIVE);
    const w = render(<SupporterScreen />);
    await w.findByTestId('supporter-active');
    expect(w.getByTestId('supporter-help')).toBeTruthy();
  });
});

describe('kill switch off, but she pays', () => {
  const PAUSED = { ...ACTIVE, status: 'paused' };

  it('says her subscription is active and perks are paused, with Manage subscription and Help — never "Coming soon"', async () => {
    mockClient.getState.mockResolvedValue(PAUSED);
    const v = render(<SupporterScreen />);
    const box = await v.findByTestId('supporter-paused');
    expect(within(box).getByText('Your Supporter subscription is active')).toBeTruthy();
    expect(within(box).getByText(/perks are paused for a moment/)).toBeTruthy();
    expect(v.queryByText('Roxy Supporter is coming soon')).toBeNull();
    expect(v.queryByText('You’re a Roxy Supporter')).toBeNull();
    expect(v.queryByTestId('supporter-buy')).toBeNull();
    expect(mockClient.loadPlans).not.toHaveBeenCalled();
    fireEvent.press(await v.findByTestId('supporter-manage'));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions'));
    expect(mockClient.manageUrl).toHaveBeenCalledWith(PAUSED);
    fireEvent.press(v.getByTestId('supporter-help'));
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/(tabs)/you/feedback' }));
  });
});

describe('restore', () => {
  it('is offered on native and hidden where the platform has none (web)', async () => {
    const v = await offer();
    expect(v.getByTestId('supporter-restore')).toBeTruthy();
    mockClient.canRestore.mockReturnValue(false);
    const w = render(<SupporterScreen />);
    await w.findAllByTestId('supporter-buy');
    expect(w.queryByTestId('supporter-restore')).toBeNull();
  });

  it('nothing found says so; found goes to success', async () => {
    mockClient.restore
      .mockResolvedValueOnce({ kind: 'nothing' })
      .mockResolvedValueOnce({ kind: 'success', state: ACTIVE });
    const v = await offer();
    fireEvent.press(v.getByTestId('supporter-restore'));
    expect(await v.findByText('No Roxy Supporter subscription found for this store account.')).toBeTruthy();
    fireEvent.press(v.getByTestId('supporter-restore'));
    expect(await v.findByText('You’re a Roxy Supporter')).toBeTruthy();
  });
});

describe('already a Supporter', () => {
  it('shows her status and Manage subscription opens the store page', async () => {
    mockClient.getState.mockResolvedValue(ACTIVE);
    const v = render(<SupporterScreen />);
    expect(await v.findByText('Active · renews 27 Nov 2026')).toBeTruthy();
    expect(v.queryByTestId('supporter-buy')).toBeNull();
    fireEvent.press(v.getByTestId('supporter-manage'));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions'));
    expect(mockClient.manageUrl).toHaveBeenCalledWith(ACTIVE);
  });

  it('a billing problem tells her where to fix it', async () => {
    mockClient.getState.mockResolvedValue({ ...ACTIVE, inGrace: true });
    const v = render(<SupporterScreen />);
    expect(await v.findByText(/problem with your payment/)).toBeTruthy();
  });

  it('no management page available: no dead button', async () => {
    mockClient.getState.mockResolvedValue(ACTIVE);
    mockClient.manageUrl.mockResolvedValue(null);
    const v = render(<SupporterScreen />);
    await v.findByText('Active · renews 27 Nov 2026');
    await waitFor(() => expect(mockClient.manageUrl).toHaveBeenCalled());
    expect(v.queryByTestId('supporter-manage')).toBeNull();
  });
});
