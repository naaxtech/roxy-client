import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

async function getOrCreateDailyRoom(roomName: string, maxParticipants = 25): Promise<string> {
  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) throw new Error('DAILY_API_KEY not configured');

  const getRes = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${dailyApiKey}` },
  });
  if (getRes.ok) {
    const room = await getRes.json();
    return room.url;
  }

  const createRes = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${dailyApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: roomName,
      properties: {
        max_participants: maxParticipants,
        enable_chat: true,
        enable_screenshare: false,
        exp: Math.floor(Date.now() / 1000) + 7200,
        eject_at_room_exp: true,
      },
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Daily.co room creation failed: ${err}`);
  }
  const room = await createRes.json();
  return room.url;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { room_id } = body;
  if (!room_id) return errorResponse('room_id required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const supabase = getSupabaseClient();

  if (DEV_MOCK) {
    return successResponse({
      room_url: 'https://roxy.daily.co/dev-room',
      room_name: 'Dev Room',
      room_type: 'video',
      community_id: 'mock',
    });
  }

  const { data: room, error: roomError } = await supabase
    .from('community_rooms')
    .select('id, name, daily_room_url, daily_room_name, community_id, room_type')
    .eq('id', room_id)
    .eq('is_active', true)
    .single();

  if (roomError || !room) return errorResponse('Room not found', 404);

  let roomUrl = room.daily_room_url as string | null;
  const roomName = room.daily_room_name ?? `roxy-community-${room_id.slice(0, 8)}`;

  if (!roomUrl) {
    try {
      roomUrl = await getOrCreateDailyRoom(roomName);
      await supabase
        .from('community_rooms')
        .update({ daily_room_url: roomUrl, daily_room_name: roomName })
        .eq('id', room_id);
    } catch (e) {
      return errorResponse(
        `Failed to create video room: ${e instanceof Error ? e.message : 'unknown'}`,
        500,
      );
    }
  }

  return successResponse({
    room_url: roomUrl,
    room_name: room.name,
    room_type: room.room_type,
    community_id: room.community_id,
  });
});
