import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

/**
 * Send an Expo push to the recipient of a direct message.
 *
 * Called by the sender's client right after a message lands, so a reply reaches
 * a woman who has the app closed. The sender's JWT is verified, the recipient
 * is resolved server-side from the conversation (never from the request body),
 * and tokens are read through the service-role client — the same path 065's
 * RLS comment names.
 *
 * Requires the `EXPO_ACCESS_TOKEN` secret (the project's Expo Push access
 * token, from expo.dev/settings/push-notifications). Without it this returns
 * 500 rather than half-sending.
 */
Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

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
});
