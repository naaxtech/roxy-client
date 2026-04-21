import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

async function getOrCreateDailyRoom(sessionId: string): Promise<string> {
  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) throw new Error('DAILY_API_KEY not configured');

  const roomName = `roxy-speed-date-${sessionId.slice(0, 8)}`;

  const getRes = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${dailyApiKey}` },
  });
  if (getRes.ok) {
    const room = await getRes.json();
    return room.url;
  }

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
        exp: Math.floor(Date.now() / 1000) + 3600,
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

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json().catch(() => ({}));
  const { session_id } = body;

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
  const supabase = getSupabaseClient();

  // ── If session_id provided: legacy join-specific-session flow ────────────
  if (session_id) {
    const { data: session, error: sessionError } = await supabase
      .from('speed_date_sessions')
      .select('*')
      .eq('id', session_id)
      .single();

    if (sessionError || !session) return errorResponse('Session not found', 404);
    if (session.status === 'completed') return errorResponse('Session already completed', 400);
    if (session.participant_ids.length >= 2 && !session.participant_ids.includes(auth.userId)) {
      return errorResponse('Session is full', 409);
    }

    let roomUrl = session.daily_room_url;
    if (!roomUrl) {
      try { roomUrl = await getOrCreateDailyRoom(session_id); }
      catch (e) { return errorResponse(`Failed to create video room: ${e instanceof Error ? e.message : 'unknown'}`, 500); }
    }

    const participants = session.participant_ids.includes(auth.userId)
      ? session.participant_ids
      : [...session.participant_ids, auth.userId];
    const newStatus = participants.length >= 2 ? 'active' : 'scheduled';

    await supabase.from('speed_date_sessions').update({
      daily_room_url: roomUrl,
      participant_ids: participants,
      status: newStatus,
    }).eq('id', session_id);

    return successResponse({ room_url: roomUrl, session_id, status: newStatus, participant_count: participants.length });
  }

  // ── Queue join: matchmaking (no session_id given) ────────────────────────

  if (DEV_MOCK) {
    return successResponse({
      session_id: 'dev-session-id',
      status: 'waiting',
      room_url: null,
      participant_count: 1,
    });
  }

  // 1. Check if caller is already in a waiting session
  const { data: mySession } = await supabase
    .from('speed_date_sessions')
    .select('*')
    .eq('status', 'scheduled')
    .contains('participant_ids', [auth.userId])
    .limit(1)
    .maybeSingle();

  if (mySession) {
    return successResponse({
      session_id: mySession.id,
      status: 'waiting',
      room_url: mySession.daily_room_url ?? null,
      participant_count: mySession.participant_ids.length,
    });
  }

  // 2. Find an open session with exactly 1 participant (not the caller)
  const { data: openSessions } = await supabase
    .from('speed_date_sessions')
    .select('*')
    .eq('status', 'scheduled')
    .limit(20);

  const openSession = (openSessions ?? []).find(
    (s: any) =>
      s.participant_ids.length === 1 &&
      !s.participant_ids.includes(auth.userId),
  );

  if (openSession) {
    // Join the open session — this makes it active
    let roomUrl = openSession.daily_room_url;
    if (!roomUrl) {
      try { roomUrl = await getOrCreateDailyRoom(openSession.id); }
      catch (e) { return errorResponse(`Failed to create video room: ${e instanceof Error ? e.message : 'unknown'}`, 500); }
    }

    const participants = [...openSession.participant_ids, auth.userId];
    await supabase.from('speed_date_sessions').update({
      daily_room_url: roomUrl,
      participant_ids: participants,
      status: 'active',
    }).eq('id', openSession.id);

    return successResponse({
      session_id: openSession.id,
      status: 'active',
      room_url: roomUrl,
      participant_count: 2,
    });
  }

  // 3. No open session — create a new one and wait
  const scheduledAt = new Date().toISOString();
  const { data: newSession, error: createError } = await supabase
    .from('speed_date_sessions')
    .insert({
      scheduled_at: scheduledAt,
      duration_seconds: 300,
      participant_ids: [auth.userId],
      status: 'scheduled',
      prompts: [
        "What's something you're really proud of this year?",
        "What does your ideal weekend look like?",
        "What's a place you've always wanted to visit?",
        "What's something unexpected about you?",
        "What are you looking for in a connection?",
      ],
    })
    .select('id')
    .single();

  if (createError || !newSession) {
    return errorResponse('Failed to create session', 500);
  }

  return successResponse({
    session_id: newSession.id,
    status: 'waiting',
    room_url: null,
    participant_count: 1,
  });
});
