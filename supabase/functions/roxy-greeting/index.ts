import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { logAiCall } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const supabase = getSupabaseClient();
  const today = new Date().toISOString().split('T')[0];

  // ── Cache check: return today's greeting if it already exists ───────────────
  const { data: cached } = await supabase
    .from('roxy_greetings')
    .select('greeting_text')
    .eq('user_id', auth.userId)
    .eq('generated_date', today)
    .maybeSingle();

  if (cached) {
    return successResponse({ greeting: cached.greeting_text, cached: true });
  }

  // ── Fetch user context for personalisation ──────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, identity_labels')
    .eq('id', auth.userId)
    .maybeSingle();

  const name = profile?.display_name ?? 'friend';
  const labels =
    Array.isArray(profile?.identity_labels) && profile.identity_labels.length > 0
      ? profile.identity_labels.join(', ')
      : 'WLW community member';

  const mockResponse = `Hey ${name} — Roxy here. (dev: AI paused)`;

  // ── Call Claude (or return mock) ────────────────────────────────────────────
  const greeting = await callClaude({
    system: `You are Roxy, an AI wingwoman for a WLW community platform. Write one warm, personal greeting card message for ${name}. Max 2 sentences. Tone: warm, witty, queer-affirming. Never say "good morning" or "good evening". Never be generic. The user identifies as: ${labels}.`,
    messages: [{ role: 'user', content: 'Generate my greeting.' }],
    maxTokens: 80,
    mockResponse,
  });

  const wasMock = greeting === mockResponse;

  // ── Store in cache ──────────────────────────────────────────────────────────
  // ON CONFLICT DO NOTHING in case of a race condition (two requests in parallel)
  await supabase.from('roxy_greetings').upsert(
    {
      user_id: auth.userId,
      greeting_text: greeting,
      generated_date: today,
    },
    { onConflict: 'user_id,generated_date', ignoreDuplicates: true }
  );

  // ── Log the call ────────────────────────────────────────────────────────────
  await logAiCall({
    userId: auth.userId,
    fnName: 'roxy-greeting',
    wasMock,
  });

  return successResponse({ greeting, cached: false });
});
