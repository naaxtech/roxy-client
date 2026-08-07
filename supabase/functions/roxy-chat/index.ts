import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { callClaude } from '../_shared/claude.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const SYSTEM_PROMPT = `You are Roxy — a warm, witty WLW wingwoman. You help users with dating confidence, community connections, and personal growth. You feel like a best friend who genuinely gets it: affirming, practical, a little playful. Keep every response to 2–4 sentences. Never give clinical or medical advice. Never use the word "AI" — you're just Roxy.`;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, message } = body;
  if (!conversation_id || !message) return errorResponse('conversation_id and message required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  // conversation_id is deliberately NOT forwarded here.
  //
  // The Roxy companion chat is not a conversation between two members -- it has
  // no row in `conversations`. The client identifies the thread as
  // `roxy-${user.id}` (app/(tabs)/grow/roxy-chat.tsx:43), which is not a UUID,
  // and ai_call_log.conversation_id is typed uuid. Passing it made every insert
  // fail with 22P02, and the old logAiCall's returned error was never checked --
  // so the reply still rendered while nothing was ever written to the log. The
  // daily window does not use conversationId at all, so dropping it costs
  // nothing and makes the insert valid.
  //
  // The count and the write are now one statement, so the 20/day cap can no
  // longer read zero forever while the spend runs -- which is what it did, at
  // odds with the $0.50/user/month target in CLAUDE.md §4.
  //
  // 'allow' on limiter failure preserves the trade this function already chose:
  // refusing a woman her answer because we could not write an audit row is the
  // wrong side to fail on, and a limiter outage costs AI spend, which is
  // recoverable.
  const { allowed } = await consumeRateLimit({
    userId: auth.userId,
    fnName: 'roxy-chat',
    maxCount: 20,
    windowType: 'daily',
    wasMock: DEV_MOCK,
    onLimiterFailure: 'allow',
  });
  if (!allowed) return errorResponse("You've reached your daily chat limit with Roxy — come back tomorrow! 💜", 429);

  if (DEV_MOCK) {
    return successResponse({ response: "Hey! I'm Roxy 💜 Tell me what's going on — I'm all ears." });
  }

  const response = await callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: message }],
    maxTokens: 300,
    mockResponse: "Hey! I'm Roxy 💜 Tell me what's going on — I'm all ears.",
  });

  // The slot was consumed before the call, so there is nothing to log here. A
  // silent logging failure is what let the rate limit read zero forever, and
  // that failure mode no longer exists: the write is the count.
  return successResponse({ response });
});
