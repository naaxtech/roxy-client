import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const DEV_MOCK_PROMPTS = [
  "What's a skill you've always wanted to learn?",
  'Which place changed how you see yourself?',
  "What's your version of a perfect Sunday?",
  "What's something you believed at 16 that you've completely changed your mind on?",
  'If you could live anywhere for a year, where and why?',
  "What's a small thing that always makes your day better?",
  "What are you most proud of that nobody knows about?",
  'Describe your ideal first date in three words.',
  "What's the last book / show / song that genuinely moved you?",
  'What does home mean to you?',
];

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  // ── The gate used to be `if (ENVIRONMENT === 'production') deny` ────────────
  //
  // That reads as "blocked in production" and was the opposite: ENVIRONMENT is
  // not set on this project at all (`supabase secrets list`, 2026-08-07 -- 17
  // secrets, no ENVIRONMENT), so `Deno.env.get` returned undefined, the equality
  // was false, and the block never fired. This function has been ACTIVE on
  // production since version 29 with no gate on it beyond a valid JWT.
  //
  // What that opened, to any invited member with a login:
  //
  //   * `set_ai_enabled` upserts dev_config.ai_enabled, which is GLOBAL and
  //     unscoped -- one request turns Roxy's AI off for every woman on the
  //     platform. dev_config is otherwise unreachable (RLS `FOR ALL USING
  //     (false)`, 001:97), so this function was the only door to it, and it was
  //     open.
  //   * `reset_counters` deletes her ai_call_log rows for the day, clearing
  //     every daily cap that DOES work -- a total bypass of the rate limiter.
  //   * `clear_greeting_cache` re-arms the greeting, which is the single largest
  //     AI cost line on the platform (53 of 78 logged calls).
  //
  // Now fail-closed: a missing, misspelled or unexpected ENVIRONMENT denies.
  // Only the exact string 'development' opens the door, so the dangerous state
  // is the one you have to configure deliberately rather than the one you get by
  // forgetting. An absent secret must never mean "enabled".
  if (Deno.env.get('ENVIRONMENT') !== 'development') {
    return errorResponse('Not available in this environment', 403);
  }

  let body: { action: string; value?: boolean };
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { action, value } = body;
  const supabase = getSupabaseClient();

  // Second factor, deliberately not folded into the environment check above.
  // The environment gate is a deploy-time property and it has already been wrong
  // once, in the direction that opened the door. This one is a property of the
  // caller and holds even if a future deploy sets ENVIRONMENT=development
  // somewhere it should not be. `set_ai_enabled` writes global state; it should
  // never have been reachable by an ordinary member in any environment.
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', auth.userId)
    .maybeSingle();
  if (!profile?.is_staff) return errorResponse('Staff access required', 403);

  // ── get_status ──────────────────────────────────────────────────────────────
  if (action === 'get_status') {
    const { data: aiConfig } = await supabase
      .from('dev_config')
      .select('value')
      .eq('key', 'ai_enabled')
      .maybeSingle();

    const today = new Date().toISOString().split('T')[0];
    const fns = [
      'roxy-greeting',
      'roxy-icebreaker',
      'roxy-wingwoman',
      'roxy-nudge',
      'roxy-sister',
      'roxy-onboarding',
    ];

    const counts: Record<string, number> = {};
    for (const fn of fns) {
      const { count } = await supabase
        .from('ai_call_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', auth.userId)
        .eq('function_name', fn)
        .gte('called_at', `${today}T00:00:00.000Z`);
      counts[fn] = count ?? 0;
    }

    return successResponse({
      ai_enabled: aiConfig?.value !== 'false',
      call_counts: counts,
    });
  }

  // ── set_ai_enabled ──────────────────────────────────────────────────────────
  if (action === 'set_ai_enabled') {
    await supabase
      .from('dev_config')
      .upsert({ key: 'ai_enabled', value: value ? 'true' : 'false' });
    return successResponse({ ai_enabled: value });
  }

  // ── reset_counters ──────────────────────────────────────────────────────────
  if (action === 'reset_counters') {
    const today = new Date().toISOString().split('T')[0];
    // rate-limit-ledger-exempt: clearing the caller's own caps is the entire
    // purpose of this action, and it is staff-only in a development environment
    // by the two gates above. Until 2026-08-07 it was neither: an unset
    // ENVIRONMENT left this reachable on production by any member, which made it
    // a total bypass of every daily cap that works.
    await supabase
      .from('ai_call_log')
      .delete()
      .eq('user_id', auth.userId)
      .gte('called_at', `${today}T00:00:00.000Z`);
    return successResponse({ reset: true });
  }

  // ── clear_greeting_cache ────────────────────────────────────────────────────
  if (action === 'clear_greeting_cache') {
    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('roxy_greetings')
      .delete()
      .eq('user_id', auth.userId)
      .eq('generated_date', today);
    return successResponse({ cleared: true });
  }

  // ── seed_speed_date_session ─────────────────────────────────────────────────
  if (action === 'seed_speed_date_session') {
    // Due now, exactly like a real queue join (join-speed-date-session stamps
    // scheduled_at with the moment of the insert). This used to seed two
    // minutes into the future, which since migration 077 means "an advance
    // booking, not a queue entry" -- claim_speed_date_partner would skip it and
    // the seeded session could never be paired with, which is the one thing
    // this action exists to let us test.
    const scheduledAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('speed_date_sessions')
      .insert({
        scheduled_at: scheduledAt,
        duration_seconds: 300,
        participant_ids: [auth.userId],
        status: 'scheduled',
        prompts: DEV_MOCK_PROMPTS,
      })
      .select()
      .single();

    if (error) return errorResponse(error.message);
    return successResponse({ session: data });
  }

  return errorResponse('Unknown action', 400);
});
