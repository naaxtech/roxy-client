// supabase/functions/manage-room/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { dailyRoomName, deleteDailyRoom, ensureDailyRoom } from '../_shared/daily.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  let action: string, roomId: string | undefined, communityId: string | undefined,
      name: string | undefined, description: string | undefined, roomType: string | undefined,
      scheduledAt: string | null | undefined, maxParticipants: number | null | undefined,
      // Every other field is lifted out of the try block below; this one never
      // was, so the sync-count branch referenced `body` from a scope it had
      // already left. It did not compile, which means that action has never
      // run — the host's authoritative participant count was silently dropped.
      participantCount: unknown;

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
    participantCount = body.count;
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

  // ── SYNC-COUNT (host pushes authoritative participant count) ─────────────
  if (action === 'sync-count') {
    const count = typeof participantCount === 'number' ? Math.max(0, participantCount) : null;
    if (count === null) return errorResponse('count required', 400);
    const { error } = await supabase
      .from('community_rooms')
      .update({ participant_count: count })
      .eq('id', roomId);
    if (error) return errorResponse(error.message, 500);
    return successResponse({ synced: true });
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

    if (!dailyApiKey) {
      // Operator-actionable, and the one failure a host cannot fix themselves.
      // Logged with the variable name so it is greppable and unmistakable next
      // to a genuine Daily outage; the value itself is never logged.
      console.error('manage-room: DAILY_API_KEY is not set — no room can be opened');
      return errorResponse('Live rooms are not configured (DAILY_API_KEY is unset)', 503);
    }

    // Always resolve through ensureDailyRoom rather than trusting the stored
    // URL. A previously-opened room whose 12h `exp` has passed no longer exists
    // on Daily even though the row still holds its URL, and a room that DOES
    // still exist makes a blind create fail — Daily refuses a duplicate name,
    // which surfaced as a 500 on the host's second "Go Live".
    const roomName = (room.daily_room_name as string | null) ?? dailyRoomName(roomId);

    let ensured: { url: string; name: string };
    try {
      ensured = await ensureDailyRoom(roomName, room.max_participants as number | null, dailyApiKey);
    } catch (e) {
      console.error(
        `manage-room: could not provision room_id=${roomId} reason=${e instanceof Error ? e.message : 'unknown'}`,
      );
      return errorResponse('Could not reach the video service', 502);
    }

    const { error } = await supabase.from('community_rooms').update({
      status:          'live',
      started_at:      new Date().toISOString(),
      ended_at:        null,
      daily_room_name: ensured.name,
      daily_room_url:  ensured.url,
      is_active:       true,
    }).eq('id', roomId);

    if (error) return errorResponse(error.message, 500);
    return successResponse({ room_id: roomId });
  }

  // ── CLOSE (End Room) ──────────────────────────────────────────────────────
  if (action === 'close') {
    if (room.status === 'closed') return successResponse({ already_closed: true });

    // Deleting the Daily room is what actually ejects everyone still in the
    // call; the row update alone only changes what the UI says. Never let a
    // failure here block the close — a host who pressed "End" must not be left
    // with a room that still reads as live — but never let it pass silently
    // either, because the difference is participants still talking.
    if (!DEV_MOCK && room.daily_room_name) {
      if (!dailyApiKey) {
        console.error(
          `manage-room: DAILY_API_KEY is not set — room_id=${roomId} marked closed but participants were NOT ejected`,
        );
      } else {
        try {
          await deleteDailyRoom(room.daily_room_name as string, dailyApiKey);
        } catch (e) {
          console.error(
            `manage-room: could not delete daily room for room_id=${roomId} reason=${e instanceof Error ? e.message : 'unknown'}`,
          );
        }
      }
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
