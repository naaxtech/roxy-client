/**
 * Who is allowed to take money, asserted.
 *
 * The three states are a UI affordance; `canSell` is a permission. They are
 * tested separately on purpose — the failure that matters is not "the chip says
 * the wrong word", it is "a woman who has not been approved can open a product
 * composer and start charging people".
 */
import {
  deriveSellerStatus,
  sellerStatusLabel,
  canSell,
  type SellerStatus,
} from '../../lib/sellerStatus';

const APPROVED = { is_verified: true, can_sell: true, stripe_account_id: 'acct_123' };

describe('deriveSellerStatus', () => {
  it('is none when she has never applied', () => {
    expect(deriveSellerStatus([])).toBe('none');
    expect(deriveSellerStatus(null)).toBe('none');
    expect(deriveSellerStatus(undefined)).toBe('none');
  });

  it('is review the moment a business row exists', () => {
    expect(deriveSellerStatus([{}])).toBe('review');
    expect(deriveSellerStatus([{ is_verified: false, can_sell: false, stripe_account_id: null }]))
      .toBe('review');
  });

  it('is approved only when verified AND can_sell AND Stripe is connected', () => {
    expect(deriveSellerStatus([APPROVED])).toBe('approved');
  });

  it.each([
    ['unverified', { ...APPROVED, is_verified: false }],
    ['selling disabled', { ...APPROVED, can_sell: false }],
    ['no Stripe account', { ...APPROVED, stripe_account_id: null }],
    ['empty Stripe account', { ...APPROVED, stripe_account_id: '' }],
  ])('stays in review when %s', (_why, row) => {
    expect(deriveSellerStatus([row])).toBe('review');
  });

  it('approves on any one qualifying business, not on all of them', () => {
    expect(deriveSellerStatus([{ is_verified: false }, APPROVED])).toBe('approved');
  });

  // Nulls arrive from PostgREST for a column that exists but was never set.
  it('treats a null boolean as not-yet, never as yes', () => {
    expect(deriveSellerStatus([{ is_verified: null, can_sell: null, stripe_account_id: null }]))
      .toBe('review');
  });
});

describe('canSell', () => {
  it('permits approved and nothing else', () => {
    const states: SellerStatus[] = ['none', 'review', 'approved'];
    expect(states.filter(canSell)).toEqual(['approved']);
  });
});

describe('sellerStatusLabel', () => {
  it('gives each state its own word', () => {
    const labels = (['none', 'review', 'approved'] as SellerStatus[]).map(sellerStatusLabel);
    expect(labels).toEqual(['Apply', 'In review', 'Approved ✓']);
    expect(new Set(labels).size).toBe(3);
  });
});
