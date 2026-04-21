import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const MOCK_SUGGESTION = "That sounds really interesting — tell me more!";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, message_history, current_message } = body;

  if (!conversation_id) return errorResponse('conversation_id required', 400);
  if (!current_message) return errorResponse('current_message required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const { allowed, currentCount } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-wingwoman',
    maxCount: 5,
    windowType: 'daily',
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

  // Log call — non-critical, do not fail the request if this errors
  await logAiCall({
    userId: auth.userId,
    fnName: 'roxy-wingwoman',
    wasMock: false,
    conversationId: conversation_id,
  }).catch(() => {});

  return successResponse({ suggestion });
});
