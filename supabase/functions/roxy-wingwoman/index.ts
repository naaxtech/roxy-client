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
  const { conversation_id, message_history, current_message } = body;

  if (!conversation_id) return errorResponse('conversation_id required', 400);
  if (!current_message) return errorResponse('current_message required', 400);

  // Rate limit: 5 per conversation per day
  const { allowed, currentCount } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-wingwoman',
    maxCount: 5,
    windowType: 'daily',
  });

  if (!allowed) {
    return errorResponse(`Daily wingwoman limit reached (${currentCount}/5)`, 429);
  }

  // Build context from recent messages (last 6 for brevity)
  const recentHistory = Array.isArray(message_history)
    ? message_history.slice(-6)
    : [];

  const historyText = recentHistory.length > 0
    ? recentHistory.map((m: { sender: string; content: string }) => `${m.sender}: ${m.content}`).join('\n')
    : 'No prior messages.';

  const mockSuggestion = "That sounds really interesting — tell me more!";

  const suggestion = await callClaude({
    system: `You are Roxy, WLW AI wingwoman. Suggest ONE short, warm follow-up message (max 15 words) that continues the conversation naturally. Be genuine, not sycophantic. No quotes. Just the suggestion text.`,
    messages: [
      {
        role: 'user',
        content: `Recent conversation:\n${historyText}\n\nThey just typed: "${current_message}"\n\nSuggest a reply.`,
      },
    ],
    maxTokens: 200,
    mockResponse: mockSuggestion,
  });

  const { error: logError } = await logAiCall({
    userId: auth.userId,
    fnName: 'roxy-wingwoman',
    wasMock: suggestion === mockSuggestion,
    conversationId: conversation_id,
  });

  if (logError) return errorResponse('Failed to record call', 500);

  return successResponse({ suggestion });
});
