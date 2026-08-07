import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const userId = auth.userId;
  const supabase = getSupabaseClient();
  const today = new Date().toISOString().split('T')[0];

  // ── Cache check: return today's greeting if it already exists ───────────────
  const { data: cached } = await supabase
    .from('roxy_greetings')
    .select('greeting_text')
    .eq('user_id', userId)
    .eq('generated_date', today)
    .maybeSingle();

  if (cached) {
    return successResponse({ greeting: cached.greeting_text, cached: true });
  }

  // ── Rate limit ──────────────────────────────────────────────────────────────
  //
  // This function had NO cap. It only ever called logAiCall, so it wrote the
  // ledger without reading it — the exact mirror of the six functions that read
  // it without writing. Its documented rule (CLAUDE.md §8) is "Cache 24h — never
  // regenerate same day", and that rule lives in the cache check above, not
  // here. A cache is a performance feature; it is not a spend control, because
  // anything that clears or misses it removes the only thing standing between a
  // caller and unbounded Claude spend on the platform's LARGEST AI cost line
  // (53 of the 78 calls ever logged).
  //
  // The cap is deliberately placed AFTER the cache check, so a cached hit costs
  // her nothing — a slot is consumed only where a Claude call actually happens.
  //
  // maxCount 5 is measured, not guessed. Across all production history: 47
  // user-days, of which 44 were exactly one call, with a maximum of 4. A cap of
  // 1 would have refused three real requests; 5 would have refused none, while
  // replacing "unbounded" with a bound. This IS a new cap where none existed —
  // recorded plainly here rather than slipped in, because a cap that appears by
  // accident is the same defect as one that silently never fires.
  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
  const { allowed } = await consumeRateLimit({
    userId,
    fnName: 'roxy-greeting',
    maxCount: 5,
    windowType: 'daily',
    wasMock: DEV_MOCK,
    // 'allow' on limiter failure: her greeting is the first thing she sees when
    // she opens Roxy, and a database blip is not a reason to meet her with an
    // error instead.
    onLimiterFailure: 'allow',
  });
  if (!allowed) {
    return errorResponse("Roxy's already written to you today — check back tomorrow 💜", 429);
  }

  // ── Fetch user context for personalisation ──────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, identity_labels')
    .eq('id', userId)
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

  // ── Store in cache ──────────────────────────────────────────────────────────
  // ON CONFLICT DO NOTHING in case of a race condition (two requests in parallel)
  await supabase.from('roxy_greetings').upsert(
    {
      user_id: userId,
      greeting_text: greeting,
      generated_date: today,
    },
    { onConflict: 'user_id,generated_date', ignoreDuplicates: true }
  );

  // The call was recorded at the gate above, in the same statement that
  // authorised it. `was_mock` now records that the environment was mocked,
  // rather than that the reply happened to equal the mock string — which
  // mislabelled any genuine Claude response identical to it.
  return successResponse({ greeting, cached: false });
});
