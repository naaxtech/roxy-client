// supabase/functions/refund-order/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: { order_id: string; amount_cents: number; reason?: string };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { order_id, amount_cents, reason = '' } = body;
  if (!order_id || !amount_cents) return errorResponse('Missing order_id or amount_cents', 400);

  const supabase = getSupabaseClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, status, stripe_charge_id, buyer_id, business_id, subtotal_cents, businesses(owner_id)')
    .eq('id', order_id)
    .maybeSingle();

  if (!order) return errorResponse('Order not found', 404);

  // Caller must be business owner or staff
  const isBusinessOwner = (order.businesses as any)?.owner_id === userId;
  const { data: profile } = await supabase
    .from('profiles').select('is_staff').eq('id', userId).single();
  const isStaff = profile?.is_staff ?? false;
  if (!isBusinessOwner && !isStaff) return errorResponse('Access denied', 403);

  if (!order.stripe_charge_id) return errorResponse('No charge ID on order — cannot refund', 400);
  if (['refunded', 'cancelled'].includes(order.status)) {
    return errorResponse(`Order is already ${order.status}`, 400);
  }

  if (DEV_MOCK) {
    return successResponse({ refund_id: 're_mock', status: 'pending' });
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('STRIPE_SECRET_KEY not set', 500);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-11-20' as any });

  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create({
      charge: order.stripe_charge_id,
      amount: amount_cents,
      reason: 'requested_by_customer',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Stripe refund error: ${msg}`, 500);
  }

  await supabase.from('refunds').insert({
    order_id,
    amount_cents,
    reason,
    status: 'pending',
    stripe_refund_id: refund.id,
    initiated_by: isStaff ? 'staff' : 'business',
  });

  await supabase.from('order_events').insert({
    order_id,
    event: 'refunded',
    actor_type: isStaff ? 'staff' : 'business',
    metadata: { amount_cents, stripe_refund_id: refund.id },
  });

  await supabase.from('email_queue').insert({
    email_type: 'refund_notification_buyer',
    recipient_type: 'buyer',
    recipient_user_id: order.buyer_id,
    order_id,
    payload: {
      order_short_id: order_id.slice(0, 8).toUpperCase(),
      amount_cents,
      currency: 'usd',
      reason,
    },
  });

  return successResponse({ refund_id: refund.id, status: 'pending' });
});
