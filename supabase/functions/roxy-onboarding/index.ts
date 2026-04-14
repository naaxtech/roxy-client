import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
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

  // Rate limit: 1 per user lifetime
  const { allowed } = await checkRateLimit({ userId: auth.userId, fnName: 'roxy-onboarding', maxCount: 1, windowType: 'lifetime' });
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

  const raw = await callClaude({
    system: `You are Roxy. A new WLW user just joined. Return ONLY a JSON object (no markdown):
{"community_suggestions":["name1","name2","name3"],"welcome_message":"one warm sentence","first_goal":"one small achievable goal"}
Available communities: ${SEED_COMMUNITIES.join(', ')}
User identity: ${profile?.identity_labels?.join(', ')}
User interests: ${profile?.interests?.join(', ') ?? 'not set'}`,
    messages: [{ role: 'user', content: `My name is ${profile?.display_name}. Generate my onboarding data.` }],
    maxTokens: 300,
    mockResponse: JSON.stringify(mockResult),
  });

  let result = mockResult;
  try { result = JSON.parse(raw); } catch { /* use mock */ }

  const { error: logError } = await logAiCall({ userId: auth.userId, fnName: 'roxy-onboarding', wasMock: raw === JSON.stringify(mockResult) });
  if (logError) return errorResponse('Failed to record call', 500);

  return successResponse(result);
});
