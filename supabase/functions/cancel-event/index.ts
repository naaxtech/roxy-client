// supabase/functions/cancel-event/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const { user, errorResponse: authErr } = verifyJWT(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({}));
  const { event_id } = body;

  if (!event_id || !UUID_RE.test(event_id)) {
    return errorResponse('Invalid event_id', 400);
  }

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  await checkRateLimit(user.id, 'cancel-event', 'daily', 5);

  const supabase = getSupabaseClient();

  // Verify caller is host OR staff
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', user.id)
    .maybeSingle();

  const { data: event } = await supabase
    .from('events')
    .select('id, title, host_id, status, community_id')
    .eq('id', event_id)
    .maybeSingle();

  if (!event) return errorResponse('Event not found', 404);
  if (event.status !== 'active') return errorResponse('Event is not active', 400);
  if (event.host_id !== user.id && !(profile as any)?.is_staff) {
    return errorResponse('Forbidden', 403);
  }

  if (DEV_MOCK) {
    return successResponse({ cancelled: true, refunds_queued: 0 });
  }

  const now = new Date().toISOString();

  await supabase
    .from('events')
    .update({
      status: 'cancelled',
      payout_blocked: true,
      cancelled_at: now,
      cancelled_by: user.id,
    })
    .eq('id', event_id);

  const { data: logsToRefund } = await supabase
    .from('payment_logs')
    .update({ needs_refund: true })
    .eq('event_id', event_id)
    .eq('status', 'succeeded')
    .select('buyer_id');

  const refundsQueued = logsToRefund?.length ?? 0;

  // Write audit log if staff action
  if ((profile as any)?.is_staff) {
    await supabase.from('audit_log').insert({
      staff_id: user.id,
      action: 'cancel_event',
      target_type: 'event',
      target_id: event_id,
      metadata: { refunds_queued: refundsQueued, event_title: event.title },
    });
  }

  // OneSignal push — notify buyers of cancellation
  const oneSignalKey = Deno.env.get('ONESIGNAL_REST_API_KEY');
  const oneSignalAppId = Deno.env.get('ONESIGNAL_APP_ID');

  if (oneSignalKey && oneSignalAppId && refundsQueued > 0) {
    const uniqueBuyerIds = [...new Set((logsToRefund ?? []).map((r: any) => r.buyer_id))];

    const { data: buyerProfiles } = await supabase
      .from('profiles')
      .select('push_token')
      .in('id', uniqueBuyerIds)
      .not('push_token', 'is', null);

    const tokens = (buyerProfiles ?? []).map((p: any) => p.push_token).filter(Boolean);

    if (tokens.length > 0) {
      await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${oneSignalKey}`,
        },
        body: JSON.stringify({
          app_id: oneSignalAppId,
          include_player_ids: tokens,
          headings: { en: 'Event Cancelled' },
          contents: {
            en: `${event.title} has been cancelled. Your refund will appear in 5–10 business days.`,
          },
          data: { type: 'event_cancelled', event_id },
        }),
      }).catch((e) => console.error('OneSignal push failed:', e));
    }
  }

  return successResponse({ cancelled: true, refunds_queued: refundsQueued });
});
