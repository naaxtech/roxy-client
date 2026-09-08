/**
 * Idempotency key for one checkout attempt.
 *
 * create-product-order forwards this straight to Stripe as the `Idempotency-Key`
 * header, which is what stops a retried request from opening a second
 * PaymentIntent (and charging twice). Two properties matter:
 *
 * 1. Stable across a retry of the SAME attempt — the caller keeps the key (and the
 *    resulting client secret) for as long as the basket and address are unchanged.
 * 2. Different for a different attempt — otherwise Stripe answers a changed request
 *    with an `idempotency_error` (StripeIdempotencyError: "An idempotency key was
 *    used improperly") instead of taking the new payment.
 *    src: https://github.com/stripe/stripe-node/wiki/Error-Handling · stripe-node 14 · 2026-08-03
 *
 * The key is not a secret and is never logged. It is not generated with a CSPRNG
 * because it does not need to be unguessable: Stripe scopes keys per API key and
 * rejects a reuse whose parameters differ, and every buyer's request differs (own
 * customer id, own cart id, own address). A collision therefore fails one checkout
 * — it can never hand one buyer another buyer's PaymentIntent.
 */
export function newIdempotencyKey(): string {
  const time = Date.now().toString(36);
  const a = Math.random().toString(36).slice(2, 12);
  const b = Math.random().toString(36).slice(2, 12);
  return `roxy-${time}-${a}${b}`;
}

/**
 * Fingerprint of what the buyer is about to pay for. When this is unchanged the
 * caller reuses the PaymentIntent it already opened instead of asking the server
 * for a new one — a second call would decrement stock a second time.
 */
export function checkoutSignature(
  lines: { product_id: string; variant_id: string | null; quantity: number }[],
  shipping: { name: string; line1: string; line2?: string; city: string; state: string; postal_code: string; country: string }
): string {
  const basket = lines
    .map((l) => `${l.product_id}:${l.variant_id ?? '-'}:${l.quantity}`)
    .sort()
    .join('|');
  const address = [
    shipping.name, shipping.line1, shipping.line2 ?? '',
    shipping.city, shipping.state, shipping.postal_code, shipping.country,
  ].map((part) => part.trim().toLowerCase()).join('|');
  return `${basket}#${address}`;
}
