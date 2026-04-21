// supabase/functions/staff-approve-business/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: { business_id: string; action: 'approve' | 'reject'; rejection_reason?: string };
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const { business_id, action, rejection_reason } = body;
  if (!business_id || !action) return errorResponse('Missing business_id or action', 400);

  const supabase = getSupabaseClient();

  // Verify staff
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) return errorResponse('Staff access required', 403);

  // Fetch business + owner info
  const { data: business, error: bizErr } = await supabase
    .from('businesses')
    .select('id, name, owner_id, is_verified, profiles(display_name)')
    .eq('id', business_id)
    .single();

  if (bizErr || !business) return errorResponse('Business not found', 404);

  if (action === 'approve') {
    await supabase
      .from('businesses')
      .update({ is_verified: true, business_rejection_reason: null })
      .eq('id', business_id);

    // Queue congratulatory email
    await supabase.from('email_queue').insert({
      email_type: 'business_approved',
      recipient_type: 'business',
      recipient_user_id: business.owner_id,
      payload: {
        business_name: business.name,
        display_name: (business.profiles as any)?.display_name ?? 'there',
      },
    });

    // Audit log
    await supabase.from('audit_log').insert({
      staff_id: userId,
      action: 'business_approved',
      target_type: 'business',
      target_id: business_id,
      metadata: { business_name: business.name },
    });

    return successResponse({ status: 'approved' });
  }

  if (action === 'reject') {
    if (!rejection_reason) return errorResponse('rejection_reason required', 400);

    await supabase
      .from('businesses')
      .update({ is_verified: false, business_rejection_reason: rejection_reason })
      .eq('id', business_id);

    // Queue rejection email
    await supabase.from('email_queue').insert({
      email_type: 'business_rejected',
      recipient_type: 'business',
      recipient_user_id: business.owner_id,
      payload: {
        business_name: business.name,
        display_name: (business.profiles as any)?.display_name ?? 'there',
        rejection_reason,
      },
    });

    // Audit log
    await supabase.from('audit_log').insert({
      staff_id: userId,
      action: 'business_rejected',
      target_type: 'business',
      target_id: business_id,
      metadata: { business_name: business.name, rejection_reason },
    });

    return successResponse({ status: 'rejected' });
  }

  return errorResponse('Invalid action', 400);
});
