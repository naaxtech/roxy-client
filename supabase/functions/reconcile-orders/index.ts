// supabase/functions/reconcile-orders/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const authHeader = req.headers.get('Authorization');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
    return errorResponse('Unauthorized', 401);
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('STRIPE_SECRET_KEY not set', 500);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });

  const supabase = getSupabaseClient();
  const alerts: string[] = [];

  // Window: yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dayStart = new Date(yesterday);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(yesterday);
  dayEnd.setHours(23, 59, 59, 999);

  try {
    // 1. Fetch Stripe charges for yesterday
    const charges = await stripe.charges.list({
      created: {
        gte: Math.floor(dayStart.getTime() / 1000),
        lte: Math.floor(dayEnd.getTime() / 1000),
      },
      limit: 100,
    });

    for (const charge of charges.data) {
      if (!charge.payment_intent) continue;
      const piId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent.id;

      // Only check marketplace payments (have buyer_id metadata)
      const pi = await stripe.paymentIntents.retrieve(piId);
      if (!pi.metadata?.buyer_id) continue;

      const { data: order } = await supabase
        .from('orders')
        .select('id, status')
        .eq('stripe_payment_intent_id', piId)
        .maybeSingle();

      if (!order) {
        await supabase.from('reconciliation_alerts').insert({
          alert_type: 'charge_not_in_db',
          stripe_id: charge.id,
          detail: `Stripe charge ${charge.id} (PI: ${piId}) has no matching order in DB`,
        });
        alerts.push(`charge_not_in_db: ${charge.id}`);
      }
    }

    // 2. Check our paid orders against Stripe
    const { data: paidOrders } = await supabase
      .from('orders')
      .select('id, stripe_payment_intent_id, stripe_charge_id')
      .eq('status', 'paid')
      .gte('created_at', dayStart.toISOString())
      .lte('created_at', dayEnd.toISOString());

    for (const order of paidOrders ?? []) {
      if (!order.stripe_charge_id) {
        await supabase.from('reconciliation_alerts').insert({
          alert_type: 'order_paid_no_charge',
          order_id: order.id,
          detail: `Order ${order.id} status=paid but has no stripe_charge_id`,
        });
        alerts.push(`order_paid_no_charge: ${order.id}`);
      }
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[reconcile-orders] error:', msg);
    return errorResponse(`Reconciliation failed: ${msg}`, 500);
  }

  return successResponse({ reconciled: true, alerts_created: alerts.length, alerts });
});
