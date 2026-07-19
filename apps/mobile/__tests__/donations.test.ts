jest.mock('../lib/supabase', () => ({
  callEdgeFunction: jest.fn(),
}));

import { clampDonationAmount, startDonationCheckout } from '../lib/donations';

describe('clampDonationAmount', () => {
  it('leaves an already-valid whole-dollar amount unchanged', () => {
    expect(clampDonationAmount(2000)).toBe(2000);
  });

  it('floors below the $5 minimum', () => {
    expect(clampDonationAmount(100)).toBe(500);
  });

  it('ceilings above the $1000 maximum', () => {
    expect(clampDonationAmount(999999)).toBe(100000);
  });

  it('rounds half up to the nearest whole dollar', () => {
    // 2050 cents = $20.50 -> round-half-up -> $21.00 = 2100 cents
    expect(clampDonationAmount(2050)).toBe(2100);
  });
});

describe('startDonationCheckout', () => {
  const { callEdgeFunction } = jest.requireMock('../lib/supabase');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the checkout url on success', async () => {
    (callEdgeFunction as jest.Mock).mockResolvedValue({
      data: { url: 'https://checkout.stripe.com/abc' },
      error: null,
    });

    const url = await startDonationCheckout(2000, 'monthly');

    expect(url).toBe('https://checkout.stripe.com/abc');
    expect(callEdgeFunction).toHaveBeenCalledWith('create-donation-checkout', {
      amount_cents: 2000,
      cadence: 'monthly',
    });
  });

  it('returns null when the edge function returns an error', async () => {
    (callEdgeFunction as jest.Mock).mockResolvedValue({ data: null, error: 'Stripe error' });

    const url = await startDonationCheckout(2000, 'one_time');

    expect(url).toBeNull();
  });

  it('returns null when the response has no url', async () => {
    (callEdgeFunction as jest.Mock).mockResolvedValue({ data: {}, error: null });

    const url = await startDonationCheckout(2000, 'yearly');

    expect(url).toBeNull();
  });

  it('returns null when the edge function call throws', async () => {
    (callEdgeFunction as jest.Mock).mockRejectedValue(new Error('network'));

    const url = await startDonationCheckout(2000, 'monthly');

    expect(url).toBeNull();
  });
});
