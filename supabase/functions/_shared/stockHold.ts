// supabase/functions/_shared/stockHold.ts
import type Stripe from 'npm:stripe@14';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * The stock reservation both create-product-order and stripe-product-webhook operate on.
 * The full rationale for reserving at checkout — and for keeping the reservation on the
 * PaymentIntent rather than in a table — lives at the top of create-product-order.
 *
 * The reservation is one metadata key on the intent that already represents the
 * checkout attempt. Stripe merges metadata key by key on update, so writing this key
 * leaves the checkout snapshot (items_json, buyer_id, cart_id, shipping_*) intact.
 * src: https://docs.stripe.com/api/payment_intents/update · stripe-node 14.25.0 · 2026-08-05
 */
export const HOLD_KEY = 'stock_held';

/**
 * held     — units are out of `product_variants.stock` and must come back if the intent dies.
 * released — units already returned; returning them again invents stock the seller lacks.
 * sold     — payment succeeded, so the decrement IS the sale. Never returned.
 */
export type HoldState = 'held' | 'released' | 'sold';

/** How long an IDLE checkout may sit on reserved stock before a sweep reaps the hold. */
export const HOLD_WINDOW_MINUTES = 30;

/**
 * How long a checkout the buyer is actively paying through may sit on reserved stock.
 *
 * The sweep used to reap on `created < cutoff` alone — intent AGE, not idle time. A buyer
 * 35 minutes into a 3DS challenge (banking-app hop, SMS that takes its time, a card that
 * wants a call) had her live intent cancelled out from under her by an unrelated buyer's
 * checkout, and `cancelAndRelease`'s "Stripe refuses to cancel" safety net does not save
 * her: `requires_action` is perfectly cancellable. Age cannot tell "walked away" from
 * "still paying"; status can, so the two get different clocks.
 *
 * Generous, but not infinite: a challenge nobody came back to still has to give the units
 * up, or an app killed mid-3DS parks them forever.
 */
export const IN_FLIGHT_GRACE_MINUTES = 90;

/** Stale holds inspected per sweep. One Search page is plenty at this marketplace's volume. */
const SWEEP_LIMIT = 20;

/** One page of a buyer's own recent intents — far more than a real shopper opens in 90 minutes. */
const LIST_LIMIT = 100;

/** The buyer is mid-payment: a payment method is attached and the processor is engaged. */
const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(['requires_confirmation', 'requires_action']);

/**
 * Statuses in which a hold is still reserving stock for a checkout that could still be
 * paid. `succeeded` and `requires_capture` are the sale itself, `canceled` is over — none
 * of the three should stand between this buyer and her next basket.
 */
const LIVE_STATUSES: ReadonlySet<string> = new Set([
  'requires_payment_method', 'requires_confirmation', 'requires_action', 'processing',
]);

interface HeldLine {
  variant_id: string | null;
  quantity: number;
}

/** The conflicting checkout, and how long until a sweep would free it. */
export interface ConflictingHold {
  paymentIntentId: string;
  retryAfterSeconds: number;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The reservation state on an intent, or null if it never carried one. */
export function holdState(pi: Stripe.PaymentIntent): HoldState | null {
  const raw = pi.metadata?.[HOLD_KEY];
  return raw === 'held' || raw === 'released' || raw === 'sold' ? raw : null;
}

/**
 * The lines whose units this intent is holding, read back from the price snapshot the
 * checkout wrote. Malformed metadata releases nothing rather than throwing — a hold we
 * cannot read is a hold we must not guess at.
 */
function heldLines(pi: Stripe.PaymentIntent): HeldLine[] {
  const raw = pi.metadata?.items_json;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((line: unknown): line is HeldLine => {
      if (typeof line !== 'object' || line === null) return false;
      const candidate = line as Partial<HeldLine>;
      return typeof candidate.quantity === 'number'
        && (typeof candidate.variant_id === 'string' || candidate.variant_id === null);
    });
  } catch {
    return [];
  }
}

/**
 * When a sweep may take this hold back, or null if age must never decide.
 *
 * `processing` and `requires_capture` belong to the processor — an answer is coming and
 * the webhook resolves the hold. `succeeded` is the sale. `canceled` is handled directly,
 * with no clock at all: Stripe has already confirmed the units can never be paid for.
 */
function reapableAt(pi: Stripe.PaymentIntent): number | null {
  if (pi.status === 'requires_payment_method') return pi.created + HOLD_WINDOW_MINUTES * 60;
  if (IN_FLIGHT_STATUSES.has(pi.status)) return pi.created + IN_FLIGHT_GRACE_MINUTES * 60;
  return null;
}

