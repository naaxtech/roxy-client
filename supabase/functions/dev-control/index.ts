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

  // Block in production
  if (Deno.env.get('ENVIRONMENT') === 'production') {
    return errorResponse('Not available in production', 403);
  }

  let body: { action: string; value?: boolean };
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { action, value } = body;
  const supabase = getSupabaseClient();

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
    const scheduledAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
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
