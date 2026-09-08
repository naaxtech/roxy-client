import { readFileSync } from 'fs';
import { join } from 'path';

import {
  SHIPPING_COST_CENTS,
  asCheckoutRequest,
  priceCart,
  type CartItemRow,
  type ProductRow,
  type VariantRow,
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

/**
 * THE SECOND DOOR ONTO THE SAME EXPLOIT.
 *
 * Removing `shipping_cost_cents` from the request shape closed the door where the
 * buyer named a number. It did not close the door where she names a *row*.
 *
 * `cart_items` carries `product_id` and `variant_id` as two INDEPENDENT foreign keys
 * (migration 033:16-17). Nothing tied them together — no CHECK, no trigger, no
 * composite FK — and the `cart_items_owner` RLS policy authorises the CART, not its
 * contents: `USING (cart_id IN (SELECT id FROM carts WHERE buyer_id = auth.uid()))`.
 * `marketplaceStore.syncServerCart` writes those rows from the client under the anon
 * key, so a buyer can POST any pair she likes straight to PostgREST.
 *
 * The function then embedded the variant WITHOUT `product_id`, so it could not have
 * compared them even if it had wanted to, and priced the line off
 * `item.variant.price_cents`. Post `{cart_id: <hers>, product_id: <the ₱10,000 coat>,
 * variant_id: <any active variant priced at 1>}` and check out normally: everything
 * validates, the intent opens for 1 cent, the order shows the coat and her address,
 * and the seller ships it. `decrement_variant_stock` then ran against the DECOY
 * variant, so the coat's stock never moved and the attack repeated forever.
 *
 * The real fix is the composite foreign key in migration 090 — this is the layer that
 * must hold while that migration is still unapplied, and the layer that turns a
 * would-be constraint violation (money taken, no order row) into a clean 400.
 */
describe('create-product-order cart pricing', () => {
  const SELLER = 'biz-seller';
  const OTHER_SELLER = 'biz-someone-else';

  const product = (over: Partial<ProductRow> = {}): ProductRow => ({
    id: 'prod-coat',
    name: 'Handmade Coat',
    status: 'approved',
    is_active: true,
    has_variants: false,
    base_price_cents: 1_000_000,
    business_id: SELLER,
    ...over,
  });

  const variant = (over: Partial<VariantRow> = {}): VariantRow => ({
    id: 'var-coat-m',
    product_id: 'prod-coat',
    price_cents: 1_200_000,
    stock: 3,
    is_active: true,
    option1_name: 'Size',
    option1_value: 'M',
    option2_name: null,
    option2_value: null,
    ...over,
  });

  const line = (over: Partial<CartItemRow> = {}): CartItemRow => ({
    id: 'ci-1',
    quantity: 1,
    product: product(),
    variant: null,
    ...over,
  });

  /**
   * A line for a listing that genuinely sells variants — `has_variants: true` and a
   * variant chosen, the pair the app itself produces.
   *
   * `product()` defaults to `has_variants: false`, and a variant attached to THAT is now
   * refused, so every fixture below that buys a variant has to say so. Without this the
   * tests still pass but stop testing what they are named: an inactive-variant fixture on
   * a `has_variants: false` product is refused by the has_variants rule before the
   * is_active rule is ever reached.
   */
  const variantLine = (v: VariantRow, over: Partial<CartItemRow> = {}): CartItemRow =>
    line({ product: product({ has_variants: true }), variant: v, ...over });

  const price = (items: CartItemRow[], businessId = SELLER) =>
    priceCart({ businessId, items });

  it('REFUSES a variant that belongs to a different product — the ₱0.01 coat', () => {
    /** Real, active, in stock, priced at one cent — and attached to another product. */
    const decoy = variant({ id: 'var-decoy', product_id: 'prod-keyring', price_cents: 1 });

    // `has_variants: true`, so the ONLY thing wrong with this line is whose variant it is.
    // On a `has_variants: false` product the new rule below would refuse it first and this
    // test would stop covering the mismatch at all.
    const result = price([variantLine(decoy)]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rejection.status).toBe(400);
    // The coat's price must never have been reachable from this cart shape.
    expect(JSON.stringify(result)).not.toContain('"unit_price_cents":1');
  });

  it("REFUSES the product's OWN variant when that product declares it has none", () => {
    /**
     * The other direction, and the one migration 090 cannot close. Its composite
     * foreign key ties `(product_id, variant_id)` together — so it PERMITS this pair:
     * `var-stale` genuinely belongs to `prod-coat`. Only `has_variants` says the
     * listing does not sell from it.
     *
     * The screen is the other half of the hole. `app/product/[id].tsx` renders the
     * variant picker only when `product.has_variants` and takes `displayPrice` from
     * `base_price_cents` otherwise — so a buyer who writes `cart_items` herself (the
     * `cart_items_owner` policy authorises the cart, not its contents) pays ₱1.00 for
     * a listing every screen shows at ₱10,000.00, and `decrement_variant_stock` lands
     * on the stale row instead of the listing's real inventory.
     *
     * Latent today — nothing in `apps/studio` writes `product_variants` or
     * `has_variants` yet, so no seller can reach this state — and live the day a
     * variant editor ships. Seed 038 already puts a cheap tier beside paid ones.
     *
     * This test replaces one that built the decoy with `product_id: 'prod-keyring'`
     * and asserted against `prod-coat`: it passed on the mismatch check alone, so
     * deleting the `has_variants` rule entirely left it green.
     */
    const stale = variant({ id: 'var-stale', product_id: 'prod-coat', price_cents: 100 });

    const result = price([line({ product: product({ has_variants: false }), variant: stale })]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rejection.status).toBe(400);
    // ₱1.00 must never have been reachable from a ₱10,000.00 listing.
    expect(JSON.stringify(result)).not.toContain('"unit_price_cents":100');
  });

  it('still prices a product that declares no variants, and is sent none, at its base price', () => {
    // The companion to the rule above: refusing a variant on a `has_variants: false`
    // product must not also refuse the ordinary listing, which is most of the catalogue.
    const result = price([line({ product: product({ has_variants: false }), variant: null })]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.cart.lines[0].unit_price_cents).toBe(1_000_000);
    expect(result.cart.lines[0].variant_id).toBeNull();
    expect(result.cart.subtotalCents).toBe(1_000_000);
  });

  it('gives every unbuyable variant the same message — no oracle', () => {
    const mismatched = price([variantLine(variant({ product_id: 'prod-keyring' }))]);
    const inactive = price([variantLine(variant({ is_active: false }))]);
    const notSoldByVariant = price([line({ product: product({ has_variants: false }), variant: variant() })]);

    expect(mismatched.ok).toBe(false);
    expect(inactive.ok).toBe(false);
    expect(notSoldByVariant.ok).toBe(false);
    if (mismatched.ok || inactive.ok || notSoldByVariant.ok) throw new Error('unreachable');
    // A buyer must not be able to probe which variant ids belong to which product, and
    // the third case is the one that would leak it: a message naming `has_variants` would
    // confirm the variant IS this product's, which is exactly the mapping being denied.
    expect(mismatched.rejection.message).toBe(inactive.rejection.message);
    expect(notSoldByVariant.rejection.message).toBe(inactive.rejection.message);
  });

  it('REFUSES a product belonging to a seller other than the one being paid', () => {
    // `carts` is UNIQUE (buyer_id, business_id) and the PaymentIntent's destination
    // comes from the CART's business, so a foreign product in the basket pays the
    // wrong Stripe account for goods its owner never agreed to sell.
    const result = price([line({ product: product({ business_id: OTHER_SELLER }) })]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rejection.status).toBe(400);
  });

  it('prices a matching variant at the variant price', () => {
    const result = price([variantLine(variant())]);

    expect(result).toEqual({
      ok: true,
      cart: {
        subtotalCents: 1_200_000,
        lines: [{
          product_id: 'prod-coat',
          variant_id: 'var-coat-m',
          product_name: 'Handmade Coat',
          variant_label: 'M',
          unit_price_cents: 1_200_000,
          quantity: 1,
        }],
      },
    });
  });

  it('prices a variantless product at its base price, times quantity', () => {
    const result = price([line({ quantity: 3 })]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.cart.subtotalCents).toBe(3_000_000);
    expect(result.cart.lines[0].variant_id).toBeNull();
    expect(result.cart.lines[0].variant_label).toBeNull();
  });

  it('sums every line into the subtotal', () => {
    const result = price([
      line({ id: 'ci-1', quantity: 2 }),
      variantLine(variant({ price_cents: 500 }), { id: 'ci-2', quantity: 1 }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.cart.subtotalCents).toBe(2_000_500);
  });

  it('joins both option values into the variant label', () => {
    const result = price([variantLine(variant({ option2_name: 'Colour', option2_value: 'Rust' }))]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.cart.lines[0].variant_label).toBe('M / Rust');
  });

  it('refuses a line whose product row is gone, without naming the cart item to the buyer', () => {
    // Was `refuses a missing product` in the it.each below. Promoted so the message can be
    // asserted too: it used to be `Product not found for cart item ${item.id}`, putting an
    // internal uuid into a string the client renders verbatim. CLAUDE.md §11 and
    // `.claude/rules/react.md` both ban internal ids from client-visible errors — and the
    // id is genuinely useful for support, so it moves to the server log rather than away.
    const logged: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    try {
      const result = price([line({ id: 'ci-secret-uuid', product: null })]);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.rejection.message).not.toContain('ci-secret-uuid');
      // ...but the operator still gets it.
      expect(logged.join('\n')).toContain('ci-secret-uuid');
    } finally {
      spy.mockRestore();
    }
  });

  // Characterisation: rules index.ts already enforced, which must survive the move.
  it.each([
    ['an unapproved product', line({ product: product({ status: 'pending' }) })],
    ['an archived product', line({ product: product({ status: 'archived' }) })],
    ['an inactive product', line({ product: product({ is_active: false }) })],
    ['a variant-requiring product with no variant', line({ product: product({ has_variants: true }) })],
    ['an inactive variant', variantLine(variant({ is_active: false }))],
  ])('refuses %s', (_label, item) => {
    expect(price([item]).ok).toBe(false);
  });

  it('refuses an empty cart rather than pricing it at zero', () => {
    const result = price([]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rejection.status).toBe(400);
  });
});

/**
 * WHAT `openCheckout` DOES WITH THE PRICED CART — and why this block reads source text.
 *
 * `priceCart` is covered above. `openCheckout` is covered by nothing. The only
 * handler-level test, `supabase/functions/create-product-order/rateLimit.test.ts`, runs
 * with `SUBABASE_URL` on localhost so `DEV_MOCK` returns a stub body before `openCheckout`
 * is ever entered.
 *
 * Two properties of that function are what make everything asserted above actually reach
 * the buyer's card, and both currently rest on nothing:
 *
 *   1. the PaymentIntent metadata (`items_json`, which the webhook turns into order rows)
 *      is built from the PRICED lines, not from the raw `cart_items`;
 *   2. the stock-decrement loop iterates those same priced lines, so the units taken are
 *      always the units charged for. When a cart could hold a variant of another product,
 *      this loop decremented the DECOY — the item being bought never left stock and the
 *      attack ran again immediately.
 *
 * Restore `items.reduce(...)` for the subtotal or `for (const item of items)` for the
 * decrement and every one of the tests above stays green.
 *
 * These are STRUCTURAL assertions over `index.ts`, not behavioural ones, and they are the
 * strongest thing available from here: `openCheckout` is not exported, and `index.ts`
 * cannot be loaded by jest at all — it calls `Deno.serve` at module scope and imports
 * `npm:stripe@14` and `https://esm.sh/@supabase/supabase-js@2`. Making it callable means
 * extracting `openCheckout` into its own module with the Stripe and Supabase clients
 * injected, which is a change to `index.ts` and out of scope here.
 *
 * If you renamed `lines` or `itemsMeta`, this block will fail. Do not just update the
 * strings — check first that the property each one names still holds.
 */
describe('create-product-order openCheckout wiring', () => {
  const INDEX_TS = join(
    __dirname, '..', '..', '..', 'supabase', 'functions', 'create-product-order', 'index.ts',
  );
  const source = readFileSync(INDEX_TS, 'utf8');

  /** The `for (...)` header of whichever loop encloses the stock decrement. */
  const decrementLoopHeader = (): string => {
    const rpc = source.indexOf("supabase.rpc('decrement_variant_stock'");
    if (rpc === -1) throw new Error('decrement_variant_stock is not called from index.ts');
    const before = source.slice(0, rpc);
    const start = before.lastIndexOf('for (');
    if (start === -1) throw new Error('the stock decrement is not inside a loop');
    return before.slice(start, before.indexOf('\n', start)).trim();
  };

  it('takes the subtotal from priceCart, not from the raw cart rows', () => {
    expect(source).toContain('const { lines, subtotalCents } = priced.cart;');
    expect(source).toContain('const totalCents = subtotalCents + SHIPPING_COST_CENTS;');
    expect(source).toContain('amount: totalCents,');
    // The shape it used to have, and must never have again.
    expect(source).not.toMatch(/\bitems\.reduce\(/);
  });

  it('writes the PRICED lines into the intent metadata the webhook reads back', () => {
    const assignment = /const\s+itemsMeta\s*=\s*([^;]+);/.exec(source);
    expect(assignment).not.toBeNull();
    expect(assignment?.[1].trim()).toBe('lines');
    expect(source).toContain('items_json: JSON.stringify(itemsMeta)');
  });

  it('decrements stock per PRICED line, so units taken equal units charged', () => {
    const header = decrementLoopHeader();
    // Binding name is free; the collection it iterates is not.
    expect(header).toMatch(/^for \(const \w+ of lines\)/);

    const loopVar = /^for \(const (\w+) of lines\)/.exec(header)?.[1];
    expect(loopVar).toBeDefined();
    expect(source).toContain(`p_variant_id: ${loopVar}.variant_id`);
    expect(source).toContain(`p_qty: ${loopVar}.quantity`);
  });

  it('never reaches back into the unvalidated cart rows', () => {
    // `items` survives only as the emptiness check and the argument to priceCart. Any
    // read of a cart row's own product/variant/quantity outside priceCart is the gap
    // this whole file exists to keep closed.
    expect(source).not.toMatch(/for \(const \w+ of items\)/);
    expect(source).not.toMatch(/\bitem\.(variant|product|quantity)\b/);
    expect(source).toContain('priceCart({ businessId: business.id, items })');
  });
});
