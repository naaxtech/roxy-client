import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
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

  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-chat',
    maxCount: 20,
    windowType: 'daily',
  });
  if (!allowed) return errorResponse("You've reached your daily chat limit with Roxy — come back tomorrow! 💜", 429);

  if (DEV_MOCK) {
    await logAiCall({ userId: auth.userId, fnName: 'roxy-chat', wasMock: true, conversationId: conversation_id });
    return successResponse({ response: "Hey! I'm Roxy 💜 Tell me what's going on — I'm all ears." });
  }

  const response = await callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: message }],
    maxTokens: 300,
    mockResponse: "Hey! I'm Roxy 💜 Tell me what's going on — I'm all ears.",
  });

  await logAiCall({ userId: auth.userId, fnName: 'roxy-chat', wasMock: false, conversationId: conversation_id });

  return successResponse({ response });
});
