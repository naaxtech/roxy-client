// supabase/functions/staff-approve-product/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: { product_id: string; action: 'approve' | 'reject'; rejection_reason?: string };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { product_id, action, rejection_reason } = body;
  if (!product_id || !action) return errorResponse('Missing product_id or action', 400);

  const supabase = getSupabaseClient();

  // Verify staff
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) return errorResponse('Staff access required', 403);

  if (action === 'approve') {
    await supabase
      .from('products')
      .update({ status: 'approved', rejection_reason: null })
      .eq('id', product_id);

    // Queue approval notification
    const { data: product } = await supabase
      .from('products')
      .select('name, businesses(owner_id, name)')
      .eq('id', product_id)
      .single();

    if (product) {
      const ownerId = (product.businesses as any)?.owner_id;
      if (ownerId) {
        await supabase.from('email_queue').insert({
          email_type: 'product_approved',
          recipient_type: 'business',
          recipient_user_id: ownerId,
          product_id,
          payload: {
            product_name: product.name,
            business_name: (product.businesses as any)?.name ?? '',
          },
        });
      }
    }

    return successResponse({ status: 'approved' });
  }

  if (action === 'reject') {
    if (!rejection_reason) return errorResponse('rejection_reason required', 400);
    await supabase
      .from('products')
      .update({ status: 'rejected', rejection_reason })
      .eq('id', product_id);

    const { data: product } = await supabase
      .from('products')
      .select('name, businesses(owner_id)')
      .eq('id', product_id)
      .single();

    if (product) {
      const ownerId = (product.businesses as any)?.owner_id;
      if (ownerId) {
        await supabase.from('email_queue').insert({
          email_type: 'product_rejected',
          recipient_type: 'business',
          recipient_user_id: ownerId,
          product_id,
          payload: { product_name: product.name, rejection_reason },
        });
      }
    }

    return successResponse({ status: 'rejected' });
  }

  return errorResponse('Invalid action', 400);
});
