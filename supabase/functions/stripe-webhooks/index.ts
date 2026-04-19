// supabase/functions/stripe-webhooks/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  // Must read raw body before any parsing — HMAC is over raw bytes
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return errorResponse('Missing Stripe-Signature header', 400);
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
  } catch (err) {
    return errorResponse(`Webhook signature verification failed: ${err}`, 400);
  }

  const supabase = getSupabaseClient();

  try {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        await supabase
          .from('host_stripe_accounts')
          .update({
            onboarding_complete: account.charges_enabled && account.payouts_enabled,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_account_id', account.id);
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const eventId = pi.metadata?.event_id;

        if (!eventId || !/^[0-9a-f-]{36}$/.test(eventId)) {
          console.error('Invalid or missing event_id in metadata', pi.id);
          break;
        }

        // Look up buyer_id from OUR pending payment_logs record — never trust Stripe metadata
        const { data: pendingLog } = await supabase
          .from('payment_logs')
          .select('buyer_id, host_id, fee_cents, host_payout_cents')
          .eq('payment_intent_id', pi.id)
          .eq('status', 'pending')
          .maybeSingle();

        if (!pendingLog) {
          console.error('No pending payment_logs row for', pi.id);
          break;
        }

        // Atomic ticket claim
        const { data: ticketCode, error: claimErr } = await supabase
          .rpc('claim_ticket', {
            p_event_id: eventId,
            p_buyer_id: pendingLog.buyer_id,
          });

        if (claimErr) {
          console.error('claim_ticket failed:', claimErr.message);
          // sold_out or other error — log but still return 200 to Stripe
          await supabase
            .from('payment_logs')
            .update({ status: 'failed', updated_at: new Date().toISOString() })
            .eq('payment_intent_id', pi.id);
          break;
        }

        // Upgrade payment_logs to succeeded
        await supabase
          .from('payment_logs')
          .update({
            status: 'succeeded',
            ticket_code: ticketCode,
            updated_at: new Date().toISOString(),
          })
          .eq('payment_intent_id', pi.id);

        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await supabase
          .from('payment_logs')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('payment_intent_id', pi.id)
          .eq('status', 'pending');
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge as any)?.id;
        if (!chargeId) break;

        const charge = await stripe.charges.retrieve(chargeId);
        const piId = typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : (charge.payment_intent as any)?.id;
        if (!piId) break;

        const { data: log } = await supabase
          .from('payment_logs')
          .select('event_id')
          .eq('payment_intent_id', piId)
          .maybeSingle();
        if (!log?.event_id) break;

        await supabase
          .from('events')
          .update({ payout_blocked: true })
          .eq('id', log.event_id);

        await supabase.from('audit_log').insert({
          action: 'block_payout',
          target_type: 'event',
          target_id: log.event_id,
          metadata: { reason: 'dispute', dispute_id: dispute.id, payment_intent_id: piId },
        });
        break;
      }

      default:
        // Return 200 for all unhandled types — Stripe requires 2xx or it retries
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    // Still return 200 — log and investigate separately; don't cause Stripe retries
  }

  return successResponse({ received: true });
});