/** Whether a sweep is free to cancel this intent and hand its units back. */
export function isReapable(pi: Stripe.PaymentIntent, nowSeconds: number): boolean {
  const at = reapableAt(pi);
  return at !== null && nowSeconds >= at;
}

/** Records the reservation state on the intent. */
export async function markHold(
  stripe: Stripe,
  paymentIntentId: string,
  state: HoldState
): Promise<void> {
  await stripe.paymentIntents.update(paymentIntentId, { metadata: { [HOLD_KEY]: state } });
}

/**
 * Returns the units this intent is holding, at most once.
 *
 * The caller must already know the intent can never be paid — either Stripe reported it
 * canceled, or `cancelAndRelease` below got Stripe to cancel it.
 *
 * The state flag is claimed BEFORE any stock moves. If that write fails nothing has
 * moved and the next sweep retries cleanly; if it succeeds, no other worker can release
 * the same units. Incrementing first would let a crash mid-loop re-run the increments
 * on the next pass and invent stock — and overselling costs a real buyer real money,
 * while a leak only costs the seller a manual re-stock.
 */
export async function releaseHold(
  stripe: Stripe,
  supabase: SupabaseClient,
  pi: Stripe.PaymentIntent
): Promise<boolean> {
  if (holdState(pi) !== 'held') return false;

  try {
    await markHold(stripe, pi.id, 'released');
  } catch (err) {
    console.error(`[stockHold] could not claim release for ${pi.id}: ${describe(err)}`);
    return false;
  }

  for (const line of heldLines(pi)) {
    if (line.variant_id === null) continue;
    const { error } = await supabase.rpc('increment_variant_stock', {
      p_variant_id: line.variant_id,
      p_qty: line.quantity,
    });
    if (error) {
      // Claimed but not returned. Loud, because these units are now invisible to the
      // reaper and only a seller edit puts them back.
      console.error(
        `[stockHold] stock NOT returned for variant ${line.variant_id} on ${pi.id}: ${error.message}`
      );
    }
  }

  return true;
}

/**
 * Kills the intent, then returns its units.
 *
 * Cancel first, release second, always. Stripe refuses to cancel an intent that has
 * succeeded or is already canceled, so a successful cancel is the processor's own
 * confirmation that these units can never be paid for. That ordering is what makes the
 * sweep safe despite Search filtering on a cached status.
 * src: https://docs.stripe.com/api/payment_intents/cancel · stripe-node 14.25.0 · 2026-08-05
 */
export async function cancelAndRelease(
  stripe: Stripe,
  supabase: SupabaseClient,
  pi: Stripe.PaymentIntent
): Promise<boolean> {
  if (holdState(pi) !== 'held') return false;

  let canceled: Stripe.PaymentIntent;
  try {
    canceled = await stripe.paymentIntents.cancel(pi.id, { cancellation_reason: 'abandoned' });
  } catch (err) {
    // Paid, already canceled, or mid-authorisation. Not ours to take back — leave the
    // hold standing and let the succeeded/canceled webhook resolve it.
    console.error(`[stockHold] hold left intact, ${pi.id} not cancellable: ${describe(err)}`);
    return false;
  }

  return await releaseHold(stripe, supabase, canceled);
}

/**
 * Reaps holds nobody is coming back for, platform-wide.
 *
 * Age gets an intent onto the list; `isReapable` decides whether it actually goes. The
 * query can only ask for `created<cutoff`, and Stripe forbids mixing AND with OR in one
 * search, so the status rule cannot live in the query and is applied per row instead.
 * src: https://docs.stripe.com/search#search-query-language · 2026-08-07
 *
 * Search filters on a cached copy of the intent but returns the current object, so the
 * `holdState` and status re-checks here see fresh data even when the index is behind —
 * and the cancel gate stops a since-succeeded intent from being released.
 * src: https://docs.stripe.com/search#data-mismatches · 2026-08-05
 *
 * Never throws: a sweep is housekeeping and must not fail a buyer's checkout.
 */
export async function sweepAbandonedHolds(
  stripe: Stripe,
  supabase: SupabaseClient,
  nowSeconds?: number
): Promise<number> {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const cutoff = now - HOLD_WINDOW_MINUTES * 60;
  try {
    const stale = await stripe.paymentIntents.search({
      query: `metadata["${HOLD_KEY}"]:"held" AND created<${cutoff}`,
      limit: SWEEP_LIMIT,
    });
    let released = 0;
    for (const pi of stale.data) {
      if (holdState(pi) !== 'held') continue;

      // Terminal, so there is nothing to cancel and no clock to wait out. Routing this
      // through cancelAndRelease would throw on the cancel and leave the hold standing —
      // which is exactly what happens today to any intent whose
      // `payment_intent.canceled` webhook was never enabled or never delivered. Reaping
      // it here is what stops the sweep depending on that webhook at all.
      if (pi.status === 'canceled') {
        if (await releaseHold(stripe, supabase, pi)) released++;
        continue;
      }

      if (!isReapable(pi, now)) continue;
      if (await cancelAndRelease(stripe, supabase, pi)) released++;
    }
    return released;
  } catch (err) {
    console.error(`[stockHold] sweep failed: ${describe(err)}`);
    return 0;
  }
}

