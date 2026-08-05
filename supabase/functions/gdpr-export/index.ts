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

  // Art. 15(3) entitles her to a COPY of the data, not a count of it. Counts
  // are fine for messages and posts -- she can already read those in the app --
  // but nothing in the invite gate is visible to her anywhere, so it has to be
  // returned in full: her legal name, her answers, her verification outcomes,
  // her appeals, and which processors received anything.
  const { data: gateData, error: gateError } = await supabase.rpc('export_gate_data', {
    p_user_id: auth.userId,
  });
  if (gateError) return errorResponse('Could not assemble your data export.', 500);

  return successResponse({
    ok: true,
    summary: {
      profile: 1,
      messages: messageCount ?? 0,
      posts: postCount ?? 0,
    },
    // Internal safety assessments and the reviewer audit log are excluded under
    // Art. 15(4) -- releasing them would identify the reviewer. Named here
    // rather than silently omitted, so the omission is a disclosed decision.
    membership: gateData ?? null,
    withheld: ['internal_safety_assessment', 'reviewer_access_log'],
  });
});
