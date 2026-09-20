// supabase/functions/get-orders-business/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let businessId: string | null = null;
  let status: string | null = null;
  try {
    const body = await req.json();
    businessId = body.business_id ?? null;
    status = body.status ?? null;
  } catch { /* no body */ }
  if (!businessId) return errorResponse('Missing business_id', 400);

  const supabase = getSupabaseClient();

  // Verify ownership
  const { data: biz } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (!biz) return errorResponse('Access denied', 403);

  let query = supabase
    .from('orders')
    .select(`
      id, status, currency, subtotal_cents, shipping_cost_cents, tax_cents,
      total_cents, platform_fee_cents, tracking_number,
      shipping_name, shipping_line1, shipping_line2,
      shipping_city, shipping_state, shipping_postal_code, shipping_country,
      shipped_at, delivered_at, cancelled_at, created_at,
      order_items (
        id, product_name, variant_label, unit_price_cents, quantity, line_total_cents
      ),
      order_events ( id, event, note, metadata, actor_type, created_at )
    `)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data: orders, error } = await query;
  if (error) return errorResponse(error.message, 500);

  return successResponse({ orders: orders ?? [] });
});