/**
 * This buyer's own recent intents, newest first, or null if Stripe could not be reached.
 *
 * `list`, deliberately not `search`. Search filters on an index that is up to a minute
 * behind ("Don't use search for read-after-write flows... data is searchable in under 1
 * minute"), so a burst of checkouts fired seconds apart would each search and each see
 * nothing — the exact case a concurrency cap exists to catch. The list APIs are the
 * documented answer for read-after-write, and scoping by customer keeps it to one page.
 * src: https://docs.stripe.com/search#data-freshness · stripe-node 14.25.0 · 2026-08-07
 */
async function recentIntentsFor(
  stripe: Stripe,
  customerId: string,
  createdSince: number
): Promise<Stripe.PaymentIntent[] | null> {
  try {
    const page = await stripe.paymentIntents.list({
      customer: customerId,
      created: { gte: createdSince },
      limit: LIST_LIMIT,
    });
    return page.data;
  } catch (err) {
    console.error(`[stockHold] concurrency check skipped: ${describe(err)}`);
    return null;
  }
}

/**
 * The live hold, if any, that should stop this buyer opening another checkout.
 *
 * A daily rate limit bounds how many checkouts one member may open; this bounds how much
 * stock she may have reserved at any one instant. Without it she can still open her daily
 * maximum, never release a single one, and — on a marketplace of one-of-a-kind handmade
 * items — leave every product she touched reading "out of stock" for the full window.
 *
 * Three things deliberately do NOT conflict:
 *   same key       Replaying an idempotency key is how this function hands a buyer back
 *                  her own client_secret after an app reload. Refusing that would lock
 *                  her out of the checkout she is already paying for.
 *   reapable holds A hold the sweep may already take back is not stock she is holding in
 *                  any meaningful sense; the next checkout frees it.
 *   another buyer  Belt and braces against a customer record shared by a bug: identity
 *                  comes from the JWT, and the intent must agree.
 *
 * THE EXEMPTION IS THE IDEMPOTENCY KEY, NEVER THE CART. This used to compare
 * `cart_id`, which reads like the same rule and is not: `carts` is
 * UNIQUE (buyer_id, business_id), so a buyer has exactly ONE cart id per seller and it
 * never changes, while `newIdempotencyKey()` mints a fresh key on every Pay press. The
 * cap was therefore exempted by the one value every attempt shares — she could check out
 * cart C, rewrite C's rows (hers to write under the `cart_items_owner` policy), check out
 * C again, and open a second hold that the cap skipped. Repeat to the daily limit: twenty
 * live holds, all exempt. It also misfired for the honest buyer whose release never fired,
 * who sailed past the cap into the decrement and was told "…is out of stock" about stock
 * her own abandoned intent was holding.
 *
 * An intent with no `idempotency_key` in metadata can never match, so it always counts
 * against the cap. That is the safe direction: a false 409 costs a buyer a short wait,
 * while a false exemption is the hold farm above.
 *
 * Fails OPEN. A Stripe outage must not stop the marketplace selling, and the daily limit
 * is the backstop that still bounds abuse while this check is blind.
 */
export async function findConflictingHold(
  stripe: Stripe,
  params: { customerId: string; buyerId: string; idempotencyKey: string; nowSeconds?: number }
): Promise<ConflictingHold | null> {
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);

  // Nothing older than the longest grace can still be unreapable, so nothing older can conflict.
  const intents = await recentIntentsFor(stripe, params.customerId, now - IN_FLIGHT_GRACE_MINUTES * 60);
  if (intents === null) return null;

  for (const pi of intents) {
    if (holdState(pi) !== 'held') continue;
    if (pi.metadata?.buyer_id !== params.buyerId) continue;
    if (pi.metadata?.idempotency_key === params.idempotencyKey) continue;
    if (!LIVE_STATUSES.has(pi.status)) continue;
    if (isReapable(pi, now)) continue;

    const at = reapableAt(pi);
    return {
      paymentIntentId: pi.id,
      // `processing` has no age clock — the processor answers in seconds and the webhook
      // resolves it, so quote the ordinary window rather than an honest "unknown".
      retryAfterSeconds: at === null ? HOLD_WINDOW_MINUTES * 60 : Math.max(0, at - now),
    };
  }

  return null;
}
