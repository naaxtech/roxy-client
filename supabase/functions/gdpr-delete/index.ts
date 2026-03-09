import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
  if (DEV_MOCK) return successResponse({ ok: true, mock: true });

  const supabase = getSupabaseClient();

  // Soft delete: clear PII fields
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
    })
    .eq('id', auth.userId);
  if (profileError) return errorResponse(profileError.message, 500);

  // Hard delete auth user — supabase is already a service-role client
  const { error: authError } = await supabase.auth.admin.deleteUser(auth.userId);
  if (authError) return errorResponse(authError.message, 500);

  return successResponse({ ok: true });
});
