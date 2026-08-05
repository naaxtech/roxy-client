import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { generateSpeedDatePrompts } from '../_shared/speedDatePrompts.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const FN_NAME = 'join-speed-date-session';

// A waiter who has not been HEARD FROM in this long is treated as gone: the app
// was force-quit, backgrounded past the OS socket timeout, or the network
// dropped. Pairing someone with a ghost is worse than telling them the queue is
// empty -- they sit alone in a video room for the full five minutes.
//
// Measured against speed_date_sessions.last_seen_at, which the waiting room
// refreshes every 3 seconds via speed_date_queue_heartbeat (migration 077). So
// this is 40 consecutive missed heartbeats, not 120 seconds of patience: a user
// who has been happily waiting five minutes with the app open keeps her place.
// It used to be measured from created_at, which meant the queue evicted people
// for waiting -- and evicted them on somebody else's join, so neither of them
// could ever pair.
const STALE_QUEUE_SECONDS = 120;

// Queue joins are cheap but not free (each new session generates prompts via
// Claude). This caps a stuck client retrying in a loop.
const MAX_JOINS_PER_DAY = 60;

interface SpeedDateSessionRow {
  id: string;
  status: 'scheduled' | 'active' | 'completed';
  participant_ids: string[];
  daily_room_url: string | null;
  community_id: string | null;
}

interface ClaimedSession {
  session_id: string;
  daily_room_url: string | null;
}

