import {
  CHECKOUT_STEPS, checkoutStepLabel, checkoutProgressLabel,
} from '../../lib/checkoutSteps';

/**
 * The checkout's progress, said out loud.
 *
 * The indicator was three numbered dots and nothing else: no role, no label, no
 * current-step announcement. A woman using a screen reader on a payment flow
 * heard "1 2 3" and had no way to know which step she was on, what it was, or
 * how many were left. On the one screen where she is about to spend money, that
 * is the worst place in the app to be lost.
 *
 * Pure, so the announcement can be asserted without rendering a payment sheet.
 */

describe('the steps', () => {
  it('is the three the design names, in order', () => {
    expect(CHECKOUT_STEPS).toEqual(['review', 'shipping', 'payment']);
  });

  it('names each one in words a buyer would use', () => {
    expect(checkoutStepLabel('review')).toBe('Your bag');
    expect(checkoutStepLabel('shipping')).toBe('Delivery');
    expect(checkoutStepLabel('payment')).toBe('Payment');
  });
});

describe('checkoutProgressLabel', () => {
  it('says where she is, what it is, and how many there are', () => {
    expect(checkoutProgressLabel('review')).toBe('Step 1 of 3: Your bag');
    expect(checkoutProgressLabel('shipping')).toBe('Step 2 of 3: Delivery');
    expect(checkoutProgressLabel('payment')).toBe('Step 3 of 3: Payment');
  });

  it('counts from one, because she is not a zero-indexed array', () => {
    expect(checkoutProgressLabel('review')).toContain('Step 1');
  });
});
