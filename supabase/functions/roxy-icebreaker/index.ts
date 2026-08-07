import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { consumeRateLimit, refundRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, user_a_name, user_b_name, shared_interests } = body;

  if (!conversation_id) return errorResponse('conversation_id required', 400);

  // Rate limit: 1 per conversation lifetime.
  //
  // 'deny' on limiter failure: like roxy-onboarding this is a one-shot, so
  // allowing on failure means allowing a second icebreaker on a match that is
  // only ever supposed to get one.
  const { allowed, callId } = await consumeRateLimit({
    userId: auth.userId,
    fnName: 'roxy-icebreaker',
    maxCount: 1,
    windowType: 'conversation',
    conversationId: conversation_id,
    onLimiterFailure: 'deny',
  });

  if (!allowed) return errorResponse('Icebreaker already sent for this conversation', 429);

  const nameA = user_a_name ?? 'someone';
  const nameB = user_b_name ?? 'someone';
  const interests = Array.isArray(shared_interests) && shared_interests.length > 0
    ? shared_interests.join(', ')
    : 'general interests';

  const mockIcebreaker = "What's a skill you've been wanting to learn?";

  // The one slot this match gets is already consumed, so a failed generation
  // must hand it back — otherwise a transient Anthropic error means these two
  // never get an icebreaker at all.
  let icebreaker: string;
  try {
    icebreaker = await callClaude({
      system: `You are Roxy, WLW AI wingwoman. Generate ONE short, open-ended icebreaker question for ${nameA} and ${nameB} who just matched. They share interests in: ${interests}. Max 20 words. No quotes. No preamble. Just the question.`,
      messages: [{ role: 'user', content: 'Generate the icebreaker.' }],
      maxTokens: 100,
      mockResponse: mockIcebreaker,
    });
  } catch (err) {
    await refundRateLimit(auth.userId, callId);
    console.error(`[roxy-icebreaker] generation failed, slot refunded: ${err}`);
    return errorResponse("Roxy couldn't think of one just now — try again in a moment 💜", 502);
  }

  // Recorded at the gate. The old 'Failed to record call' 500 threw away a
  // perfectly good icebreaker because an audit row would not write; that
  // trade-off no longer exists, because the row IS the authorisation.
  return successResponse({ icebreaker });
});
