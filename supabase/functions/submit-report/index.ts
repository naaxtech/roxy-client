import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

/**
 * What a report may be about.
 *
 * This function used to pass the client's `contentType` straight into the
 * insert, so an unrecognised value became a CHECK violation on
 * `reports.content_type` and reached the client as an opaque 23514 — and
 * `room` / `speed_date`, which `safetyStore` has sent since the live surfaces
 * got report buttons, were rejected outright. Migration 094 widens the CHECK;
 * this list makes a bad value a clear 400 instead of a database error.
 *
 * Kept in step with the client constant and the migration by
 * `apps/mobile/__tests__/lib/reportContentTypes.test.ts`, which reads all three.
 */
const REPORT_CONTENT_TYPES = ['message', 'post', 'profile', 'room', 'speed_date'];

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
  if (!REPORT_CONTENT_TYPES.includes(contentType)) {
    return errorResponse(`contentType must be one of: ${REPORT_CONTENT_TYPES.join(', ')}`, 400);
  }

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  // Was checkRateLimit, which counted ai_call_log rows that this function never
  // wrote — so this cap has never fired.
  //
  // 'allow' on limiter failure, and this is the one row in the policy table that
  // matters most. A woman reporting abuse must never be blocked by our database
  // having a bad second. A duplicate report costs a moderator ten seconds; a
  // refused one costs her the report, at the moment she most needed it to work.
  // Do not "tidy" this to 'deny' for consistency with the other five — the
  // asymmetry is the decision.
  const { allowed } = await consumeRateLimit({
    userId: auth.userId,
    fnName: 'submit-report',
    maxCount: 10,
    windowType: 'daily',
    onLimiterFailure: 'allow',
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
