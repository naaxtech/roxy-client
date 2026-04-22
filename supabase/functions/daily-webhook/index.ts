// supabase/functions/daily-webhook/index.ts
// Called by Daily.co when participants join/leave rooms.
// Auth: HMAC-SHA256 signature on request body, NOT a Supabase JWT.
// Deploy with: supabase functions deploy daily-webhook --no-verify-jwt
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get('DAILY_WEBHOOK_SECRET');
  if (!secret || !header) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = 'v1=' + Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  // Constant-time comparison
  if (header.length !== computed.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) {
    diff |= header.charCodeAt(i) ^ computed.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const rawBody = await req.text();
  const sigHeader = req.headers.get('x-daily-signature');

  if (!await verifySignature(rawBody, sigHeader)) {
    return errorResponse('Invalid signature', 401);
  }

  let payload: { event_type: string; payload?: { room?: { name?: string } } };
  try { payload = JSON.parse(rawBody); } catch { return errorResponse('Invalid JSON', 400); }

  const eventType = payload.event_type;
  const roomName  = payload.payload?.room?.name;

  if (!roomName) return successResponse({ ignored: 'no room name' });

  const supabase = getSupabaseClient();

  if (eventType === 'participant-joined') {
    await supabase.rpc('increment_participant_count', { p_room_name: roomName });
  } else if (eventType === 'participant-left') {
    await supabase.rpc('decrement_participant_count', { p_room_name: roomName });
  }

  return successResponse({ processed: eventType });
});
