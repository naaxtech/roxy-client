import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { callClaude } from '../_shared/claude.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id } = body;

  if (!conversation_id) return errorResponse('conversation_id required', 400);

  // Rate limit: 3 per user lifetime
  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-nudge',
    maxCount: 3,
    windowType: 'lifetime',
  });

  if (!allowed) return errorResponse('Nudge limit reached — you have 3 nudges lifetime', 429);

  const supabase = getSupabaseClient();
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('sender_id, content, created_at')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: false })
    .limit(3);

  const context = (recentMessages ?? [])
    .reverse()
    .map((m: { sender_id: string; content: string }) =>
      `${m.sender_id === auth.userId ? 'You' : 'Her'}: ${m.content ?? '[media]'}`
    )
    .join('\n');

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
  const MOCK_NUDGE = "She might love hearing from you — even a small 'hey' can spark something special 💜";

  const nudge = await callClaude({
    system: `You are Roxy, a warm and encouraging WLW wingwoman. The user wants a gentle nudge to re-engage with someone they've been chatting with. Write one encouraging sentence (max 18 words) that feels personal and warm, ending with a 💜 emoji. Never be pushy.`,
    messages: [{ role: 'user', content: context ? `Recent messages:\n${context}\n\nGenerate nudge.` : 'Generate nudge.' }],
    maxTokens: 64,
    mockResponse: MOCK_NUDGE,
  });

  await logAiCall({ userId: auth.userId, fnName: 'roxy-nudge', wasMock: DEV_MOCK, conversationId: conversation_id });

  return successResponse({ nudge });
});
