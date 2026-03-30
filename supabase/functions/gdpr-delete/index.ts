import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
  if (DEV_MOCK) return successResponse({ ok: true, mock: true, scheduled_deletion: '30 days' });

  const supabase = getSupabaseClient();

  // Soft delete: clear PII + mark deleted_at. Hard delete happens via scheduled job after 30 days.
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      display_name: 'Deleted User',
      username: `deleted_${auth.userId.slice(0, 8)}`,
      bio: null,
      avatar_url: null,
      pronouns: [],
      identity_labels: [],
      is_active: false,
      push_token: null,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', auth.userId);

  if (profileError) return errorResponse(profileError.message, 500);

  // NOTE: We do NOT call supabase.auth.admin.deleteUser here.
  // The auth user is deactivated when the profile is marked deleted_at.
  // A scheduled job (future session) will call deleteUser after 30 days.

  return successResponse({ ok: true, scheduled_deletion: '30 days' });
});
