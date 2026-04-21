// supabase/functions/update-order-shipped/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: { order_id: string; tracking_number: string };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { order_id, tracking_number } = body;
  if (!order_id || !tracking_number) return errorResponse('Missing order_id or tracking_number', 400);

  const supabase = getSupabaseClient();

  // Verify business ownership
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, business_id, businesses(owner_id), buyer_id')
    .eq('id', order_id)
    .maybeSingle();

  if (!order) return errorResponse('Order not found', 404);
  if ((order.businesses as any)?.owner_id !== userId) return errorResponse('Access denied', 403);
  if (order.status !== 'paid') return errorResponse(`Cannot ship order with status: ${order.status}`, 400);

  await supabase
    .from('orders')
    .update({
      status: 'shipped',
      tracking_number,
      shipped_at: new Date().toISOString(),
    })
    .eq('id', order_id);

  await supabase.from('order_events').insert({
    order_id,
    event: 'shipped',
    actor_type: 'business',
    metadata: { tracking_number },
  });

  // Queue shipping notification email to buyer
  await supabase.from('email_queue').insert({
    email_type: 'order_shipped_buyer',
    recipient_type: 'buyer',
    recipient_user_id: order.buyer_id,
    order_id,
    payload: {
      order_short_id: order_id.slice(0, 8).toUpperCase(),
      business_name: '',
      tracking_number,
      carrier_url: `https://www.google.com/search?q=${encodeURIComponent(tracking_number)}`,
      items_summary: '',
    },
  });

  return successResponse({ status: 'shipped', tracking_number });
});
