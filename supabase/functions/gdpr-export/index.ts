import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { assembleExport, type PageFn } from '../_shared/gdprExport.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  // Was checkRateLimit, which counted ai_call_log rows that this function never
  // wrote — so this cap has never fired. 'deny' on limiter failure: an export
  // walks most of her data, and she can ask again shortly.
  const { allowed } = await consumeRateLimit({
    userId: auth.userId,
    fnName: 'gdpr-export',
    maxCount: 5,
    windowType: 'daily',
    onLimiterFailure: 'deny',
  });
  if (!allowed) return errorResponse('Rate limit exceeded', 429);

  if (DEV_MOCK) return successResponse({ ok: true, mock: true, profile: 1, messages: 0, posts: 0 });

  const supabase = getSupabaseClient();

  // PRO-03: this used to return {profile: 1, messages: N, posts: N} — counts,
  // not a copy. Art. 15(3)/20 entitle her to the data itself. The assembler
  // (_shared/gdprExport.ts) reads her own rows from every table that holds
  // them, each query filtered on the column that carries her id (the service
  // role bypasses RLS, so that filter IS the access rule), page by page, and
  // fails the whole export rather than hand her a partial file.
  const page: PageFn = async (table, columns, filters, from, to) => {
    let q = supabase.from(table).select(columns);
    for (const f of filters) q = q.eq(f.col, f.value);
    if (/\bcreated_at\b/.test(columns)) q = q.order('created_at', { ascending: true });
    const { data, error } = await q.range(from, to);
    return {
      data: (data ?? null) as unknown as Record<string, unknown>[] | null,
      error: error ? { code: error.code, message: error.message } : null,
    };
  };

  // Nothing in the invite gate is visible to her anywhere in the app, so it is
  // returned in full: her legal name, her answers, her verification outcomes,
  // her appeals, and which processors received anything. Internal safety
  // assessments and the reviewer audit log stay excluded under Art. 15(4) and
  // are named in `withheld`, so the omission is a disclosed decision.
  const gate = async () => {
    const { data, error } = await supabase.rpc('export_gate_data', { p_user_id: auth.userId });
    if (error) throw new Error('export_gate_data failed');
    return data ?? null;
  };

  try {
    const payload = await assembleExport(auth.userId, page, gate);
    return successResponse({ ok: true, ...payload });
  } catch {
    // No detail in the response or the log: a message could name a table or
    // carry a value. The client says "try again" either way.
    console.error('gdpr-export: assembly failed');
    return errorResponse('Could not assemble your data export.', 500);
  }
});
