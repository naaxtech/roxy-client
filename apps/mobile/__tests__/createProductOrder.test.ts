import {
  SHIPPING_COST_CENTS,
  asCheckoutRequest,
} from '../../../supabase/functions/create-product-order/checkout';

/**
 * The buyer must not be able to name a number that reaches the PaymentIntent.
 *
 * `create-product-order` derives the subtotal from the cart server-side and always
 * has. It also used to accept `shipping_cost_cents` from the request body and open
 * the intent for `subtotal + shipping`, with no range check anywhere on the path:
 * the column is `integer NOT NULL DEFAULT 0` with no CHECK (migration 032:22), and
 * `total_cents` is generated from it. Posting `shipping_cost_cents: -8000` against a
 * ₱100.00 cart charged ₱20.00 — Stripe accepts it because `application_fee_amount`
 * is computed from the subtotal alone, so 1000 ≤ 2000 holds — and the order row that
 * lands is internally consistent, so nothing downstream can tell it happened.
 *
 * The fix is the absence of the field, not a clamp: an unused input a client can
 * still set is one refactor away from being read again.
 *
 * These tests exercise the deployed edge function's own parser. They do not exercise
 * the rest of `index.ts` — it opens a server at module scope and imports `npm:stripe`,
 * so it cannot be loaded here. See the note in `checkout.ts`.
 */

const ADDRESS = {
  name: 'Test Buyer',
  line1: '123 Main St',
  city: 'Manila',
  state: 'NCR',
  postal_code: '1000',
  country: 'PH',
};

const PARSED_ADDRESS = { ...ADDRESS, line2: undefined };

/** The exact body from the exploit: everything valid, plus a price the buyer chose. */
const hostileBody = (shippingCostCents: number): Record<string, unknown> => ({
  cart_id: 'cart-1',
  shipping_address: ADDRESS,
  idempotency_key: 'key-1',
  shipping_cost_cents: shippingCostCents,
});

describe('create-product-order checkout request', () => {
  it('drops a negative shipping_cost_cents instead of pricing the order with it', () => {
    expect(asCheckoutRequest(hostileBody(-8000))).toEqual({
      cartId: 'cart-1',
      shipping: PARSED_ADDRESS,
      idempotencyKey: 'key-1',
    });
  });

  it('drops a positive shipping_cost_cents too — shipping is not a buyer input', () => {
    expect(asCheckoutRequest(hostileBody(4500))).toEqual({
      cartId: 'cart-1',
      shipping: PARSED_ADDRESS,
      idempotencyKey: 'key-1',
    });
  });

  /**
   * `index.ts` opens the PaymentIntent for `subtotalCents + SHIPPING_COST_CENTS`.
   * The exploit was ₱100.00 of cart charged as ₱20.00; both terms are asserted here
   * because a non-zero constant would reintroduce the same gap from the other side.
   */
  it('charges the server-derived subtotal, whatever the body asked for', () => {
    const SUBTOTAL_CENTS = 10_000;
    expect(asCheckoutRequest(hostileBody(-8000))).not.toBeNull();
    expect(SHIPPING_COST_CENTS).toBe(0);
    expect(SUBTOTAL_CENTS + SHIPPING_COST_CENTS).toBe(SUBTOTAL_CENTS);
  });

  // Characterisation tests: these held before the parser moved out of index.ts and
  // must still hold after. They guard the extraction, not the fix.
  it('parses a well-formed body', () => {
    expect(
      asCheckoutRequest({ cart_id: 'cart-1', shipping_address: ADDRESS, idempotency_key: 'key-1' })
    ).toEqual({ cartId: 'cart-1', shipping: PARSED_ADDRESS, idempotencyKey: 'key-1' });
  });

  it.each([
    ['cart_id', { shipping_address: ADDRESS, idempotency_key: 'key-1' }],
    ['shipping_address', { cart_id: 'cart-1', idempotency_key: 'key-1' }],
    ['idempotency_key', { cart_id: 'cart-1', shipping_address: ADDRESS }],
    ['a complete shipping_address', {
      cart_id: 'cart-1',
      idempotency_key: 'key-1',
      shipping_address: { ...ADDRESS, postal_code: '' },
    }],
  ])('rejects a body missing %s', (_label, body) => {
    expect(asCheckoutRequest(body as Record<string, unknown>)).toBeNull();
  });
});
