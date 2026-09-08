// supabase/functions/create-product-order/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import {
  HOLD_WINDOW_MINUTES, cancelAndRelease, findConflictingHold, holdState, markHold, sweepAbandonedHolds,
} from '../_shared/stockHold.ts';
import {
  SHIPPING_COST_CENTS, asCheckoutRequest, asString, priceCart,
  type CartItemRow, type CheckoutRequest,
} from './checkout.ts';
import Stripe from 'npm:stripe@14';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

/**
 * STOCK RESERVATION — why the hold is taken where it is, and given back where it is
 *
 * The only real decision is when a unit leaves `product_variants.stock`:
 *
 *   (a) At checkout, before payment. Cannot oversell — but every abandoned checkout
 *       parks that unit indefinitely. On a marketplace whose sellers list one handmade
 *       item, a single shopper who opens the sheet and walks away makes the product
 *       unbuyable for everyone, forever. This is what this function used to do: it
 *       decremented, and only `payment_intent.payment_failed` ever handed the unit back.
 *   (b) At `payment_intent.succeeded`, in the webhook. Nothing can leak — but two
 *       buyers can both pay for the last unit and one of them gets refunded after the
 *       fact. Taking money for a thing that does not exist is the worse failure: it
 *       costs a real buyer real money and costs the seller the relationship, and the
 *       webhook could not even fail safely (increment_variant_stock is unconditional,
 *       so a lost race lands on negative stock).
 *   (c) At checkout, with an expiry that something reaps. (a)'s safety with (a)'s leak
 *       bounded. Chosen.
 *
 * The textbook shape of (c) is a `stock_reservations` table with `expires_at` plus a
 * pg_cron reaper. That needs a migration, so the reservation instead lives on the object
 * that already has exactly one row per checkout attempt and is already the system of
 * record for whether the payment can still happen — the PaymentIntent, under
 * `metadata.stock_held` (held → sold | released). Stripe's state machine then does the
 * hard part: it refuses to cancel an intent that has succeeded, so a successful cancel
 * is the processor's own proof that those units can never be paid for, and only then
 * are they returned. See `_shared/stockHold.ts`.
 *
 * All four release paths:
 *   success       `payment_intent.succeeded` flips the hold to `sold`. The decrement
 *                 becomes the sale and is never handed back.
 *   card declined Nothing happens, deliberately. A declined attempt leaves the intent
 *                 retryable, so the hold has to survive it. Releasing here — what the
 *                 webhook used to do — oversells: decline → +1 → the buyer retries the
 *                 same intent with another card → succeeds → the unit ships but was
 *                 never decremented.
 *   cancellation  `payment_intent.canceled` returns the units, exactly once.
 *   abandonment   The buyer's own client reports the sheet closing (the release branch
 *                 below), and for the cases with no client left to report — app killed,
 *                 radio dropped — every checkout first sweeps platform-wide holds older
 *                 than HOLD_WINDOW_MINUTES.
 *
 * Accepted residual: a crash in the window between the decrement landing and the
 * `stock_held=held` write leaks those units with no marker. That window is milliseconds
 * wide against the unbounded one it replaces, and it fails toward leaking rather than
 * toward inventing stock. Writing the flag first would invert exactly that.
 *
 * Known gap, needs a migration so out of scope here: a pg_cron sweep, so a leaked hold
 * is reaped on a clock rather than on the next checkout. Until then a seller whose only
 * product is held hostage reads as sold out in the product list until some other
 * checkout, anywhere on the platform, runs the sweep.
 */

// The cart row shapes, the rules that validate them and the subtotal that comes out
// live in ./checkout.ts — free of Deno, Stripe and Supabase imports so the jest suite
// in apps/mobile can assert the money instead of reasoning about it.

interface BusinessRow {
  id: string;
  stripe_account_id: string | null;
  can_sell: boolean;
  payout_schedule_set: boolean;
  currency: string | null;
}

interface CartRow {
  id: string;
  buyer_id: string;
  business_id: string;
  expires_at: string;
  cart_items: CartItemRow[] | null;
  business: BusinessRow | null;
}

const FN_NAME = 'create-product-order';

