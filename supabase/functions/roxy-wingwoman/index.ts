import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const MOCK_SUGGESTION = "That sounds really interesting — tell me more!";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, message_history, current_message } = body;

  if (!conversation_id) return errorResponse('conversation_id required', 400);
  if (!current_message) return errorResponse('current_message required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  // `currentCount` on a REFUSAL is the count that caused it, so the "(n/5)" in
  // the message below still reads 5/5 — consume writes nothing when it refuses.
  // 'allow' on limiter failure: AI spend, recoverable.
  const { allowed, currentCount } = await consumeRateLimit({
    userId: auth.userId,
    fnName: 'roxy-wingwoman',
    maxCount: 5,
    windowType: 'daily',
    wasMock: DEV_MOCK,
    onLimiterFailure: 'allow',
  });
  if (!allowed) {
    return errorResponse(`Daily wingwoman limit reached (${currentCount}/5)`, 429);
  }

  if (DEV_MOCK) return successResponse({ suggestion: MOCK_SUGGESTION });

  const recentHistory = Array.isArray(message_history)
    ? message_history.slice(-6)
    : [];

  const historyText = recentHistory.length > 0
    ? recentHistory.map((m: { sender: string; content: string }) => `${m.sender}: ${m.content}`).join('\n')
    : 'No prior messages.';

  let suggestion: string;
  try {
    suggestion = await callClaude({
      system: `You are Roxy, WLW AI wingwoman. Suggest ONE short, warm follow-up message (max 15 words) that continues the conversation naturally. Be genuine, not sycophantic. No quotes. Just the suggestion text.`,
      messages: [
        {
          role: 'user',
          content: `Recent conversation:\n${historyText}\n\nThey just typed: "${current_message}"\n\nSuggest a reply.`,
        },
      ],
      maxTokens: 200,
      mockResponse: MOCK_SUGGESTION,
    });
  } catch {
    return errorResponse('AI temporarily unavailable, please try again', 503);
  }

  // The slot was consumed before the call. The old `.catch(() => {})` here was
  // "non-critical" only because nothing depended on the row — except the cap,
  // which read the same table and therefore counted zero forever.
  return successResponse({ suggestion });
});
