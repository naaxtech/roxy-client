// supabase/functions/daily-webhook/index.ts
// Called by Daily.co when participants join/leave rooms.
// Auth: Daily's webhook HMAC, NOT a Supabase JWT (verify_jwt = false in
// config.toml). Verification lives in _shared/webhookSignatures.ts (tested).
//
// Daily's scheme (docs.daily.co/reference/rest-api/webhooks, "hmac"):
//   X-Webhook-Signature = base64(HMAC-SHA256(base64decode(DAILY_WEBHOOK_SECRET),
//                                            X-Webhook-Timestamp + '.' + rawBody))
// DAILY_WEBHOOK_SECRET is the base64 `hmac` returned by (or passed to)
// POST /webhooks. Pass your own hmac when creating the webhook so Daily's
// signed {"test":"test"} probe verifies too (it must get a 200 within 8 s).
//
// Before this change the handler checked `x-daily-signature` against
// 'v1=' + hex(HMAC(utf8 secret, body)) — a header and scheme Daily never sends
// — and read `event_type` / `payload.room.name`, while Daily sends `type`
// ('participant.joined') with `payload.room` as a string. No real callback
// could ever be counted.
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { verifyDailySignature } from '../_shared/webhookSignatures.ts';

type DailyEvent = {
  type?: string;
  event_type?: string; // older shape, kept so a replayed legacy body still parses
  payload?: { room?: string | { name?: string } };
  test?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const rawBody = await req.text();
  const ok = await verifyDailySignature({
    secret: Deno.env.get('DAILY_WEBHOOK_SECRET'),
    signature: req.headers.get('X-Webhook-Signature'),
    timestamp: req.headers.get('X-Webhook-Timestamp'),
    rawBody,
  });
  if (!ok) return errorResponse('Invalid signature', 401);

  let event: DailyEvent;
  try { event = JSON.parse(rawBody); } catch { return errorResponse('Invalid JSON', 400); }

  // Daily's creation / re-activation probe: signed, carries no event.
  if (event.test !== undefined && !event.type && !event.event_type) {
    return successResponse({ ok: true });
  }

  const eventType = (event.type ?? event.event_type ?? '').replace('-', '.');
  const room = event.payload?.room;
  const roomName = typeof room === 'string' ? room : room?.name;
  if (!roomName) return successResponse({ ignored: 'no room name' });

  const supabase = getSupabaseClient();
  if (eventType === 'participant.joined') {
    const { error } = await supabase.rpc('increment_participant_count', { p_room_name: roomName });
    if (error) console.error('[daily-webhook] increment failed:', error.code);
  } else if (eventType === 'participant.left') {
    const { error } = await supabase.rpc('decrement_participant_count', { p_room_name: roomName });
    if (error) console.error('[daily-webhook] decrement failed:', error.code);
  }

  return successResponse({ processed: eventType });
});