/**
 * Postgres names the offending key in its error text, so a failed ai_call_log insert can
 * carry the buyer's user_id into the log line. The alarm is worth keeping — a counter that
 * stops incrementing silently disarms the rate limit below — but not at the cost of a
 * user id in plaintext.
 */
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Checkout attempts one member may open per day.
 *
 * Every attempt opens a PaymentIntent and takes stock out of `product_variants.stock`, so
 * an unlimited endpoint is an unlimited inventory weapon: one member could hold every
 * product on the platform at "out of stock" for free. This function shipped with no limit
 * at all while the other twelve authenticated functions all take one.
 *
 * 20 is roughly four times what the busiest honest shopper does. Carts here are scoped to
 * one business, so a real buyer ordering from three sellers in a day opens three checkouts,
 * plus abandonments and a re-open after changing an address — call it five. A retry of the
 * same basket replays its idempotency key and is handed the same intent, so declines do not
 * multiply attempts.
 *
 * It also sits below what the concurrency cap alone would allow: at one live hold per buyer
 * and a 30-minute window, a day holds 48 windows. The daily cap is the burst ceiling, the
 * concurrency cap is the binding constraint, and neither is load-bearing on its own.
 */
export const CHECKOUT_ATTEMPTS_PER_DAY = 20;

/** Statuses in which an intent can still be paid, so its stock hold is still meaningful. */
const PAYABLE_STATUSES = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stripeClient(): Stripe | null {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
}

/**
 * The buyer's own abandonment signal. Cheaper and far faster than waiting for the
 * sweep, and the common case by a wide margin: most abandoned checkouts are a person
 * closing a sheet on a phone that is still online.
 */
async function releaseAbandoned(
  stripe: Stripe,
  supabase: SupabaseClient,
  userId: string,
  paymentIntentId: string
): Promise<Response> {
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return errorResponse('Payment not found', 404);
  }

  // The same 404 for "no such intent" and "not yours": a buyer must not be able to probe
  // for other people's payment ids, let alone cancel them.
  if (intent.metadata?.buyer_id !== userId) return errorResponse('Payment not found', 404);

  const released = await cancelAndRelease(stripe, supabase, intent);
  return successResponse({ released });
}

