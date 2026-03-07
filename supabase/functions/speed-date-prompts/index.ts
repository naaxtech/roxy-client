import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const MOCK_PROMPTS = [
  "What's a skill you've always wanted to learn?",
  "Which place changed how you see yourself?",
  "What's your version of a perfect Sunday?",
  "What's something you believed at 16 you've completely changed your mind on?",
  "If you could live anywhere for a year, where and why?",
  "What's a small thing that always makes your day better?",
  "What are you most proud of that nobody knows about?",
  "Describe your ideal first date in three words.",
  "What's the last book, show, or song that genuinely moved you?",
  "What does home mean to you?",
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json().catch(() => ({}));
  const { session_id } = body;

  if (!session_id) return errorResponse('session_id required', 400);

  const supabase = getSupabaseClient();

  // Verify session exists
  const { data: session, error: sessionError } = await supabase
    .from('speed_date_sessions')
    .select('id, prompts')
    .eq('id', session_id)
    .single();

  if (sessionError || !session) return errorResponse('Session not found', 404);
  if (session.prompts && session.prompts.length >= 10) {
    return successResponse({ prompts: session.prompts, generated: false });
  }

  const mockResponse = JSON.stringify(MOCK_PROMPTS);

  const raw = await callClaude({
    system: `You are Roxy, WLW AI wingwoman. Generate exactly 10 conversation starter prompts for a 5-minute speed date between two WLW users. Prompts must be: light, fun, emotionally interesting (not small talk), queer-affirming and inclusive, varied (one nostalgic, one future-focused, one playful, one values-based). Return ONLY a JSON array of 10 strings. No markdown, no explanation.`,
    messages: [{ role: 'user', content: 'Generate the 10 prompts.' }],
    maxTokens: 512,
    mockResponse,
  });

  let prompts: string[] = MOCK_PROMPTS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 10) {
      prompts = parsed;
    }
  } catch {
    // use mock
  }

  const { error: updateError } = await supabase
    .from('speed_date_sessions')
    .update({ prompts })
    .eq('id', session_id);

  if (updateError) return errorResponse('Failed to store prompts', 500);

  return successResponse({ prompts, generated: true });
});
