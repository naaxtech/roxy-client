import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, user_a_name, user_b_name, shared_interests } = body;

  if (!conversation_id) return errorResponse('conversation_id required', 400);

  // Rate limit: 1 per conversation lifetime
  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-icebreaker',
    maxCount: 1,
    windowType: 'conversation',
    conversationId: conversation_id,
  });

  if (!allowed) return errorResponse('Icebreaker already sent for this conversation', 429);

  const nameA = user_a_name ?? 'someone';
  const nameB = user_b_name ?? 'someone';
  const interests = Array.isArray(shared_interests) && shared_interests.length > 0
    ? shared_interests.join(', ')
    : 'general interests';

  const mockIcebreaker = "What's a skill you've been wanting to learn?";

  const icebreaker = await callClaude({
    system: `You are Roxy, WLW AI wingwoman. Generate ONE short, open-ended icebreaker question for ${nameA} and ${nameB} who just matched. They share interests in: ${interests}. Max 20 words. No quotes. No preamble. Just the question.`,
    messages: [{ role: 'user', content: 'Generate the icebreaker.' }],
    maxTokens: 100,
    mockResponse: mockIcebreaker,
  });

  const { error: logError } = await logAiCall({
    userId: auth.userId,
    fnName: 'roxy-icebreaker',
    wasMock: icebreaker === mockIcebreaker,
    conversationId: conversation_id,
  });

  if (logError) return errorResponse('Failed to record call', 500);

  return successResponse({ icebreaker });
});
