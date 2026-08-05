// supabase/functions/kick-participant/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  let roomId: string, sessionId: string;
  try {
    const body = await req.json();
    roomId    = body.room_id;
    sessionId = body.session_id; // Daily.co participant session_id
  } catch { return errorResponse('Invalid body', 400); }

  if (!roomId || !sessionId) return errorResponse('room_id and session_id required', 400);

  const supabase = getSupabaseClient();
  const { data: room } = await supabase
    .from('community_rooms')
    .select('created_by, daily_room_name, community_id')
    .eq('id', roomId)
    .single();

  if (!room) return errorResponse('Room not found', 404);

  const { data: membership } = await supabase
    .from('community_members')
    .select('role')
    .eq('community_id', room.community_id)
    .eq('user_id', auth.userId)
    .maybeSingle();

  const canManage = auth.userId === room.created_by ||
    (membership && ['admin', 'moderator'].includes(membership.role));
  if (!canManage) return errorResponse('Access denied', 403);

  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) {
    console.error('kick-participant: DAILY_API_KEY is not set — no participant can be removed');
    return errorResponse('Live rooms are not configured (DAILY_API_KEY is unset)', 503);
  }

  if (!room.daily_room_name) {
    return errorResponse('This room has no active video session', 409);
  }

  const res = await fetch(`https://api.daily.co/v1/rooms/${room.daily_room_name}/eject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${dailyApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [sessionId] }),
  });

  if (!res.ok) {
    // Daily's body can echo request detail — log it, don't return it.
    console.error(
      `kick-participant: eject failed room_id=${roomId} status=${res.status} body=${await res.text()}`,
    );
    return errorResponse('Could not remove that participant', 502);
  }
  return successResponse({ kicked: true });
});
