import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

async function getOrCreateDailyRoom(sessionId: string): Promise<string> {
  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) throw new Error('DAILY_API_KEY not configured');

  const roomName = `roxy-speed-date-${sessionId.slice(0, 8)}`;

  // Try to get existing room first
  const getRes = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${dailyApiKey}` },
  });

  if (getRes.ok) {
    const room = await getRes.json();
    return room.url;
  }

  // Create new room
  const createRes = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${dailyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: roomName,
      properties: {
        max_participants: 2,
        enable_chat: false,
        enable_screenshare: false,
        exp: Math.floor(Date.now() / 1000) + 3600, // 1hr from now
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
  const { session_id } = body;
  if (!session_id) return errorResponse('session_id required', 400);

  const supabase = getSupabaseClient();

  // Fetch session
  const { data: session, error: sessionError } = await supabase
    .from('speed_date_sessions')
    .select('*')
    .eq('id', session_id)
    .single();

  if (sessionError || !session) return errorResponse('Session not found', 404);

  if (session.status === 'completed') return errorResponse('Session already completed', 400);

  // Check not already at capacity (2 participants for speed dating)
  if (session.participant_ids.length >= 2 && !session.participant_ids.includes(auth.userId)) {
    return errorResponse('Session is full', 409);
  }

  // Get or create Daily.co room
  let roomUrl = session.daily_room_url;
  if (!roomUrl) {
    try {
      roomUrl = await getOrCreateDailyRoom(session_id);
    } catch (e) {
      return errorResponse(`Failed to create video room: ${e instanceof Error ? e.message : 'unknown'}`, 500);
    }
  }

  // Add participant if not already in list
  const participants = session.participant_ids.includes(auth.userId)
    ? session.participant_ids
    : [...session.participant_ids, auth.userId];

  const newStatus = participants.length >= 2 ? 'active' : 'scheduled';

  const { error: updateError } = await supabase
    .from('speed_date_sessions')
    .update({
      daily_room_url: roomUrl,
      participant_ids: participants,
      status: newStatus,
    })
    .eq('id', session_id);

  if (updateError) return errorResponse('Failed to update session', 500);

  return successResponse({
    room_url: roomUrl,
    session_id,
    status: newStatus,
    participant_count: participants.length,
  });
});
