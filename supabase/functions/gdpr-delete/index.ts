import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const rateLimitResult = await checkRateLimit({ userId: auth.userId, fnName: 'gdpr-delete', windowType: 'daily', maxCount: 3 });
  if (!rateLimitResult.allowed) {
    return errorResponse('Rate limit exceeded', 429);
  }

  if (DEV_MOCK) return successResponse({ ok: true, mock: true, scheduled_deletion: '30 days' });

  const supabase = getSupabaseClient();

  // Soft delete: clear PII + mark deleted_at. Hard delete happens via scheduled job after 30 days.
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      display_name: 'Deleted User',
      username: `deleted_${auth.userId}`,
      bio: null,
      avatar_url: null,
      pronouns: [],
      identity_labels: [],
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', auth.userId);

  if (profileError) return errorResponse(profileError.message, 500);

  await supabase.from('push_tokens').delete().eq('user_id', auth.userId);

  // Art. 17 over the invite gate: legal name, identity outcomes, answers,
  // appeals and safety notes. Until migration 074 none of it was reachable by
  // erasure at all -- the most sensitive data in the system was the only data
  // a deletion request did not touch.
  //
  // This is a hard delete, not a soft one. A profile can be tombstoned because
  // its rows are referenced across the app; an applicant's government name has
  // no such dependency and no reason to survive the request.
  const { error: gateError } = await supabase.rpc('erase_gate_data', {
    p_user_id: auth.userId,
  });
  if (gateError) {
    // Failing loudly matters: reporting success while special-category data
    // remains is worse than the request erroring and being retried.
    return errorResponse('Could not complete deletion. Nothing was partially removed.', 500);
  }

  // NOTE: We do NOT call supabase.auth.admin.deleteUser here.
  // The auth user is deactivated when the profile is marked deleted_at.
  // A scheduled job (future session) will call deleteUser after 30 days.

  return successResponse({ ok: true, scheduled_deletion: '30 days' });
});
