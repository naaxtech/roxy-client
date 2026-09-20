import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { callClaude } from '../_shared/claude.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const CRISIS_KEYWORDS = ['suicide', 'kill myself', 'end it', 'hurt myself', 'self harm', 'want to die', "can't go on"];

const RESOURCES = [
  { name: 'Crisis Text Line', contact: 'Text HOME to 741741', type: 'text' },
  { name: 'The Trevor Project', contact: '1-866-488-7386', type: 'call' },
  { name: 'Trans Lifeline', contact: '877-565-8860', type: 'call' },
  { name: 'LGBTQ+ National Hotline', contact: '1-888-843-4564', type: 'call' },
];

const PROFESSIONAL_DIRECTORY = [
  { name: 'Psychology Today (LGBTQ+ filter)', url: 'psychologytoday.com/us/therapists/lesbian-gay-bisexual-transgender' },
  { name: 'GLMA Provider Directory', url: 'glma.org/index.cfm?fuseaction=Page.viewPage&pageId=940' },
  { name: 'National Queer & Trans Therapists of Color', url: 'nqttcn.com/directory' },
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, message } = body;
  if (!conversation_id || !message) return errorResponse('conversation_id and message required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  // 'allow' on limiter failure: the Sister Button is reached at a hard moment,
  // and a database blip is not a reason to refuse her the turn.
  const { allowed, currentCount } = await consumeRateLimit({
    userId: auth.userId,
    fnName: 'roxy-sister',
    maxCount: 10,
    windowType: 'conversation',
    conversationId: conversation_id,
    wasMock: DEV_MOCK,
    onLimiterFailure: 'allow',
  });
  if (!allowed) return errorResponse('Session limit reached — please connect with a professional', 429);

  const supabase = getSupabaseClient();

  // Server-authoritative turn number, straight from the limiter that just
  // recorded this turn. `currentCount` after a successful consume is the count
  // INCLUDING this call, which is exactly the turn number.
  //
  // This replaces a second, independent count of the same table that ran right
  // here. Two problems with it: it duplicated the limiter's own query, and it
  // read `count ?? 0`, discarding `error` — so any query failure silently reset
  // her to turn 1, re-showing the opening prompt and pushing the crisis
  // resources and the pro directory (turn >= 7 and >= 10 below) back out of
  // reach at the moment she most needed them.
  const turnNumber = currentCount;

  const isCrisis = CRISIS_KEYWORDS.some((kw) => message.toLowerCase().includes(kw));
  const showResources = isCrisis || turnNumber >= 7;
  const showDirectory = turnNumber >= 10;

  const systemPrompt = turnNumber <= 6 && !isCrisis
    ? `You are Roxy Sister, a compassionate mental health companion for WLW and queer women. Listen deeply, validate feelings, ask one gentle follow-up question. Never give clinical advice. Be warm and affirming. Max 3 sentences.`
    : `You are Roxy Sister, a compassionate companion. The user may need professional support. Validate their feelings briefly (1 sentence), gently mention that a professional can offer deeper support (1 sentence), and affirm you're here. Max 2 sentences.`;

  const mockResponse = turnNumber <= 6 && !isCrisis
    ? 'Thank you for sharing that with me — you\'re so brave for reaching out 💜 What feels most heavy for you right now?'
    : 'You deserve real support, and talking to a professional can make such a difference 💜 I\'m here with you.';

  const response = await callClaude({
    system: systemPrompt,
    messages: [{ role: 'user', content: message }],
    maxTokens: 200,
    mockResponse,
  });

  // The slot was consumed before the call — the write is the count now.

  return successResponse({
    response,
    turn_number: turnNumber,
    is_final_turn: turnNumber >= 10,
    resources: showResources ? RESOURCES : undefined,
    professional_directory: showDirectory ? PROFESSIONAL_DIRECTORY : undefined,
  });
});
