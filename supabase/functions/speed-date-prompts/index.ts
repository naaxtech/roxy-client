import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { generateSpeedDatePrompts } from '../_shared/speedDatePrompts.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json().catch(() => ({}));
  const { session_id } = body;

  if (!session_id) return errorResponse('session_id required', 400);

  const supabase = getSupabaseClient();

  // Verify session exists
  const { data: session, error: sessionError } = await supabase
    .from('speed_date_sessions')
    .select('id, prompts')
    .eq('id', session_id)
    .single();

  if (sessionError || !session) return errorResponse('Session not found', 404);
  if (session.prompts && session.prompts.length >= 10) {
    return successResponse({ prompts: session.prompts, generated: false });
  }

  const prompts = await generateSpeedDatePrompts();

  const { error: updateError } = await supabase
    .from('speed_date_sessions')
    .update({ prompts })
    .eq('id', session_id);

  if (updateError) return errorResponse('Failed to store prompts', 500);

  return successResponse({ prompts, generated: true });
});
