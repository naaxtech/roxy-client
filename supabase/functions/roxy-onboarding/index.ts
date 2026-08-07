import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { consumeRateLimit, refundRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const SEED_COMMUNITIES = [
  'Lesbians of London', 'Bi+ Collective', 'Queer Gamers',
  'WLW Entrepreneurs', 'Trans & Non-binary Support',
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const supabase = getSupabaseClient();

  // Rate limit: 1 per user lifetime.
  //
  // 'deny' on limiter failure, unlike every other Roxy call: allowing on failure
  // here means allowing a SECOND lifetime call, which is the one thing this cap
  // exists to prevent.
  const { allowed, callId } = await consumeRateLimit({
    userId: auth.userId,
    fnName: 'roxy-onboarding',
    maxCount: 1,
    windowType: 'lifetime',
    onLimiterFailure: 'deny',
  });
  if (!allowed) return errorResponse('Already called', 429);

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, identity_labels, interests')
    .eq('id', auth.userId)
    .single();

  const mockResult = {
    community_suggestions: SEED_COMMUNITIES.slice(0, 3),
    welcome_message: `Welcome to Roxy, ${profile?.display_name ?? 'friend'}! (dev: AI paused)`,
    first_goal: 'Join your first community and say hello.',
  };

  // The slot is consumed BEFORE the call, so a transient Anthropic failure would
  // otherwise burn her ONE lifetime onboarding — permanently, with no route back
  // that does not involve editing her row by hand. She gets the slot returned.
  let raw: string;
  try {
    raw = await callClaude({
      system: `You are Roxy. A new WLW user just joined. Return ONLY a JSON object (no markdown):
{"community_suggestions":["name1","name2","name3"],"welcome_message":"one warm sentence","first_goal":"one small achievable goal"}
Available communities: ${SEED_COMMUNITIES.join(', ')}
User identity: ${profile?.identity_labels?.join(', ')}
User interests: ${profile?.interests?.join(', ') ?? 'not set'}`,
      messages: [{ role: 'user', content: `My name is ${profile?.display_name}. Generate my onboarding data.` }],
      maxTokens: 300,
      mockResponse: JSON.stringify(mockResult),
    });
  } catch (err) {
    await refundRateLimit(auth.userId, callId);
    console.error(`[roxy-onboarding] generation failed, slot refunded: ${err}`);
    return errorResponse("Roxy couldn't put your welcome together just now — try again in a moment 💜", 502);
  }

  let result = mockResult;
  try { result = JSON.parse(raw); } catch { /* use mock */ }

  // The call was recorded at the gate. There is no separate log step to fail, so
  // the old 'Failed to record call' 500 — which threw away a generated result
  // because an audit row would not write — is gone with it.
  return successResponse(result);
});
