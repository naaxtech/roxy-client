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

// ── The cart, and the money that comes out of it ────────────────────────────────

/**
 * A variant as this function reads it. `product_id` is NOT optional and is the whole
 * point: without it on the embed, nothing downstream can tell whether the row the
 * buyer pointed at is even related to the product she is buying.
 */
export interface VariantRow {
  id: string;
  product_id: string;
  price_cents: number;
  stock: number;
  is_active: boolean;
  option1_name: string | null;
  option1_value: string | null;
  option2_name: string | null;
  option2_value: string | null;
}

export interface ProductRow {
  id: string;
  name: string;
  status: string;
  is_active: boolean;
  has_variants: boolean;
  base_price_cents: number;
  business_id: string;
}

export interface CartItemRow {
  id: string;
  quantity: number;
  product: ProductRow | null;
  variant: VariantRow | null;
}

/** Why a cart cannot be checked out, in the shape `errorResponse` takes. */
export interface CartRejection {
  message: string;
  status: number;
}

/** One priced line — also exactly the snapshot the webhook and the hold read back. */
export interface PricedLine {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_label: string | null;
  unit_price_cents: number;
  quantity: number;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotalCents: number;
}

export type CartPricing =
  | { ok: true; cart: PricedCart }
  | { ok: false; rejection: CartRejection };

/**
 * Deliberately identical for every way a chosen variant can be unbuyable — inactive,
 * belonging to another product, or belonging to a product that declares it has none.
 * Distinguishing them would hand a buyer an oracle for mapping variant ids onto products,
 * and she has no use for the difference: none of the three is buyable.
 */
const VARIANT_UNAVAILABLE = 'Selected variant is not available';

/**
 * A cart line whose product row came back empty — hard-deleted, or hidden from this
 * reader by RLS. The cart-item uuid is deliberately NOT in this string: the client
 * renders it verbatim, and internal ids do not belong in a client-visible error
 * (`.claude/rules/react.md`, CLAUDE.md §11). It is logged instead, where support can
 * still use it.
 */
const ITEM_UNAVAILABLE = 'An item in your cart is no longer available';

/**
 * Validates a cart and prices it, or refuses it. One function, because pricing a cart
 * nobody validated is the entire bug class this exists to close.
 *
 * `create-product-order` used to validate in one loop and price in another, twelve lines
 * apart, and the price loop trusted `item.variant.price_cents` for any variant the first
 * loop had not rejected. The first loop could not reject a mismatched variant — it had no
 * `product_id` to compare — so the two loops disagreed about what had been checked. Making
 * the subtotal unreachable except as the success value of the validation removes the gap
 * rather than adding a third check to it.
 *
 * The rules, in the order a buyer meets them:
 *   - a line must have a product;
 *   - that product must belong to the business being PAID (the destination account comes
 *     from the cart's business, so a foreign product pays the wrong seller);
 *   - the product must be approved and active;
 *   - a variant, if present, must belong to that product, be one that product actually
 *     sells (`has_variants`), and be active;
 *   - a product with variants must have one chosen.
 *
 * The variant rule is symmetric on purpose. Requiring a variant when the product has them
 * and refusing one when it does not are the same rule read from either end; enforcing only
 * the first leaves the seller's base price and her variant prices both reachable for one
 * listing, and lets the buyer pick between them.
 *
 * Every price is then either a variant price of THAT product or the product's own base
 * price. There is no third source, and no request field reaches this function at all.
 */
export function priceCart(cart: { businessId: string; items: CartItemRow[] }): CartPricing {
  const reject = (message: string, status = 400): CartPricing => ({ ok: false, rejection: { message, status } });

  // index.ts refuses an empty cart earlier and more cheaply, before it touches Stripe.
  // Repeated here so the invariant belongs to the function that owns the subtotal: an
  // empty basket must never be priceable at zero.
  if (cart.items.length === 0) return reject('Cart is empty');

  const lines: PricedLine[] = [];

  for (const item of cart.items) {
    const product = item.product;
    if (!product) {
      console.error(`[create-product-order] cart item ${item.id} has no product row`);
      return reject(ITEM_UNAVAILABLE);
    }

    // `product.business_id` was fetched and never read. A cart is pinned to one seller by
    // UNIQUE (buyer_id, business_id), and `transfer_data.destination` is that seller's
    // account — so an unchecked line let a buyer put seller B's goods in seller A's basket
    // and pay A for them.
    if (product.business_id !== cart.businessId) {
      return reject(`"${product.name}" is not sold by this shop`);
    }

    if (product.status !== 'approved') return reject(`Product "${product.name}" is not approved`);
    if (!product.is_active) return reject(`Product "${product.name}" is not active`);

    const variant = item.variant;
    if (variant) {
      // THE FIX. Two independent foreign keys on `cart_items` meant the buyer chose both
      // ends of this comparison independently; migration 090 makes the mismatch
      // unrepresentable, and this makes it unpayable in the meantime.
      if (variant.product_id !== product.id) return reject(VARIANT_UNAVAILABLE);
      // The symmetric half, and the one 090's composite key CANNOT close: a variant that
      // genuinely belongs to this product satisfies the constraint even when the product
      // declares `has_variants = false`. The app never offers that row — `product/[id].tsx`
      // renders the picker only when `has_variants` and otherwise prices from
      // `base_price_cents` — so honouring it lets a buyer who writes `cart_items` herself
      // choose WHICH of the seller's own prices to pay, and sends the stock decrement to a
      // row the listing does not sell from. Latent while nothing writes `product_variants`;
      // live the day a variant editor ships.
      if (!product.has_variants) return reject(VARIANT_UNAVAILABLE);
      if (!variant.is_active) return reject(VARIANT_UNAVAILABLE);
    } else if (product.has_variants) {
      return reject(`Variant required for "${product.name}"`);
    }

    lines.push({
      product_id: product.id,
      variant_id: variant ? variant.id : null,
      product_name: product.name,
      variant_label: variant
        ? [variant.option1_value, variant.option2_value].filter(Boolean).join(' / ')
        : null,
      unit_price_cents: variant ? variant.price_cents : product.base_price_cents,
      quantity: item.quantity,
    });
  }

  return {
    ok: true,
    cart: {
      lines,
      subtotalCents: lines.reduce((sum, l) => sum + l.unit_price_cents * l.quantity, 0),
    },
  };
}
