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

/** How long a buyer may sit on reserved stock before another checkout reaps the hold. */
export const HOLD_WINDOW_MINUTES = 30;

/** Stale holds inspected per sweep. One Search page is plenty at this marketplace's volume. */
const SWEEP_LIMIT = 20;

interface HeldLine {
  variant_id: string | null;
  quantity: number;
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
 * Search filters on a cached copy of the intent but returns the current object, so the
 * `holdState` re-check inside cancelAndRelease sees fresh metadata even when the index
 * is behind — and the cancel gate stops a since-succeeded intent from being released.
 * src: https://docs.stripe.com/search#data-mismatches · 2026-08-05
 *
 * Never throws: a sweep is housekeeping and must not fail a buyer's checkout.
 */
export async function sweepAbandonedHolds(
  stripe: Stripe,
  supabase: SupabaseClient
): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - HOLD_WINDOW_MINUTES * 60;
  try {
    const stale = await stripe.paymentIntents.search({
      query: `metadata["${HOLD_KEY}"]:"held" AND created<${cutoff}`,
      limit: SWEEP_LIMIT,
    });
    let released = 0;
    for (const pi of stale.data) {
      if (await cancelAndRelease(stripe, supabase, pi)) released++;
    }
    return released;
  } catch (err) {
    console.error(`[stockHold] sweep failed: ${describe(err)}`);
    return 0;
  }
}
