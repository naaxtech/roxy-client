// supabase/functions/feature-vote/index.ts
// Actions:
//   pitch  — submit a new community feature idea (POST { action:'pitch', title, description })
//   vote   — toggle vote on a feature      (POST { action:'vote',  feature_id })
//   list   — fetch features + user's votes (POST { action:'list',  type?:'planned'|'pitched' })

import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const { action } = body as { action?: string };

  // ─── LIST ────────────────────────────────────────────────────────────────
  if (action === 'list') {
    const type = (body.type as string | undefined) ?? null;

    if (DEV_MOCK) {
      return successResponse({
        features: [
          { id: 'mock-1', title: 'Dark mode', description: 'Full dark theme', type: 'planned', status: 'in_progress', vote_count: 42, created_at: new Date().toISOString() },
          { id: 'mock-2', title: 'Voice messages', description: 'Send voice notes', type: 'planned', status: 'open', vote_count: 28, created_at: new Date().toISOString() },
        ],
        voted_ids: [],
      });
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from('feature_requests')
      .select('id, title, description, type, status, vote_count, created_at')
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);

    if (type) query = query.eq('type', type);

    const { data: features, error: featErr } = await query;
    if (featErr) return errorResponse(featErr.message, 500);

    const { data: votes } = await supabase
      .from('feature_votes')
      .select('feature_id')
      .eq('user_id', userId);

    const voted_ids = (votes ?? []).map((v: any) => v.feature_id);
    return successResponse({ features: features ?? [], voted_ids });
  }

  // ─── VOTE / UNVOTE ───────────────────────────────────────────────────────
  if (action === 'vote') {
    const feature_id = body.feature_id as string | undefined;
    if (!feature_id) return errorResponse('Missing feature_id', 400);

    if (DEV_MOCK) return successResponse({ voted: true, vote_count: 1 });

    const supabase = getSupabaseClient();

    // Check if already voted
    const { data: existing } = await supabase
      .from('feature_votes')
      .select('id')
      .eq('feature_id', feature_id)
      .eq('user_id', userId)
      .maybeSingle();

    let voted: boolean;
    if (existing) {
      // Remove vote
      await supabase.from('feature_votes').delete()
        .eq('feature_id', feature_id).eq('user_id', userId);
      voted = false;
    } else {
      // Add vote
      const { error } = await supabase.from('feature_votes').insert({ feature_id, user_id: userId });
      if (error) return errorResponse(error.message, 500);
      voted = true;
    }

    const { data: fr } = await supabase
      .from('feature_requests')
      .select('vote_count')
      .eq('id', feature_id)
      .single();

    return successResponse({ voted, vote_count: fr?.vote_count ?? 0 });
  }

  // ─── PITCH ───────────────────────────────────────────────────────────────
  if (action === 'pitch') {
    const title = (body.title as string | undefined)?.trim();
    const description = (body.description as string | undefined)?.trim() || null;

    if (!title || title.length < 3) return errorResponse('Title too short (min 3 chars)', 400);
    if (title.length > 200) return errorResponse('Title too long (max 200 chars)', 400);
    if (description && description.length < 10) return errorResponse('Description too short (min 10 chars)', 400);
    if (description && description.length > 1000) return errorResponse('Description too long (max 1000 chars)', 400);

    if (DEV_MOCK) return successResponse({ id: 'mock-pitch', title, description });

    const supabase = getSupabaseClient();
    const { data: feature, error: insertErr } = await supabase
      .from('feature_requests')
      .insert({ title, description, type: 'pitched', created_by: userId })
      .select('id, title, description')
      .single();

    if (insertErr) return errorResponse(insertErr.message, 500);

    // Auto-vote own pitch
    await supabase.from('feature_votes').insert({ feature_id: feature.id, user_id: userId }).then(() => {});

    // n8n webhook notification (non-fatal)
    const webhookUrl = Deno.env.get('N8N_WEBHOOK_URL');
    if (webhookUrl && feature) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'new_feature_pitch',
            feature_id: feature.id,
            title: feature.title,
            description: feature.description,
            submitted_by: userId,
            submitted_at: new Date().toISOString(),
          }),
        });
        await supabase
          .from('feature_requests')
          .update({ webhook_notified: true })
          .eq('id', feature.id);
      } catch (e) {
        console.warn('[feature-vote] webhook failed (non-fatal):', (e as Error).message);
      }
    }

    return successResponse(feature);
  }

  return errorResponse('Unknown action', 400);
});
