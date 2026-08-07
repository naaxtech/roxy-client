// supabase/functions/create-product-order/checkout.ts
//
// The checkout request shape and the money that follows from it, kept free of Deno,
// Stripe and Supabase imports so it loads under both the deployed function and the
// jest suite in apps/mobile. `index.ts` cannot be imported by a test — it opens a
// server at module scope and pulls in `npm:stripe` — and an amount a buyer pays is
// the last thing in this codebase that should be reasoned about rather than asserted.

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface CheckoutRequest {
  cartId: string;
  shipping: ShippingAddress;
  idempotencyKey: string;
}

/**
 * What the marketplace charges for shipping: nothing. Sellers price delivery into the
 * item, and `CheckoutSheet` tells the buyer so before she reaches the payment step
 * ("No separate shipping charge — the total on the next step is what you pay").
 *
 * A constant, and deliberately not a request field. This used to be read off the body
 * as `shipping_cost_cents`. It was type-checked and never range-checked, so a buyer
 * could post a negative one and set her own price: the subtotal stayed server-derived,
 * the platform fee is computed from the subtotal alone and so stayed correct, and the
 * intent opened for `subtotal + (negative)`. Stripe took it — `application_fee_amount`
 * was still ≤ `amount` — and the order row the webhook wrote was internally consistent,
 * so no reconciliation could see it. Clamping to zero would have left a field a client
 * can still set and a future author can still read.
 *
 * WHEN SHIPPING BECOMES REAL: derive it here from a server-side rate table keyed on the
 * seller's origin, the buyer's destination and the parcel — a `shipping_rates` table or
 * a carrier quote taken in this function. Do NOT reintroduce a body field, and do not
 * "just accept the number the client already computed": the client computing it for
 * display is not the client being allowed to charge it. Whatever replaces this constant
 * takes only server-derived inputs, and `orders.shipping_cost_cents` gets a
 * `CHECK (>= 0)` before it can hold anything but zero.
 */
export const SHIPPING_COST_CENTS = 0;

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function asShippingAddress(value: unknown): ShippingAddress | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const name = asString(raw.name);
  const line1 = asString(raw.line1);
  const city = asString(raw.city);
  const state = asString(raw.state);
  const postalCode = asString(raw.postal_code);
  const country = asString(raw.country);
  if (!name || !line1 || !city || !state || !postalCode || !country) return null;
  return {
    name, line1, city, state, country,
    postal_code: postalCode,
    line2: typeof raw.line2 === 'string' ? raw.line2 : undefined,
  };
}

export function asCheckoutRequest(body: Record<string, unknown>): CheckoutRequest | null {
  const cartId = asString(body.cart_id);
  const shipping = asShippingAddress(body.shipping_address);
  const idempotencyKey = asString(body.idempotency_key);
  if (!cartId || !shipping || !idempotencyKey) return null;
  // Nothing else on the body is read. Any pricing key a caller sends is ignored here
  // rather than sanitised, so there is no field left for a later change to start
  // trusting. See SHIPPING_COST_CENTS.
  return { cartId, shipping, idempotencyKey };
}
