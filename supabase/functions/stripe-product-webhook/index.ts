// supabase/functions/stripe-product-webhook/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { markHold, releaseHold } from '../_shared/stockHold.ts';
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
const webhookSecret = Deno.env.get('STRIPE_PRODUCT_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) return errorResponse('Missing Stripe-Signature', 400);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
  } catch (err) {
    return errorResponse(`Signature verification failed: ${err}`, 400);
  }

  const supabase = getSupabaseClient();

  // Idempotency check
  const { data: existing } = await supabase
    .from('webhook_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle();

  if (existing) return successResponse({ received: true, skipped: true });

  // Record event first
  await supabase.from('webhook_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    status: 'processed',
  });

  // Set when the handler completed the money-moving part but left something a
  // human has to repair. Reported in the body; see the return at the end for why
  // it is not a status code.
  let degraded: string | null = null;

  try {
    switch (event.type) {

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const meta = pi.metadata;

        // Guard: only handle marketplace payments (have our metadata)
        if (!meta?.buyer_id || !meta?.items_json) break;

        // The stock this intent was holding is now the sale. Flipped before anything
        // else, and before the already-created short-circuit below, because it is true
        // the moment payment lands regardless of what happens to the order row.
        // Non-fatal: Stripe refuses to cancel a succeeded intent, so even a failed flip
        // leaves the reaper unable to hand these units back.
        try {
          await markHold(stripe, pi.id, 'sold');
        } catch (err) {
          console.error(`[stripe-product-webhook] could not mark ${pi.id} sold:`, err instanceof Error ? err.message : String(err));
        }

        // Idempotency: order may already exist if webhook retried
        const { data: existingOrder } = await supabase
          .from('orders')
          .select('id')
          .eq('stripe_payment_intent_id', pi.id)
          .maybeSingle();
        if (existingOrder) break;

        // Get charge details from Stripe (fresh, not from event payload)
        const charges = await stripe.charges.list({ payment_intent: pi.id, limit: 1 });
        const charge = charges.data[0];
        const transferId = typeof charge?.transfer === 'string' ? charge.transfer : charge?.transfer?.id;

        // Create Stripe invoice for buyer receipt
        let invoiceId: string | null = null;
        let invoiceUrl: string | null = null;
        try {
          const invoice = await stripe.invoices.create({
            customer: pi.customer as string,
            auto_advance: true,
            metadata: { payment_intent_id: pi.id },
          });
          const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
          invoiceId = finalized.id;
          invoiceUrl = finalized.hosted_invoice_url ?? null;
        } catch {
          // Invoice creation failure is non-fatal — order still created
        }

        const items: Array<{
          product_id: string; variant_id: string | null;
          product_name: string; variant_label: string | null;
          unit_price_cents: number; quantity: number;
        }> = JSON.parse(meta.items_json);

        // Migration 032 calls these columns "populated from Stripe webhook, never
        // client-computed". Read that as a guarantee about this metadata and it is
        // wrong: the values are not Stripe's, they are whatever create-product-order
        // wrote into `metadata` when it opened the intent, round-tripped back here.
        // Stripe stores them verbatim and attests to none of them. They are safe only
        // because that function derives every one of them server-side — the subtotal
        // from the cart rows, the fee from marketplace_settings, the shipping from a
        // constant. `shipping_cost_cents` was the exception until 2026-08-07: it came
        // off the request body unchecked, so a negative one landed here and generated
        // a `total_cents` below the subtotal. Anything added to this metadata inherits
        // that same requirement.
        const subtotalCents = Number(meta.subtotal_cents);
        const shippingCents = Number(meta.shipping_cost_cents);
        const platformFeeCents = Number(meta.platform_fee_cents);
        const taxCents = (charge as any)?.tax ?? 0;

        // Create order
        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert({
            buyer_id: meta.buyer_id,
            business_id: meta.business_id,
            status: 'paid',
            shipping_name: meta.shipping_name,
            shipping_line1: meta.shipping_line1,
            shipping_line2: meta.shipping_line2 || null,
            shipping_city: meta.shipping_city,
            shipping_state: meta.shipping_state,
            shipping_postal_code: meta.shipping_postal_code,
            shipping_country: meta.shipping_country,
            currency: pi.currency,
            subtotal_cents: subtotalCents,
            shipping_cost_cents: shippingCents,
            tax_cents: taxCents,
            platform_fee_cents: platformFeeCents,
            stripe_payment_intent_id: pi.id,
            stripe_charge_id: charge?.id ?? null,
            stripe_transfer_id: transferId ?? null,
            stripe_invoice_id: invoiceId,
            stripe_invoice_url: invoiceUrl,
            risk_level: (charge as any)?.outcome?.risk_level ?? 'normal',
          })
          .select('id')
          .single();

        if (orderErr || !order) {
          console.error('Failed to create order:', orderErr);
          break;
        }

        // Create order items.
        //
        // This result used to be discarded. supabase-js resolves with
        // `{ data, error }` and never throws, so the try/catch wrapping this
        // whole switch could not see a failure here -- the same shape as the
        // report button that said "Report submitted" over a write that never
        // happened, except on a money path.
        //
        // It became reachable with migration 090, which adds a composite FK
        // making a mismatched (product_id, variant_id) pair unrepresentable. Any
        // PaymentIntent opened by the OLD checkout carrying such a pair and paid
        // after 090 lands arrives here with the money already gone: hold marked
        // sold, charge captured, transfer made, orders row written. Swallowing
        // the refusal leaves a PAID ORDER WITH NO LINE ITEMS -- nothing for the
        // seller to ship, and an empty product_description in the dispute
        // evidence we would later send Stripe.
        const { error: itemsErr } = await supabase.from('order_items').insert(
          items.map(item => ({
            order_id: order.id,
            product_id: item.product_id,
            variant_id: item.variant_id,
            product_name: item.product_name,
            variant_label: item.variant_label,
            unit_price_cents: item.unit_price_cents,
            quantity: item.quantity,
          }))
        );

        if (itemsErr) {
          // Do NOT return non-2xx. Stripe would redeliver, and redelivery cannot
          // help: the orders row is already written and the insert would be
          // refused identically every time, so the only thing a retry adds is
          // more noise on a record a human already has to repair. The money has
          // moved; automatic recovery is not ours to attempt. Refunding or
          // deleting here would be guessing at intent on somebody's payment.
          //
          // The alert carries the order id and nothing about the woman who
          // placed it -- no name, no address, no raw buyer id (PII rules). The
          // order id is what makes it actionable and is safe to log.
          console.error(
            `[stripe-product-webhook] order_items rejected for order ${order.id}: ` +
              `${itemsErr.code ?? 'unknown'} ${itemsErr.message}`,
          );

          await supabase.from('reconciliation_alerts').insert({
            alert_type: 'order_items_missing',
            stripe_id: pi.id,
            order_id: order.id,
            detail:
              `Payment captured and order created, but order_items was refused ` +
              `(${itemsErr.code ?? 'unknown'}: ${itemsErr.message}). The buyer has ` +
              `paid and the seller has nothing to ship. Repair the line items by ` +
              `hand, or refund the order.`,
          });

          // The event is NOT clean, so it must not stay marked processed -- the
          // dedupe at the top of this handler would otherwise skip it forever.
          await supabase
            .from('webhook_events')
            .update({ status: 'failed' })
            .eq('stripe_event_id', event.id);

          degraded = `order_items_missing:${order.id}`;
        }

        // Order event
        await supabase.from('order_events').insert({
          order_id: order.id,
          event: 'payment_confirmed',
          actor_type: 'system',
          metadata: { stripe_charge_id: charge?.id },
        });

        // Clear cart
        await supabase.from('cart_items').delete().eq('cart_id', meta.cart_id);

        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const meta = pi.metadata;
        if (!meta?.buyer_id || !meta?.items_json) break;

        // The stock hold deliberately survives a declined card. A failed attempt does
        // not end the intent — it returns to requires_payment_method and the buyer pays
        // again with another card on the same intent, which emits no second decrement.
        // Releasing here (what this handler used to do) therefore oversold: decline → +1
        // → retry succeeds → the unit ships having never left stock. The hold is given
        // back on payment_intent.canceled, or by the sweep in create-product-order.
        const failureReason = pi.last_payment_error?.message ?? 'Unknown';
        await supabase
          .from('webhook_events')
          .update({ failure_reason: failureReason, amount_cents: pi.amount, stripe_payment_intent_id: pi.id })
          .eq('stripe_event_id', event.id);

        break;
      }

      case 'payment_intent.canceled': {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (!pi.metadata?.buyer_id || !pi.metadata?.items_json) break;

        // Read the intent fresh rather than trusting the event payload: the payload is a
        // snapshot from cancellation time, and create-product-order releases its own
        // holds inline the moment it cancels one. A stale `stock_held: held` here would
        // hand the same units back a second time and invent stock the seller never had.
        const current = await stripe.paymentIntents.retrieve(pi.id);
        await releaseHold(stripe, supabase, current);

        await supabase
          .from('webhook_events')
          .update({ amount_cents: pi.amount, stripe_payment_intent_id: pi.id })
          .eq('stripe_event_id', event.id);

        break;
      }

      case 'payout.paid': {
        const payout = event.data.object as Stripe.Payout;
        // Find business by stripe_account_id (from event.account for Connect events)
        const accountId = (event as any).account;
        if (!accountId) break;

        const { data: business } = await supabase
          .from('businesses')
          .select('id')
          .eq('stripe_account_id', accountId)
          .maybeSingle();
        if (!business) break;

        await supabase.from('seller_payouts').upsert({
          business_id: business.id,
          stripe_payout_id: payout.id,
          amount_cents: payout.amount,
          currency: payout.currency,
          status: 'paid',
          arrival_date: new Date(payout.arrival_date * 1000).toISOString().split('T')[0],
        }, { onConflict: 'stripe_payout_id' });

        break;
      }

      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout;
        const accountId = (event as any).account;
        if (!accountId) break;

        const { data: business } = await supabase
          .from('businesses')
          .select('id')
          .eq('stripe_account_id', accountId)
          .maybeSingle();
        if (!business) break;

        await supabase.from('seller_payouts').upsert({
          business_id: business.id,
          stripe_payout_id: payout.id,
          amount_cents: payout.amount,
          currency: payout.currency,
          status: 'failed',
          failure_message: payout.failure_message ?? 'Unknown failure',
        }, { onConflict: 'stripe_payout_id' });

        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;

        const { data: order } = await supabase
          .from('orders')
          .select('id, tracking_number, shipping_name, shipping_line1, shipping_city')
          .eq('stripe_charge_id', chargeId)
          .maybeSingle();
        if (!order) break;

        await supabase.from('disputes').insert({
          order_id: order.id,
          stripe_dispute_id: dispute.id,
          amount_cents: dispute.amount,
          reason: dispute.reason,
          status: dispute.status,
          response_due_by: new Date(
            ((dispute.evidence_details as any)?.due_by ?? Math.floor(Date.now() / 1000) + 604800) * 1000
          ).toISOString(),
        });

        // Auto-submit evidence
        try {
          const { data: items } = await supabase
            .from('order_items')
            .select('product_name, quantity, unit_price_cents')
            .eq('order_id', order.id);

          const productDesc = items
            ?.map(i => `${i.product_name} x${i.quantity} @ $${(i.unit_price_cents / 100).toFixed(2)}`)
            .join(', ') ?? '';

          await stripe.disputes.update(dispute.id, {
            evidence: {
              product_description: productDesc,
              shipping_address: `${order.shipping_line1}, ${order.shipping_city}`,
              shipping_tracking_number: (order as any).tracking_number ?? undefined,
            },
          });

          await supabase
            .from('disputes')
            .update({ evidence_submitted_at: new Date().toISOString() })
            .eq('stripe_dispute_id', dispute.id);
        } catch {
          // Evidence submission failure is non-fatal
        }

        // Queue business alert email
        const { data: orderFull } = await supabase
          .from('orders')
          .select('business_id, businesses(owner_id)')
          .eq('id', order.id)
          .single();

        if (orderFull) {
          const ownerId = (orderFull.businesses as any)?.owner_id;
          if (ownerId) {
            await supabase.from('email_queue').insert({
              email_type: 'dispute_alert_business',
              recipient_type: 'business',
              recipient_user_id: ownerId,
              order_id: order.id,
              payload: {
                order_short_id: order.id.slice(0, 8).toUpperCase(),
                dispute_amount_cents: dispute.amount,
                response_due_by: new Date(
                  ((dispute.evidence_details as any)?.due_by ?? 0) * 1000
                ).toISOString(),
                instructions: 'Log into Roxy Studio to review this dispute.',
              },
            });
          }
        }

        break;
      }

      case 'charge.dispute.updated': {
        const dispute = event.data.object as Stripe.Dispute;
        await supabase
          .from('disputes')
          .update({ status: dispute.status, updated_at: new Date().toISOString() })
          .eq('stripe_dispute_id', dispute.id);
        break;
      }

      case 'charge.refund.updated': {
        const refund = event.data.object as Stripe.Refund;
        await supabase
          .from('refunds')
          .update({ status: refund.status === 'succeeded' ? 'succeeded' : 'failed' })
          .eq('stripe_refund_id', refund.id);

        if (refund.status === 'succeeded') {
          // Check if fully refunded
          const chargeId = typeof refund.charge === 'string' ? refund.charge : (refund.charge as any)?.id;
          if (chargeId) {
            const { data: order } = await supabase
              .from('orders')
              .select('id, subtotal_cents')
              .eq('stripe_charge_id', chargeId)
              .maybeSingle();
            if (order) {
              const { data: refunds } = await supabase
                .from('refunds')
                .select('amount_cents')
                .eq('order_id', order.id)
                .eq('status', 'succeeded');
              const totalRefunded = refunds?.reduce((s, r) => s + r.amount_cents, 0) ?? 0;
              if (totalRefunded >= order.subtotal_cents) {
                await supabase
                  .from('orders')
                  .update({ status: 'refunded' })
                  .eq('id', order.id);
              }
            }
          }
        }
        break;
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        const canSell = account.charges_enabled && account.payouts_enabled;
        await supabase
          .from('businesses')
          .update({
            can_sell: canSell,
            stripe_onboarded_at: canSell ? new Date().toISOString() : null,
          })
          .eq('stripe_account_id', account.id);
        break;
      }

      case 'capability.updated': {
        const cap = event.data.object as Stripe.Capability;
        if (cap.id === 'card_payments') {
          const accountId = typeof cap.account === 'string' ? cap.account : (cap.account as any).id;
          const canSell = cap.status === 'active';
          await supabase
            .from('businesses')
            .update({ can_sell: canSell })
            .eq('stripe_account_id', accountId);
        }
        break;
      }

      case 'review.opened': {
        const review = event.data.object as Stripe.Review;
        const piId = typeof review.payment_intent === 'string'
          ? review.payment_intent
          : (review.payment_intent as any)?.id;
        if (!piId) break;

        const { data: order } = await supabase
          .from('orders')
          .select('id')
          .eq('stripe_payment_intent_id', piId)
          .maybeSingle();
        if (!order) break;

        await supabase.from('order_events').insert({
          order_id: order.id,
          event: 'note_added',
          actor_type: 'system',
          note: 'Payment under Stripe fraud review. Do not ship until review is resolved.',
          metadata: { stripe_review_id: review.id },
        });
        break;
      }

      case 'review.closed': {
        const review = event.data.object as Stripe.Review;
        if (review.reason === 'refunded_as_fraud' || review.reason === 'disputed') {
          const piId = typeof review.payment_intent === 'string'
            ? review.payment_intent
            : (review.payment_intent as any)?.id;
          if (piId) {
            await supabase
              .from('orders')
              .update({ status: 'cancelled', cancellation_reason: 'Refunded as fraud by Stripe' })
              .eq('stripe_payment_intent_id', piId);
          }
        }
        break;
      }

      case 'transfer.failed': {
        const transfer = event.data.object as Stripe.Transfer;
        await supabase.from('reconciliation_alerts').insert({
          alert_type: 'transfer_missing',
          stripe_id: transfer.id,
          detail: `Transfer failed: ${JSON.stringify(transfer)}`,
        });
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-product-webhook] handler error for ${event.type}:`, msg);
    await supabase
      .from('webhook_events')
      .update({ status: 'failed' })
      .eq('stripe_event_id', event.id);
  }

  // `degraded` is deliberately part of the body rather than the status code.
  // Stripe reads the status and nothing else, so a 200 is what stops a useless
  // redelivery -- but a body that says only `{ received: true }` over a paid
  // order with no line items is the handler lying about its own outcome, which
  // is the defect class this function was audited for.
  return successResponse(degraded ? { received: true, degraded } : { received: true });
});
