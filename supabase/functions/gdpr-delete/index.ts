import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

  // Hard delete auth user (requires service role key)
  const adminUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(adminUrl, serviceKey);
  const { error: authError } = await adminClient.auth.admin.deleteUser(auth.userId);
  if (authError) return errorResponse(authError.message, 500);

  return successResponse({ ok: true });
});
