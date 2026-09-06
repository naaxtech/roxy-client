-- ============================================================
-- 077_speed_date_queue_integrity.sql
--
-- Bug: Speed Dating matchmaking stopped pairing anyone in production.
--
-- Root cause: the edge function's queue scan read `.eq('status','scheduled')
-- .limit(20)` with NO ordering, NO community filter and NO staleness bound,
-- then filtered in JavaScript for `participant_ids.length === 1`. Nothing in
-- the system ever moved a row OUT of 'scheduled':
--   * waiting-room.tsx "Leave Queue" rewrote participant_ids to '{}' and left
--     status='scheduled' forever -- one dead row per cancel;
--   * a force-quit left status='scheduled' with one participant forever.
-- PostgREST returns unordered rows (effectively oldest-first here), so once
-- ~20 dead rows accumulated, the 20-row window contained nothing but garbage,
-- `.find()` returned undefined every single time, and EVERY caller fell
-- through to "create a new session and wait". Two people tapping Join at the
-- same second could no longer see each other. The queue silently poisoned
-- itself and the feature died permanently.
--
-- That scan is already gone from the source tree: join-speed-date-session/
-- index.ts now calls claim_speed_date_partner() at index.ts:215-220 and
-- expire_stale_speed_date_sessions() at index.ts:188. Those RPCs are THIS
-- migration -- the function is deployed ahead of them, so until this file is
-- applied every queue join fails at index.ts:168 ("Could not verify your
-- account") because is_approved_member_id() does not exist yet.
--
-- Secondary: the JS read-then-write had no locking, so two callers could both
-- claim the same open session and the second overwrote the first.
--
-- Fix: claim a partner atomically in one statement -- ordered, community
-- scoped, liveness bounded, FOR UPDATE SKIP LOCKED -- and give the queue a
-- way to retire rows so it can never fill with corpses again.
--
-- LIVENESS MODEL (the numbers the client and the server both agree on):
--   * the waiting room calls speed_date_queue_heartbeat() every 3 seconds --
--     the same timer that already polled for a match, so no new cadence;
--   * a queue row is abandoned after 120 seconds with NO heartbeat, i.e. 40
--     consecutive missed beats;
--   * the client's own 90s "no one's free right now" screen is cosmetic. It
--     changes what the user reads, never whether the row survives.
-- The earlier draft of this file bounded staleness on created_at instead, which
-- meant the queue evicted people for waiting rather than for leaving: a waiter
-- 125 seconds in was retired by the next person's join, that person then found
-- an empty queue and created a second row, and the two of them sat in separate
-- rows that could never pair. Because 'completed' is invisible to the 004 read
-- policy the stranded waiter's poll then 404'd and the screen kept promising
-- "if someone joins, your call starts automatically" -- which was false. Time
-- spent waiting is not evidence of absence; silence is.
-- ============================================================

-- ── 1. started_at: a shared clock for the round timer ───────────────────────
-- Both clients previously counted their own setInterval ticks from their own
-- mount, so the two sides of the same date ended at different moments and
-- backgrounding the app (which suspends JS timers in RN) stretched the date
-- arbitrarily. A server-set start instant makes elapsed time wall-clock and
-- identical on both handsets.
ALTER TABLE public.speed_date_sessions
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

COMMENT ON COLUMN public.speed_date_sessions.started_at IS
  'Set when the session flips to active. Both clients derive elapsed time from this, never from local tick counting.';

-- ── 1b. last_seen_at: proof the waiter is still there ───────────────────────
-- Added NULLable and backfilled from created_at rather than declared with a
-- DEFAULT up front: ADD COLUMN ... DEFAULT now() stamps every existing row with
-- now(), which would make the corpses already in the table look freshly alive
-- and defeat the cleanup at the bottom of this file. Backfilling on NULL keeps
-- the whole sequence re-runnable -- a second run finds no NULLs and changes
-- nothing, so it can never reset a live waiter's clock.
ALTER TABLE public.speed_date_sessions
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- coalesce, not a bare created_at: that column is nullable (004:95 declares a
-- DEFAULT but no NOT NULL), and a single row with a NULL created_at would leave
-- a NULL behind and make the SET NOT NULL below fail the whole migration.
UPDATE public.speed_date_sessions
   SET last_seen_at = coalesce(created_at, now())
 WHERE last_seen_at IS NULL;

ALTER TABLE public.speed_date_sessions
  ALTER COLUMN last_seen_at SET DEFAULT now();

ALTER TABLE public.speed_date_sessions
  ALTER COLUMN last_seen_at SET NOT NULL;

COMMENT ON COLUMN public.speed_date_sessions.last_seen_at IS
  'Last heartbeat from a waiter on this row (speed_date_queue_heartbeat, every 3s from the waiting room). The queue treats silence as absence, never elapsed wait time.';

-- Supports the claim's ORDER BY created_at + LIMIT 1: Postgres walks the live
-- queue oldest-first and stops at the first eligible row, so the fairness
-- ordering costs no sort.
--
-- Deliberately NOT keyed on community_id. The claim matches communities with
-- `IS NOT DISTINCT FROM` (the open "feeling wild" pool is a NULL community, and
-- plain `=` never matches NULL to NULL), and IS NOT DISTINCT FROM is not a
-- btree-searchable operator -- a leading community_id column could never be
-- used as an index key and would only push created_at out of scan order,
-- reintroducing the sort. community_id, array_length() and the NOT ... = ANY()
-- self-exclusion are all applied as filters during the walk; the partial
-- predicate keeps that walk inside the live queue, which is a handful of rows.
--
-- Dropped rather than CREATE INDEX IF NOT EXISTS: the name already existed in an
-- earlier draft of this file with a different column list, and IF NOT EXISTS
-- would silently keep the old definition on any database that ran it.
DROP INDEX IF EXISTS public.idx_speed_date_queue;
CREATE INDEX idx_speed_date_queue
  ON public.speed_date_sessions (created_at)
  WHERE status = 'scheduled';

-- join-speed-date-session/index.ts:191-197 asks "am I already queued?" with
-- `.contains('participant_ids', [userId])`, which is the array containment
-- operator @>. Only GIN can serve that; without this it is a sequential scan of
-- the whole table on every single join. Mirrors idx_conversations_participants
-- (004:26), which indexes the identical access pattern on conversations.
CREATE INDEX IF NOT EXISTS idx_speed_date_participants
  ON public.speed_date_sessions USING GIN (participant_ids);

-- ── 2. Realtime, idempotently ───────────────────────────────────────────────
-- 017_speed_date_realtime.sql adds speed_date_sessions to the publication in
-- the same transaction as a CREATE POLICY that duplicates a policy name 009
-- already created. On any database where 009 applied, 017 raises 42710 and the
-- whole transaction rolls back -- taking the ALTER PUBLICATION with it. These
-- guards make the end state correct regardless of what 017 managed to do.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'speed_date_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.speed_date_sessions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'speed_date_likes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.speed_date_likes;
  END IF;
END $$;

-- Replica identity stays DEFAULT (primary key).
--
-- An earlier draft set REPLICA IDENTITY FULL here on the grounds that "Postgres
-- only ships the changed columns for the default replica identity, so the
-- payload can arrive without daily_room_url". That is not how it works: replica
-- identity determines the OLD tuple -- what identifies the row being updated,
-- and what Supabase surfaces as `old_record`. The NEW tuple in an UPDATE
-- carries every column of the new row version regardless. waiting-room.tsx:105
-- reads only `payload.new`, and nothing in this codebase reads old_record for
-- speed_date_sessions, so FULL bought nothing the client uses.
--
-- It is not free either. FULL writes a complete before-image of the row into
-- WAL on every UPDATE and DELETE, and under the heartbeat below this table now
-- takes one UPDATE every 3 seconds per waiting user. Stated explicitly rather
-- than merely omitted so that a database which ran the earlier draft is put
-- back; on a fresh database this is a no-op.
ALTER TABLE public.speed_date_sessions REPLICA IDENTITY DEFAULT;

-- ── 3. The gate ─────────────────────────────────────────────────────────────
-- 072 gated community content behind is_approved_member(), but speed dating
-- reads its own ungated policy (004: "auth.uid() IS NOT NULL AND status IN
-- (...)") and the edge function talks to the database with the service-role
-- key, which bypasses RLS entirely. Net effect: an account still sitting at
-- vetting_status='pending' could queue, match, and land in a live 1-on-1 video
-- call with a vetted member. On a vetted WLW dating product that is a safety
-- hole, not a nitpick. is_approved_member() cannot be reused directly here
-- because it reads auth.uid(), which is NULL under the service-role key -- so
-- the predicate takes the user id the edge function extracted from the JWT.
CREATE OR REPLACE FUNCTION public.is_approved_member_id(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id
      -- 'unvetted' is the grandfathered pre-gate population and MUST stay in,
      -- exactly as 072 documents for is_approved_member().
      AND vetting_status IN ('approved','unvetted')
  );
$$;

COMMENT ON FUNCTION public.is_approved_member_id(uuid) IS
  'Service-role-safe twin of is_approved_member(): same predicate, explicit user id, for callers where auth.uid() is NULL.';

-- ── 4. A participant can always see their own session ───────────────────────
-- 004's read policy exposes status IN ('scheduled','active') only, so the
-- instant a row is retired it becomes invisible to the very person sitting on
-- it: their poll 404s and the screen has no way to tell "still waiting" from
-- "your place in the queue is gone". Purely additive -- policies are OR'd, 004
-- is untouched, and the widening is to rows the caller is already in.
DROP POLICY IF EXISTS "speed_date_read_participant" ON public.speed_date_sessions;
CREATE POLICY "speed_date_read_participant" ON public.speed_date_sessions
  FOR SELECT USING (auth.uid() = ANY (participant_ids));

-- ── 5. Atomic partner claim ─────────────────────────────────────────────────
-- Replaces the unordered 20-row scan + JavaScript filter. One statement, so
-- two simultaneous callers cannot claim the same session: SKIP LOCKED hands
-- the second caller the next eligible row instead of a lost update.
CREATE OR REPLACE FUNCTION public.claim_speed_date_partner(
  p_user_id      uuid,
  p_community_id uuid,
  p_stale_seconds int DEFAULT 120
)
RETURNS TABLE (session_id uuid, daily_room_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_member_id(p_user_id) THEN
    RAISE EXCEPTION 'not_approved' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.speed_date_sessions s
     SET participant_ids = s.participant_ids || p_user_id,
         status          = 'active',
         started_at      = now(),
         last_seen_at    = now()
   WHERE s.id = (
     SELECT c.id
       FROM public.speed_date_sessions c
      WHERE c.status = 'scheduled'
        -- exactly one waiter. array_length returns NULL for '{}', so rows
        -- abandoned by "Leave Queue" are excluded rather than matched.
        AND array_length(c.participant_ids, 1) = 1
        AND NOT (p_user_id = ANY (c.participant_ids))
        -- NULL community (the open "feeling wild" pool) must compare equal to
        -- NULL, which plain = never does.
        AND c.community_id IS NOT DISTINCT FROM p_community_id
        -- A session booked for later (the host flow, 009) is not a queue entry
        -- and must never be handed to a walk-up joiner. The 30s grace is clock
        -- skew tolerance, nothing more: the edge function stamps scheduled_at
        -- from the Deno runtime's clock, not the database's, so a queue row can
        -- legitimately land a few milliseconds in Postgres' future. Anything
        -- genuinely booked ahead is minutes to days out and still excluded.
        AND c.scheduled_at <= now() + interval '30 seconds'
        -- never pair someone with a waiter who has gone quiet. Bounded on the
        -- last heartbeat, NOT on created_at: someone who has been waiting
        -- fifteen minutes with a live app is still there and still wants this.
        AND c.last_seen_at > now() - make_interval(secs => p_stale_seconds)
      -- fairest first: longest time in the queue wins.
      ORDER BY c.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING s.id, s.daily_room_url;
END;
$$;

COMMENT ON FUNCTION public.claim_speed_date_partner(uuid, uuid, int) IS
  'Atomically pairs a caller with the oldest live waiter in the same pool. Liveness is the waiter''s last heartbeat, not their age. Returns zero rows when nobody is waiting.';

-- ── 6. Heartbeat: the waiting room proving it is still open ─────────────────
-- Replaces the waiting room's raw SELECT poll. Same 3s cadence, but it now
-- writes as well as reads, which is what lets the reaper below distinguish
-- "waiting patiently" from "force-quit twenty minutes ago".
--
-- It also answers for rows the 004 read policy hides. A waiter whose row was
-- retired used to get a PostgREST 404 that the client could only interpret as a
-- network wobble; here they get status='completed' and can rejoin instead of
-- being told, falsely, that the call will start automatically.
--
-- Called straight from the client, so identity is auth.uid() and never an
-- argument: a caller can only ever refresh a row they are already in.
CREATE OR REPLACE FUNCTION public.speed_date_queue_heartbeat(
  p_session_id uuid
)
RETURNS TABLE (session_status text, room_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_status  text;
  v_url     text;
BEGIN
  IF v_user_id IS NULL OR p_session_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.speed_date_sessions s
     SET last_seen_at = now()
   WHERE s.id = p_session_id
     AND s.status = 'scheduled'
     AND v_user_id = ANY (s.participant_ids)
  RETURNING s.status, s.daily_room_url INTO v_status, v_url;

  -- Not scheduled any more (paired, retired) or not the caller's row at all.
  -- Read it without touching it so the client learns which.
  IF v_status IS NULL THEN
    SELECT s.status, s.daily_room_url
      INTO v_status, v_url
      FROM public.speed_date_sessions s
     WHERE s.id = p_session_id
       AND v_user_id = ANY (s.participant_ids);
  END IF;

  -- Zero rows means "this is not your session, or it no longer exists", which
  -- the client treats exactly like a retired one: rejoin.
  IF v_status IS NULL THEN
    RETURN;
  END IF;

  session_status := v_status;
  room_url       := v_url;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.speed_date_queue_heartbeat(uuid) IS
  'Waiting-room poll: refreshes last_seen_at on the caller''s queue row and reports its status, including statuses the 004 read policy hides.';

-- ── 7. Retire a queue entry ─────────────────────────────────────────────────
-- What "Leave Queue" should always have done. Rewriting participant_ids to
-- '{}' and leaving status='scheduled' is what filled the pool with corpses.
-- Called straight from the client, so identity comes from auth.uid() and never
-- from an argument: a caller can only ever remove themselves.
CREATE OR REPLACE FUNCTION public.leave_speed_date_queue(
  p_session_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining uuid[];
  v_status    text;
  p_user_id   uuid := auth.uid();
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT status INTO v_status
    FROM public.speed_date_sessions
   WHERE id = p_session_id
     FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN false;
  END IF;

  -- Only a waiting session can be left this way; an active date ends through
  -- the result flow, not by rewriting the participant list underneath it.
  IF v_status <> 'scheduled' THEN
    RETURN false;
  END IF;

  UPDATE public.speed_date_sessions
     SET participant_ids = array_remove(participant_ids, p_user_id)
   WHERE id = p_session_id
  RETURNING participant_ids INTO v_remaining;

  -- Nobody left holding the session: retire it so the queue scan never sees
  -- it again.
  IF v_remaining IS NULL OR array_length(v_remaining, 1) IS NULL THEN
    UPDATE public.speed_date_sessions
       SET status = 'completed'
     WHERE id = p_session_id;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.leave_speed_date_queue(uuid) IS
  'Removes a waiter and retires the session when it empties, so cancelled joins cannot accumulate as permanent scheduled rows.';

-- ── 8. Undo a claim the caller could not honour ─────────────────────────────
-- claim_speed_date_partner() flips the row to 'active' before the edge function
-- has a Daily.co room. If room creation then fails, the joiner gets an error
-- and retries -- but the WAITER did nothing wrong and must not be punished for
-- it. The edge function previously wrote participant_ids='{}', status
-- 'completed' on this path, which deleted the waiter from a queue they were
-- still sitting in and dropped them into exactly the dead state this migration
-- exists to eliminate.
--
-- Putting the row back is the only correct move: the waiter keeps their place,
-- keeps their position in the fairness ordering (created_at is untouched), and
-- gets a fresh liveness stamp so the reaper does not take them instead.
CREATE OR REPLACE FUNCTION public.release_speed_date_claim(
  p_session_id uuid,
  p_user_id    uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining uuid[];
BEGIN
  IF p_session_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.speed_date_sessions
     SET participant_ids = array_remove(participant_ids, p_user_id),
         status          = 'scheduled',
         started_at      = NULL,
         last_seen_at    = now()
   WHERE id = p_session_id
     AND status = 'active'
     AND p_user_id = ANY (participant_ids)
  RETURNING participant_ids INTO v_remaining;

  -- Never matched: not active, or not the claimer's session. Leave it alone.
  IF v_remaining IS NULL THEN
    RETURN false;
  END IF;

  -- The original waiter left while the room call was in flight, so there is
  -- nobody to hand the queue slot back to. Retire it instead of parking an
  -- empty 'scheduled' row -- that is the corpse this whole file is about.
  IF array_length(v_remaining, 1) IS NULL THEN
    UPDATE public.speed_date_sessions
       SET status = 'completed'
     WHERE id = p_session_id;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.release_speed_date_claim(uuid, uuid) IS
  'Rolls a failed claim back to a waiting queue row, returning the untouched waiter to their place. For the edge function''s Daily.co failure path.';

-- ── 9. Reaper for rows nobody retired ───────────────────────────────────────
-- Force-quits and lost connections never call anything. Without this the pool
-- refills with stale single-waiter rows and the liveness bound in the claim
-- turns into a full-table scan over junk.
--
-- Two things this must never do, both of which the earlier draft did:
--   * evict a waiter who is still on the screen. The bound is last_seen_at, so
--     a live client heartbeating every 3s survives indefinitely and only 120s
--     of actual silence (40 missed beats) retires a row;
--   * destroy a session booked for later. scheduled_at is NOT NULL (004:89) and
--     is the whole point of an advance booking; filtering on created_at alone
--     retired every host-flow and dev-seeded session two minutes after it was
--     written, before its own start time had even arrived.
CREATE OR REPLACE FUNCTION public.expire_stale_speed_date_sessions(
  p_stale_seconds int DEFAULT 120
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  WITH expired AS (
    UPDATE public.speed_date_sessions
       SET status = 'completed'
     WHERE status = 'scheduled'
       -- due already: never reap a booking that has not started.
       AND scheduled_at <= now()
       -- silent, not merely old.
       AND last_seen_at <= now() - make_interval(secs => p_stale_seconds)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_speed_date_sessions(int) IS
  'Retires queue entries that have gone silent past p_stale_seconds and are already due. Called opportunistically on each queue join; safe to also run on a schedule.';

-- ── 10. Grants ──────────────────────────────────────────────────────────────
-- These take a user id as an argument instead of reading auth.uid(), so an
-- authenticated caller could otherwise pass someone else's id and shove them
-- into a session. Service role only -- the edge function is the sole caller,
-- and it passes the id it extracted from a verified JWT.
REVOKE ALL ON FUNCTION public.claim_speed_date_partner(uuid, uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_speed_date_sessions(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_approved_member_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_speed_date_claim(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_speed_date_partner(uuid, uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_speed_date_sessions(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_approved_member_id(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_speed_date_claim(uuid, uuid) TO service_role;

-- leave_speed_date_queue and speed_date_queue_heartbeat are the exceptions:
-- they take no user id and act only on auth.uid(), so the client may call them
-- directly.
REVOKE ALL ON FUNCTION public.leave_speed_date_queue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_speed_date_queue(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.speed_date_queue_heartbeat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.speed_date_queue_heartbeat(uuid) TO authenticated, service_role;

-- ── 11. One-off cleanup of the corpses already in the table ─────────────────
-- Without this the production pool stays poisoned even after the code fix.
-- Safe to run at apply time: every corpse was backfilled to last_seen_at =
-- created_at above, and there is nobody live to catch in the net -- queue joins
-- have been failing at index.ts:168 for as long as these RPCs have been
-- missing, so the table cannot contain a waiter who joined successfully.
SELECT public.expire_stale_speed_date_sessions(120);