async function getOrCreateDailyRoom(sessionId: string): Promise<string> {
  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) throw new Error('DAILY_API_KEY not configured');

  const roomName = `roxy-speed-date-${sessionId.slice(0, 8)}`;

  const getRes = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${dailyApiKey}` },
  });
  if (getRes.ok) {
    const room = await getRes.json();
    return room.url as string;
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
  return room.url as string;
}

Deno.serve(async (req) => {
  // 1. CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // 2. Auth
  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  // 3. Parse body
  const body = await req.json().catch(() => ({}));
  const { session_id, community_id } = body as {
    session_id?: string;
    community_id?: string;
  };

  // 4. DEV_MOCK — declared before any DB call (anti-pattern 11)
  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  // 5. Rate limit (runs in dev too)
  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: FN_NAME,
    maxCount: MAX_JOINS_PER_DAY,
    windowType: 'daily',
  });
  if (!allowed) {
    return errorResponse('You have joined a lot of speed dates today. Try again tomorrow.', 429);
  }

  // 6. Dev mock
  if (DEV_MOCK) {
    return successResponse({
      session_id: 'dev-session-id',
      status: 'waiting',
      room_url: null,
      participant_count: 1,
    });
  }

  // 7. Client
  const supabase = getSupabaseClient();

  // 8. Logic

  // ── Legacy join-a-specific-session flow ─────────────────────────────────
  if (session_id) {
    const { data: session, error: sessionError } = await supabase
      .from('speed_date_sessions')
      .select('id, status, participant_ids, daily_room_url, community_id')
      .eq('id', session_id)
      .single<SpeedDateSessionRow>();

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
    const isActive = participants.length >= 2;

    await supabase.from('speed_date_sessions').update({
      daily_room_url: roomUrl,
      participant_ids: participants,
      status: isActive ? 'active' : 'scheduled',
      // The round timer is derived from this on both handsets; without it the
      // two sides count their own ticks and end at different moments.
      ...(isActive && !session.daily_room_url ? { started_at: new Date().toISOString() } : {}),
    }).eq('id', session_id);

    return successResponse({
      room_url: roomUrl,
      session_id,
      status: isActive ? 'active' : 'scheduled',
      participant_count: participants.length,
    });
  }

  // ── Queue join: matchmaking ─────────────────────────────────────────────

  // The invite gate (072) cannot reach this path on its own: RLS is bypassed
  // by the service-role key, and speed_date_sessions carries its own ungated
  // read policy from 004. Check it explicitly, or a 'pending' account walks
  // into a live video call with a vetted member.
  const { data: isApproved, error: gateError } = await supabase
    .rpc('is_approved_member_id', { p_user_id: auth.userId });

  if (gateError) return errorResponse('Could not verify your account', 500);
  if (isApproved !== true) {
    return errorResponse('Your membership is still being reviewed. Speed dating unlocks once you are approved.', 403);
  }

  const scopeCommunityId: string | null =
    typeof community_id === 'string' && community_id ? community_id : null;

  if (scopeCommunityId) {
    const { data: membership } = await supabase
      .from('community_members')
      .select('community_id')
      .eq('community_id', scopeCommunityId)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (!membership) return errorResponse('Join this community first to speed date in it', 403);
  }

  // Retire abandoned waiters before scanning. Cheap (partial index) and it is
  // what stops the pool refilling with rows nobody will ever pair with.
  await supabase.rpc('expire_stale_speed_date_sessions', { p_stale_seconds: STALE_QUEUE_SECONDS });

  // 1. Already waiting? Hand back the same session rather than queueing twice.
  const { data: mySession } = await supabase
    .from('speed_date_sessions')
    .select('id, status, participant_ids, daily_room_url, community_id')
    .eq('status', 'scheduled')
    .contains('participant_ids', [auth.userId])
    .limit(1)
    .maybeSingle<SpeedDateSessionRow>();

  if (mySession) {
    return successResponse({
      session_id: mySession.id,
      status: 'waiting',
      room_url: mySession.daily_room_url ?? null,
      participant_count: mySession.participant_ids.length,
    });
  }

  // 2. Claim a waiting partner atomically.
  //
  // This replaces an unordered `.limit(20)` scan that was filtered in
  // JavaScript afterwards. That scan matched nothing at all once ~20 dead
  // 'scheduled' rows had accumulated ahead of the live ones, which is how
  // matchmaking died in production. Postgres now does the filtering, the
  // ordering and the locking in one statement.
  const { data: claimed, error: claimError } = await supabase
    .rpc('claim_speed_date_partner', {
      p_user_id: auth.userId,
      p_community_id: scopeCommunityId,
      p_stale_seconds: STALE_QUEUE_SECONDS,
    });

  if (claimError) return errorResponse('Could not join the queue', 500);

  const claimedRow = (claimed as ClaimedSession[] | null)?.[0] ?? null;

  if (claimedRow) {
    let roomUrl = claimedRow.daily_room_url;
    if (!roomUrl) {
      try { roomUrl = await getOrCreateDailyRoom(claimedRow.session_id); }
      catch (e) {
        // The claim already flipped the row to active. Put it back to a waiting
        // queue row with the original waiter still in it.
        //
        // This used to write participant_ids=[] / status='completed', which
        // punished the waiter for a Daily.co outage she had nothing to do with:
        // she was deleted from a queue she was still sitting in, and because
        // 'completed' is invisible to the 004 read policy her screen kept
        // promising the call would start automatically. release_speed_date_claim
        // removes only THIS caller, restores 'scheduled', and refreshes
        // last_seen_at so the reaper does not take her on the way back.
        const { error: releaseError } = await supabase
          .rpc('release_speed_date_claim', {
            p_session_id: claimedRow.session_id,
            p_user_id: auth.userId,
          });
        if (releaseError) {
          console.error(`[${FN_NAME}] failed to release claim after room error`);
        }
        return errorResponse(`Failed to create video room: ${e instanceof Error ? e.message : 'unknown'}`, 500);
      }
      await supabase.from('speed_date_sessions')
        .update({ daily_room_url: roomUrl })
        .eq('id', claimedRow.session_id);
    }

    return successResponse({
      session_id: claimedRow.session_id,
      status: 'active',
      room_url: roomUrl,
      participant_count: 2,
    });
  }

  // 3. Nobody waiting — create a session and wait.
  const prompts = await generateSpeedDatePrompts();
  const { data: newSession, error: createError } = await supabase
    .from('speed_date_sessions')
    .insert({
      scheduled_at: new Date().toISOString(),
      duration_seconds: 300,
      participant_ids: [auth.userId],
      status: 'scheduled',
      community_id: scopeCommunityId,
      prompts,
    })
    .select('id')
    .single<{ id: string }>();

  if (createError || !newSession) {
    return errorResponse('Failed to create session', 500);
  }

  // Prompt generation is a real Claude call (CLAUDE.md §8). Logging it is
  // also what gives checkRateLimit above something to count.
  await logAiCall({ userId: auth.userId, fnName: FN_NAME, wasMock: false });

  return successResponse({
    session_id: newSession.id,
    status: 'waiting',
    room_url: null,
    participant_count: 1,
  });
});
