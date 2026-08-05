import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { userId: reportedUserId, contentType, contentId, reason, detail } = body;
  if (!reportedUserId || !contentType || !reason) {
    return errorResponse('userId, contentType and reason required', 400);
  }

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'submit-report',
    maxCount: 10,
    windowType: 'daily',
  });
  if (!allowed) return errorResponse('Rate limit exceeded', 429);

  if (DEV_MOCK) return successResponse({ ok: true, mock: true });

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('reports').insert({
    reporter_id: auth.userId,
    reported_user_id: reportedUserId,
    content_type: contentType,
    content_id: contentId ?? null,
    reason,
    detail: detail ?? null,
  });
  if (error) return errorResponse(error.message, 500);

  return successResponse({ ok: true });
});