async function openCheckout(
  stripe: Stripe,
  supabase: SupabaseClient,
  userId: string,
  request: CheckoutRequest
): Promise<Response> {
  const { cartId, shipping, idempotencyKey } = request;

  // 1. Load cart + items + products + variants
  const { data: cartData, error: cartErr } = await supabase
    .from('carts')
    .select(`
      id, buyer_id, business_id, expires_at,
      cart_items (
        id, quantity,
        product:products ( id, name, status, is_active, has_variants, base_price_cents, business_id ),
        variant:product_variants ( id, product_id, price_cents, stock, is_active, option1_name, option1_value, option2_name, option2_value )
      ),
      business:businesses ( id, stripe_account_id, can_sell, payout_schedule_set, currency )
    `)
    .eq('id', cartId)
    .eq('buyer_id', userId)
    .maybeSingle();

  if (cartErr || !cartData) return errorResponse('Cart not found', 404);
  const cart = cartData as unknown as CartRow;
  if (new Date(cart.expires_at) < new Date()) return errorResponse('Cart has expired', 400);

  const items = cart.cart_items ?? [];
  if (items.length === 0) return errorResponse('Cart is empty', 400);

  const business = cart.business;
  if (!business) return errorResponse('Cart not found', 404);
  if (!business.can_sell) return errorResponse('Business is not approved to sell', 403);
  if (!business.stripe_account_id) return errorResponse('Business has no Stripe account', 403);
  if (!business.payout_schedule_set) return errorResponse('Business payout schedule not configured', 403);
  const destinationAccount = business.stripe_account_id;

  // 2. Validate the cart AND price it, in that one step. The rules and the subtotal are
  //    the same expression so a line can never be priced by a rule that did not pass it —
  //    the gap a mismatched variant used to walk through. `business.id` is the account
  //    that gets paid, so it is what every product in the basket must belong to.
  const priced = priceCart({ businessId: business.id, items });
  if (!priced.ok) return errorResponse(priced.rejection.message, priced.rejection.status);
  const { lines, subtotalCents } = priced.cart;

  // 3. Ensure a Stripe customer, and reap abandoned holds while that round trip is in
  //    flight. The freed units have to be back in stock before this buyer's own
  //    decrement runs, and paying for the sweep in wall-clock time would tax every
  //    checkout for a housekeeping job.
  const ensureCustomer = async (): Promise<string> => {
    const existing = (
      await supabase.from('profiles').select('stripe_customer_id').eq('id', userId).single()
    ).data?.stripe_customer_id;
    if (typeof existing === 'string' && existing.length > 0) return existing;

    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    const customer = await stripe.customers.create({
      email: user?.email,
      metadata: { roxy_user_id: userId },
    });
    await supabase.from('profiles').update({ stripe_customer_id: customer.id }).eq('id', userId);
    return customer.id;
  };

  let stripeCustomerId: string;
  try {
    [stripeCustomerId] = await Promise.all([ensureCustomer(), sweepAbandonedHolds(stripe, supabase)]);
  } catch (err) {
    return errorResponse(`Stripe error: ${describe(err)}`, 500);
  }

  // 3b. One live hold per buyer, checked after the sweep has had its chance to free
  //     whatever it could and before a single unit moves. The daily limit caps how many
  //     checkouts she may open; this caps how much stock she may sit on at once. Without
  //     it she can open the daily maximum, release none of them, and leave every product
  //     she touched reading "out of stock" for the whole window.
  //
  //     Keyed on the idempotency key, NEVER on cartId: `carts` is
  //     UNIQUE (buyer_id, business_id), so the cart id is stable per seller for the life
  //     of the account and would exempt every attempt she ever makes. See findConflictingHold.
  const conflict = await findConflictingHold(stripe, {
    customerId: stripeCustomerId,
    buyerId: userId,
    idempotencyKey,
  });
  if (conflict !== null) {
    const minutes = Math.max(1, Math.ceil(conflict.retryAfterSeconds / 60));
    return errorResponse(
      `You already have a checkout open. Finish it, or close it and try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      409,
    );
  }

  // 4. Calculate totals. The subtotal came out of priceCart above, so it is the sum of
  //    prices the SELLER set on rows that passed validation.
  const { data: settings } = await supabase.from('marketplace_settings').select('product_fee_percent').single();
  const feePercent = Number(settings?.product_fee_percent ?? 10);
  const platformFeeCents = Math.floor(subtotalCents * (feePercent / 100));
  // No term here is client-supplied. The fee comes from marketplace_settings and the
  // shipping from a constant; the subtotal comes from the cart rows, which the buyer DOES
  // author (cart_items is written from the client under the `cart_items_owner` policy) —
  // so "server-derived" is earned by priceCart refusing every row shape that would let her
  // choose a price, not by the rows being trustworthy. Migration 090's composite foreign
  // key is what makes the mismatched pair unrepresentable at rest.
  // See SHIPPING_COST_CENTS in ./checkout.ts before changing the shipping term.
  const totalCents = subtotalCents + SHIPPING_COST_CENTS;

  // 5. Price snapshots for the webhook. This is also what a hold is read back from when
  //    it is released, so it has to carry variant_id and quantity for every line.
  const itemsMeta = lines;

  // 6. Open the PaymentIntent BEFORE taking stock. Every decremented unit is then
  //    attached to an intent whose lifecycle emits the events that give it back. The old
  //    order decremented first, so a throw from any call between the decrement and the
  //    intent — the customer lookup, the fee read — left units held by nothing at all,
  //    with no webhook that could ever fire to release them.
  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: business.currency ?? 'usd',
        customer: stripeCustomerId,
        application_fee_amount: platformFeeCents,
        transfer_data: { destination: destinationAccount },
        on_behalf_of: destinationAccount,
        automatic_payment_methods: { enabled: true },
        metadata: {
          buyer_id: userId,
          business_id: business.id,
          cart_id: cartId,
          idempotency_key: idempotencyKey,
          items_json: JSON.stringify(itemsMeta),
          subtotal_cents: String(subtotalCents),
          shipping_cost_cents: String(SHIPPING_COST_CENTS),
          platform_fee_cents: String(platformFeeCents),
          shipping_name: shipping.name,
          shipping_line1: shipping.line1,
          shipping_line2: shipping.line2 ?? '',
          shipping_city: shipping.city,
          shipping_state: shipping.state,
          shipping_postal_code: shipping.postal_code,
          shipping_country: shipping.country,
        },
      },
      { idempotencyKey }
    );
  } catch (err) {
    return errorResponse(`Stripe error: ${describe(err)}`, 500);
  }

  // A replayed idempotency key hands back the intent already opened for this basket, and
  // its units were taken on the first call — taking them again sells one purchase's worth
  // of stock twice over. The hold flag decides, but it has to be read back rather than
  // read off the create: "Stripe's idempotency works by saving the resulting status code
  // and body of the first request", so a replayed create returns the original body, from
  // before the hold was recorded, no matter what the intent looks like now.
  // src: https://docs.stripe.com/api/idempotent_requests · 2026-08-05
  let currentIntent: Stripe.PaymentIntent;
  try {
    currentIntent = await stripe.paymentIntents.retrieve(paymentIntent.id);
  } catch (err) {
    return errorResponse(`Stripe error: ${describe(err)}`, 500);
  }

  if (holdState(currentIntent) === null) {
    if (!PAYABLE_STATUSES.has(currentIntent.status)) {
      // Replay against an intent that already finished or was cancelled. No stock was
      // ever attached to it and none should be now.
      return errorResponse('This checkout has already been completed. Please start a new one.', 409);
    }

    const taken: Array<{ variantId: string; qty: number }> = [];
    let failure: string | null = null;

    // Iterates the PRICED lines, not the raw cart rows, so the units taken are always the
    // units charged for. When a cart could hold a variant belonging to another product,
    // this loop decremented that decoy — the item actually being bought never left stock,
    // so the same attack ran again immediately, and the seller's real inventory never moved.
    for (const line of lines) {
      if (line.variant_id === null) continue;
      const { data: updated, error: stockErr } = await supabase.rpc('decrement_variant_stock', {
        p_variant_id: line.variant_id,
        p_qty: line.quantity,
      });
      if (stockErr || !updated) {
        failure = `"${line.product_name}" is out of stock`;
        break;
      }
      taken.push({ variantId: line.variant_id, qty: line.quantity });
    }

    // 7. Record the hold before the secret goes back to the buyer. A failure here has to
    //    unwind the decrements too: units a buyer can pay for but the reaper cannot see
    //    are the exact leak this design exists to remove.
    if (failure === null) {
      try {
        await markHold(stripe, paymentIntent.id, 'held');
      } catch (err) {
        failure = 'We could not reserve these items. Please try again.';
        console.error(`[create-product-order] hold not recorded for ${paymentIntent.id}: ${describe(err)}`);
      }
    }

    if (failure !== null) {
      for (const unit of taken) {
        await supabase.rpc('increment_variant_stock', { p_variant_id: unit.variantId, p_qty: unit.qty });
      }
      // Cancel rather than walk away: an open intent is a client secret the buyer could
      // still pay against, for stock that has just gone back on the shelf for someone else.
      try {
        await stripe.paymentIntents.cancel(paymentIntent.id, { cancellation_reason: 'abandoned' });
      } catch (err) {
        console.error(`[create-product-order] could not cancel ${paymentIntent.id}: ${describe(err)}`);
      }
      return errorResponse(failure, 409);
    }
  }

  return successResponse({
    client_secret: paymentIntent.client_secret,
    payment_intent_id: paymentIntent.id,
    hold_expires_in_minutes: HOLD_WINDOW_MINUTES,
  });
}

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Two shapes on one route: open a payment, or hand back a payment the buyer walked
  // away from. The release lives here rather than in its own function because it is the
  // exact inverse of this operation and must never drift from how the hold is taken.
  const releaseIntentId = asString(body.release_payment_intent_id);

  if (releaseIntentId !== null) {
    if (DEV_MOCK) return successResponse({ released: false });
    const stripe = stripeClient();
    if (stripe === null) return errorResponse('STRIPE_SECRET_KEY not set', 500);
    return await releaseAbandoned(stripe, getSupabaseClient(), userId, releaseIntentId);
  }

  const checkout = asCheckoutRequest(body);
  if (checkout === null) {
    return errorResponse('Missing required fields: cart_id, shipping_address, idempotency_key', 400);
  }

  // Rate limit before anything can move stock, and before the DEV_MOCK return so the limit
  // is exercised in development too (CLAUDE.md section 7). The release branch above is
  // deliberately left unlimited: a buyer who has hit her cap must still be able to hand
  // stock back, and refusing that would keep her holds standing for the full window.
  // One statement, because the pair this replaces could be — and in six functions
  // was — half-used. The comment that stood here noted that this function's cap
  // worked ONLY because the line below it remembered to log, and named the six
  // that forgot. Remembering is no longer part of it: the write is the count.
  //
  // 'deny' on limiter failure. This opens a Stripe PaymentIntent and moves
  // stock; an uncapped checkout path during a database outage is exactly what
  // the cap is for, and she can retry in a moment.
  const { allowed } = await consumeRateLimit({
    userId,
    fnName: FN_NAME,
    maxCount: CHECKOUT_ATTEMPTS_PER_DAY,
    windowType: 'daily',
    wasMock: DEV_MOCK,
    onLimiterFailure: 'deny',
  });
  if (!allowed) {
    return errorResponse('Too many checkout attempts today — please try again tomorrow', 429);
  }

  if (DEV_MOCK) {
    return successResponse({
      client_secret: 'pi_mock_secret_test',
      payment_intent_id: 'pi_mock',
      order_id: 'mock-order-id',
    });
  }

  const stripe = stripeClient();
  if (stripe === null) return errorResponse('STRIPE_SECRET_KEY not set', 500);
  return await openCheckout(stripe, getSupabaseClient(), userId, checkout);
});
