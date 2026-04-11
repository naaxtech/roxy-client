import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const DEV_MOCK_ROOM_URL = 'https://roxy.daily.co/dev-room';

async function getOrCreateDailyRoom(roomName: string, apiKey: string): Promise<string> {
  const getRes = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (getRes.ok) {
    const room = await getRes.json();
    return room.url;
  }
  const createRes = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: roomName,
      properties: {
        max_participants: 50,
        enable_chat: true,
        enable_screenshare: false,
        exp: Math.floor(Date.now() / 1000) + 7200,
        eject_at_room_exp: true,
      },
    }),
  });
  if (!createRes.ok) throw new Error(`Daily.co room creation failed: ${await createRes.text()}`);
  return (await createRes.json()).url;
}

async function createMeetingToken(
  roomName: string,
  userName: string,
  userId: string,
  isOwner: boolean,
  apiKey: string,
): Promise<string> {
  const res = await fetch('https://api.daily.co/v1/meeting-tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        user_id: userId,
        is_owner: isOwner,
        start_audio_off: true,
        eject_at_room_exp: true,
      },
    }),
  });
  if (!res.ok) throw new Error(`Meeting token creation failed: ${await res.text()}`);
  return (await res.json()).token;
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

  if (DEV_MOCK) {
    return successResponse({
      room_url: DEV_MOCK_ROOM_URL,
      room_name: 'Dev Room',
      room_type: 'video',
      community_id: 'mock',
      token: null,
      is_host: true,
      creator_display_name: 'Dev Host',
    });
  }

  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) return errorResponse('DAILY_API_KEY not configured', 503);

  const supabase = getSupabaseClient();

  // Fetch room
  const { data: room, error: roomError } = await supabase
    .from('community_rooms')
    .select('id, name, daily_room_url, daily_room_name, community_id, room_type, status, created_by')
    .eq('id', room_id)
    .single();

  if (roomError || !room) return errorResponse('Room not found', 404);
  if (room.status === 'scheduled') return errorResponse('Room has not started yet', 409);
  if (room.status === 'closed')    return errorResponse('Room is closed', 410);

  // Get or create Daily.co room
  const roomName = room.daily_room_name ?? `roxy-community-${room_id.slice(0, 8)}`;
  let roomUrl = room.daily_room_url as string | null;

  if (!roomUrl) {
    try {
      roomUrl = await getOrCreateDailyRoom(roomName, dailyApiKey);
      await supabase
        .from('community_rooms')
        .update({ daily_room_url: roomUrl, daily_room_name: roomName })
        .eq('id', room_id);
    } catch (e) {
      return errorResponse(`Failed to create video room: ${e instanceof Error ? e.message : 'unknown'}`, 500);
    }
  }

  // Determine if joining user is admin/moderator
  const [profileRes, memberRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', auth.userId)
      .single(),
    supabase
      .from('community_members')
      .select('role')
      .eq('community_id', room.community_id)
      .eq('user_id', auth.userId)
      .single(),
  ]);

  // Block non-members from joining
  if (!memberRes.data && auth.userId !== room.created_by) {
    return errorResponse('You are not a member of this community', 403);
  }

  const displayName = profileRes.data?.display_name ?? 'Guest';
  const role = memberRes.data?.role ?? 'member';
  const isOwner = role === 'admin' || role === 'moderator' || auth.userId === room.created_by;

  // Get creator display name
  let creatorDisplayName: string | null = null;
  if (room.created_by) {
    const { data: creator } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', room.created_by)
      .single();
    creatorDisplayName = creator?.display_name ?? null;
  }

  // Create meeting token
  let token: string | null = null;
  try {
    token = await createMeetingToken(roomName, displayName, auth.userId, isOwner, dailyApiKey);
  } catch (e) {
    // Non-fatal — fall back to tokenless join (room must be open access)
    console.error('Meeting token creation failed, falling back to tokenless join:', e);
  }

  return successResponse({
    room_url: roomUrl,
    room_name: room.name,
    room_type: room.room_type,
    community_id: room.community_id,
    token,
    is_host: isOwner,
    creator_display_name: creatorDisplayName,
  });
});
