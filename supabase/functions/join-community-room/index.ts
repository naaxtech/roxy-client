import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import {
  RoomClaimError,
  createMeetingToken,
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
  // stored URL. ensureDailyRoom derives the name from the row id itself, so this
  // and manage-room always land on one room and can never land on another row's.
  const storedName = room.daily_room_name as string | null;
  const storedUrl  = room.daily_room_url  as string | null;

  // Only follow a stored name while a call is actually in progress. A room that
  // is not live has nobody to keep together, so there is nothing to preserve and
  // ensureDailyRoom mints the collision-free canonical name instead — which is
  // what retires the pre-fix short names without cutting anyone off mid-call.
  const offeredName = room.status === 'live'
    ? (storedName ?? (storedUrl ? roomNameFromUrl(storedUrl) : null))
    : null;

  // room.id, not the request body: the row is the authority for its own name.
  const identity = { roomId: room.id as string, storedName: offeredName };

  let ensured: { url: string; name: string };
  try {
    ensured = await ensureDailyRoom(
      identity, room.max_participants as number | null, dailyApiKey,
    );
  } catch (e) {
    if (e instanceof RoomClaimError) {
      // The row points at a Daily room it cannot prove is its own. Joining it
      // could put her in another community's call, so refuse and make a host
      // reopen — never retry, and never fall back to the stored name.
      console.error('join-community-room: refused a daily room this row has no claim to');
      return errorResponse('This room needs to be reopened by a host', 409);
    }
    // Legible server-side cause; no key, no token, no identifiers.
    console.error(
      `join-community-room: could not provision room reason=${e instanceof Error ? e.message : 'unknown'}`,
    );
    return errorResponse('Could not reach the video service', 502);
  }

  const roomUrl = ensured.url;
  const roomName = ensured.name;

  if (roomUrl !== storedUrl || roomName !== storedName) {
    await supabase
      .from('community_rooms')
      .update({ daily_room_url: roomUrl, daily_room_name: roomName })
      .eq('id', room.id);
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
      `join-community-room: token mint failed reason=${e instanceof Error ? e.message : 'unknown'}`,
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
