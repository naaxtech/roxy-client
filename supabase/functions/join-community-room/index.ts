import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import {
  createMeetingToken,
  dailyRoomName,
  ensureDailyRoom,
  roomNameFromUrl,
} from '../_shared/daily.ts';

const DEV_MOCK_ROOM_URL = 'https://roxy.daily.co/dev-room';

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

  // Fail closed, loudly in the logs and vaguely to the client: the operator
  // needs the variable name, the user does not. The value is never logged.
  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) {
    console.error('join-community-room: DAILY_API_KEY is not set — every room join will fail');
    return errorResponse('Live rooms are temporarily unavailable', 503);
  }

  const supabase = getSupabaseClient();

  // Fetch room
  const { data: room, error: roomError } = await supabase
    .from('community_rooms')
    .select('id, name, daily_room_url, daily_room_name, community_id, room_type, status, created_by, max_participants')
    .eq('id', room_id)
    .single();

  if (roomError || !room) return errorResponse('Room not found', 404);
  if (room.status === 'scheduled') return errorResponse('Room has not started yet', 409);
  if (room.status === 'closed')    return errorResponse('Room is closed', 410);

  // Resolve the Daily room, confirming it still exists rather than trusting the
  // stored URL. Prefer the stored name, then the name inside a stored URL, then
  // the shared fallback — so this and manage-room always land on one room.
  const storedName = room.daily_room_name as string | null;
  const storedUrl  = room.daily_room_url  as string | null;
  const roomName = storedName
    ?? (storedUrl ? roomNameFromUrl(storedUrl) : null)
    ?? dailyRoomName(room_id);

  let roomUrl: string;
  try {
    const ensured = await ensureDailyRoom(
      roomName, room.max_participants as number | null, dailyApiKey,
    );
    roomUrl = ensured.url;
  } catch (e) {
    // Legible server-side cause; no key, no token, no user identifiers.
    console.error(
      `join-community-room: could not provision room_id=${room_id} reason=${e instanceof Error ? e.message : 'unknown'}`,
    );
    return errorResponse('Could not reach the video service', 502);
  }

  if (roomUrl !== storedUrl || roomName !== storedName) {
    await supabase
      .from('community_rooms')
      .update({ daily_room_url: roomUrl, daily_room_name: roomName })
      .eq('id', room_id);
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

  // Create meeting token — required for private rooms
  let token: string;
  try {
    token = await createMeetingToken(roomName, displayName, auth.userId, isOwner, dailyApiKey);
  } catch (e) {
    console.error(
      `join-community-room: token mint failed room_id=${room_id} reason=${e instanceof Error ? e.message : 'unknown'}`,
    );
    return errorResponse('Could not reach the video service', 502);
  }

  return successResponse({
    room_url:              roomUrl,
    room_name:             room.name,
    room_type:             room.room_type,
    community_id:          room.community_id,
    token:                 token,
    is_host:               isOwner,
    creator_display_name:  creatorDisplayName,
  });
});
