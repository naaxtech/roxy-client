// supabase/functions/kick-participant/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { RoomClaimError, ejectParticipants } from '../_shared/daily.ts';
import { isRoxyCore } from '../_shared/roxyCore.ts';

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
    .select('id, created_by, daily_room_name, community_id')
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
    (membership && ['admin', 'moderator'].includes(membership.role)) ||
    await isRoxyCore(supabase, auth.userId);
  if (!canManage) return errorResponse('Access denied', 403);

  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) {
    console.error('kick-participant: DAILY_API_KEY is not set — no participant can be removed');
    return errorResponse('Live rooms are not configured (DAILY_API_KEY is unset)', 503);
  }

  if (!room.daily_room_name) {
    return errorResponse('This room has no active video session', 409);
  }

  // Identity, not a bare name. Without the claim check a moderator of one
  // community could eject members of another whenever the two rows' Daily room
  // names coincided.
  try {
    await ejectParticipants(
      { roomId: room.id as string, storedName: room.daily_room_name as string },
      [sessionId],
      dailyApiKey,
    );
  } catch (e) {
    if (e instanceof RoomClaimError) {
      console.error('kick-participant: refused to eject from a room this row has no claim to');
      return errorResponse('This room has no active video session', 409);
    }
    // Daily's body can echo request detail — never return it.
    console.error(
      `kick-participant: eject failed reason=${e instanceof Error ? e.message : 'unknown'}`,
    );
    return errorResponse('Could not remove that participant', 502);
  }
  return successResponse({ kicked: true });
});
