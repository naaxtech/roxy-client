// supabase/functions/manage-room/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

async function createDailyRoom(
  roomName: string,
  maxParticipants: number | null,
  apiKey: string,
): Promise<{ url: string; name: string }> {
  const res = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: roomName,
      privacy: 'private',
      properties: {
        exp: Math.floor(Date.now() / 1000) + 43200, // 12h
        max_participants: maxParticipants ?? 50,
        enable_screenshare: true,
        enable_chat: false,
        start_video_off: false,
        start_audio_off: false,
        eject_at_room_exp: true,
      },
    }),
  });
  if (!res.ok) throw new Error(`Daily.co room creation failed: ${await res.text()}`);
  const room = await res.json();
  return { url: room.url, name: room.name };
}

async function deleteDailyRoom(roomName: string, apiKey: string): Promise<void> {
  await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  let action: string, roomId: string | undefined, communityId: string | undefined,
      name: string | undefined, description: string | undefined, roomType: string | undefined,
      scheduledAt: string | null | undefined, maxParticipants: number | null | undefined;

  try {
    const body = await req.json();
    action           = body.action;
    roomId           = body.room_id;
    communityId      = body.community_id;
    name             = body.name;
    description      = body.description;
    roomType         = body.room_type;
    scheduledAt      = body.scheduled_at;
    maxParticipants  = body.max_participants;
  } catch { return errorResponse('Invalid body', 400); }

  if (!action) return errorResponse('action required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
  const supabase = getSupabaseClient();
  const dailyApiKey = Deno.env.get('DAILY_API_KEY');

  // ── CREATE ────────────────────────────────────────────────────────────────
  if (action === 'create') {
    if (!communityId || !name) return errorResponse('community_id and name required', 400);

    const { data: membership } = await supabase
      .from('community_members')
      .select('role')
      .eq('community_id', communityId)
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (!membership || !['admin', 'moderator'].includes(membership.role)) {
      return errorResponse('Only community admins or moderators can create rooms', 403);
    }

    const status = scheduledAt ? 'scheduled' : 'idle';
    const { data: room, error } = await supabase
      .from('community_rooms')
      .insert({
        community_id:     communityId,
        name:             name.trim(),
        description:      description?.trim() ?? null,
        room_type:        roomType ?? 'video',
        scheduled_at:     scheduledAt ?? null,
        max_participants: maxParticipants ?? null,
        created_by:       auth.userId,
        status,
        is_active:        false,
      })
      .select('id')
      .single();

    if (error) return errorResponse(error.message, 500);
    return successResponse({ room_id: room.id });
  }

  // All other actions require room_id
  if (!roomId) return errorResponse('room_id required', 400);

  const { data: room } = await supabase
    .from('community_rooms')
    .select('id, name, status, created_by, community_id, daily_room_name, daily_room_url, max_participants')
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

  // ── UPDATE ────────────────────────────────────────────────────────────────
  if (action === 'update') {
    const updates: Record<string, unknown> = {};
    if (name             !== undefined) updates.name             = name.trim();
    if (description      !== undefined) updates.description      = description?.trim() ?? null;
    if (roomType         !== undefined) updates.room_type        = roomType;
    if (maxParticipants  !== undefined) updates.max_participants = maxParticipants;
    if (scheduledAt      !== undefined) {
      updates.scheduled_at = scheduledAt;
      if (scheduledAt && room.status === 'idle')      updates.status = 'scheduled';
      if (!scheduledAt && room.status === 'scheduled') updates.status = 'idle';
    }
    if (Object.keys(updates).length === 0) return errorResponse('No fields to update', 400);
    const { error } = await supabase.from('community_rooms').update(updates).eq('id', roomId);
    if (error) return errorResponse(error.message, 500);
    return successResponse({ updated: true });
  }

  // ── OPEN (Go Live) ────────────────────────────────────────────────────────
  if (action === 'open') {
    if (room.status === 'live') return successResponse({ already_live: true, room_id: roomId });

    if (DEV_MOCK) {
      await supabase.from('community_rooms')
        .update({ status: 'live', started_at: new Date().toISOString(), is_active: true })
        .eq('id', roomId);
      return successResponse({ room_id: roomId });
    }

    if (!dailyApiKey) return errorResponse('DAILY_API_KEY not configured', 503);

    let dailyRoomName = (room.daily_room_name as string | null) ?? `roxy-room-${roomId.slice(0, 8)}`;
    let dailyRoomUrl  = room.daily_room_url as string | null;

    if (!dailyRoomUrl) {
      try {
        const created = await createDailyRoom(dailyRoomName, room.max_participants as number | null, dailyApiKey);
        dailyRoomUrl  = created.url;
        dailyRoomName = created.name;
      } catch (e) {
        return errorResponse(e instanceof Error ? e.message : 'Failed to create video room', 500);
      }
    }

    const { error } = await supabase.from('community_rooms').update({
      status:          'live',
      started_at:      new Date().toISOString(),
      daily_room_name: dailyRoomName,
      daily_room_url:  dailyRoomUrl,
      is_active:       true,
    }).eq('id', roomId);

    if (error) return errorResponse(error.message, 500);
    return successResponse({ room_id: roomId });
  }

  // ── CLOSE (End Room) ──────────────────────────────────────────────────────
  if (action === 'close') {
    if (room.status === 'closed') return successResponse({ already_closed: true });

    if (!DEV_MOCK && dailyApiKey && room.daily_room_name) {
      await deleteDailyRoom(room.daily_room_name as string, dailyApiKey);
    }

    const { error } = await supabase.from('community_rooms').update({
      status:    'closed',
      ended_at:  new Date().toISOString(),
      is_active: false,
    }).eq('id', roomId);

    if (error) return errorResponse(error.message, 500);
    return successResponse({ closed: true });
  }

  return errorResponse(`Unknown action: ${action}`, 400);
});
