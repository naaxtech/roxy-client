import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'gdpr-export',
    maxCount: 5,
    windowType: 'daily',
  });
  if (!allowed) return errorResponse('Rate limit exceeded', 429);

  if (DEV_MOCK) return successResponse({ ok: true, mock: true, profile: 1, messages: 0, posts: 0 });

  const supabase = getSupabaseClient();

  // Count messages sent by the user
  const { count: messageCount, error: msgError } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('sender_id', auth.userId);
  if (msgError) return errorResponse(msgError.message, 500);

  // Count posts authored by the user
  const { count: postCount, error: postError } = await supabase
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .eq('author_id', auth.userId);
  if (postError) return errorResponse(postError.message, 500);

  return successResponse({
    ok: true,
    summary: {
      profile: 1,
      messages: messageCount ?? 0,
      posts: postCount ?? 0,
    },
  });
});
