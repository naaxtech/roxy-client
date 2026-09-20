// supabase/functions/get-orders-buyer/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  const supabase = getSupabaseClient();

  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      id, status, currency, subtotal_cents, shipping_cost_cents, tax_cents,
      total_cents, platform_fee_cents, tracking_number, stripe_invoice_url,
      shipped_at, delivered_at, created_at,
      business:businesses ( id, name, logo_url ),
      order_items (
        id, product_name, variant_label, unit_price_cents, quantity, line_total_cents
      ),
      order_events ( id, event, note, metadata, actor_type, created_at )
    `)
    .eq('buyer_id', userId)
    .order('created_at', { ascending: false });

  if (error) return errorResponse(error.message, 500);

  return successResponse({ orders: orders ?? [] });
});
