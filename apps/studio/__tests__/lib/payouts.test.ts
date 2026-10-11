import { validatePayoutReason, payoutBlockMessage, releaseOutcome, payoutErrorMessage } from '@/lib/payouts';

describe('validatePayoutReason', () => {
  it('needs 3 to 1000 characters (staff_set_payout_block rule)', () => {
    expect(validatePayoutReason('  ')).toEqual({ ok: false, error: 'Give a reason (3 to 1000 characters).' });
    expect(validatePayoutReason('x'.repeat(1001))).toEqual({ ok: false, error: 'Give a reason (3 to 1000 characters).' });
    expect(validatePayoutReason('  chargeback opened ')).toEqual({ ok: true, reason: 'chargeback opened' });
  });
});

describe('payoutBlockMessage', () => {
  it('says what really changed', () => {
    expect(payoutBlockMessage(true, { changed: true, payout_blocked: true })).toBe('Payout blocked. It will not be released until core staff unblock it.');
    expect(payoutBlockMessage(true, { changed: false, payout_blocked: true })).toBe('This payout was already blocked. Nothing changed.');
    expect(payoutBlockMessage(false, { changed: true, payout_blocked: false })).toBe('Payout unblocked. It is released once its waiting period has passed.');
    expect(payoutBlockMessage(false, { changed: false, payout_blocked: false })).toBe('This payout was not blocked. Nothing changed.');
  });
});

describe('releaseOutcome', () => {
  it('treats only an actual transfer as success', () => {
    expect(releaseOutcome({ released: 1, skipped: 0, failed: 0 })).toEqual({ ok: true, message: 'Payout released to the host.' });
    expect(releaseOutcome({ released: 0, skipped: 1, failed: 0 })).toEqual({
      ok: false,
      error:
        'Not released. The event is not completed, its waiting period has not passed, it is blocked, it was already paid, or the host cannot receive payouts yet.',
    });
    expect(releaseOutcome({ released: 0, skipped: 0, failed: 1 })).toEqual({
      ok: false,
      error: 'Stripe refused the transfer. Nothing was paid; check the host’s Stripe account and try again.',
    });
    expect(releaseOutcome({ released: 0, skipped: 0, failed: 0 })).toMatchObject({ ok: false });
    expect(releaseOutcome(null)).toMatchObject({ ok: false });
  });
});

describe('payoutErrorMessage', () => {
  it('maps RPC codes', () => {
    expect(payoutErrorMessage({ code: '42501', message: 'Only core staff can change a payout' })).toBe('Only core staff can change a payout.');
    expect(payoutErrorMessage({ code: '55000', message: 'This payout was already released' })).toBe('This payout was already released');
    expect(payoutErrorMessage({ code: 'P0002', message: 'Event not found' })).toBe('Event not found');
    expect(payoutErrorMessage({ code: 'PGRST202', message: '' })).toMatch(/migration 131/);
    expect(payoutErrorMessage({ code: 'XX000', message: 'boom' })).toBe('That did not go through. Nothing was changed — try again.');
  });
});
