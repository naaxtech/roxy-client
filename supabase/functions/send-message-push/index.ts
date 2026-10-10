import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

/**
 * DEPRECATED — KEPT ON PURPOSE, now a no-op. Do not delete without asking.
 *
 * History: the first push path (session 2026-09-20). The SENDER's client called
 * this right after posting a DM, so delivery depended on her phone staying
 * online and on an EXPO_ACCESS_TOKEN secret that was never set on production —
 * which is why no push ever arrived. Only DMs were covered.
 *
 * Since migration 129 every notification row (DM, channel, friend, event) is
 * queued in push_outbox and delivered by push-dispatch, server-side, with
 * preferences, quiet hours, mute/block checks and lock-screen privacy. If this
 * function still sent, every DM would arrive twice. It stays deployed and
 * answers { sent: 0 } so app builds that still call it (every APK before the
 * 129 release) keep working without an error.
 *
 * Original description: send an Expo push to the recipient of a direct message.
 */
Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  return successResponse({ sent: 0, deprecated: 'push-dispatch delivers this notification' });
});

// The original body, kept for reference (unreachable):
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function legacySendMessagePush(req: Request) {
  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, message_preview } = body as {
    conversation_id?: string;
    message_preview?: string | null;
  };
  if (!conversation_id) return errorResponse('conversation_id required', 400);

  const supabase = getSupabaseClient();

  const { data: conv } = await supabase
    .from('conversations')
    .select('participant_ids')
    .eq('id', conversation_id)
    .maybeSingle();
  const participants = (conv as { participant_ids?: string[] } | null)?.participant_ids ?? [];
  const recipient = participants.find((id) => id !== auth.userId);
  if (!recipient) return successResponse({ sent: 0 });

  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', recipient);
  if (!tokens || tokens.length === 0) return successResponse({ sent: 0 });

  const { data: sender } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', auth.userId)
    .maybeSingle();

  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (!accessToken) return errorResponse('EXPO_ACCESS_TOKEN not configured', 500);

  const payload = (tokens as { token: string }[]).map((t) => ({
    to: t.token,
    title: (sender as { display_name?: string } | null)?.display_name ?? 'Roxy',
    body: message_preview ?? 'sent you a message',
    data: { url: `roxy://chat/${conversation_id}` },
  }));

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return errorResponse(`Expo push failed: ${res.status}`, 502);
  return successResponse({ sent: payload.length });
}
