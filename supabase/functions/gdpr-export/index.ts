import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
  if (DEV_MOCK) return successResponse({ ok: true, mock: true, profile: 1, messages: 0, posts: 0 });

  const supabase = getSupabaseClient();

  // Count messages sent by the user
  const { count: messageCount } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('sender_id', auth.userId);

  // Count posts authored by the user
  const { count: postCount } = await supabase
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .eq('author_id', auth.userId);

  return successResponse({
    ok: true,
    summary: {
      profile: 1,
      messages: messageCount ?? 0,
      posts: postCount ?? 0,
    },
  });
});
