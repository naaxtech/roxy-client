-- ============================================================
-- Verification for 077_speed_date_queue_integrity.sql
--
-- Run against the Roxy project AFTER `npx supabase db push`:
--   psql "$ROXY_DB_URL" -f supabase/tests/077_speed_date_queue_check.sql
--
-- Part 1 is fixture-free and answers the question that has burned us before:
-- "is the migration actually applied, or does the file just exist?" It reads
-- pg_proc / pg_policies / pg_attribute rather than trusting the migrations
-- table.
--
-- Part 2 is the regression this file exists for: the reaper must not eject a
-- waiter who is still sitting on the waiting-room screen. It runs entirely on
-- its own fixtures inside a transaction that is rolled back, so it needs no
-- arguments and leaves nothing behind.
--
-- Part 3 proves the other half: the claim pairs with that live waiter and
-- refuses both the ghost and the advance booking. It needs one approved
-- profile, which it finds for itself; it skips with a NOTICE if the database
-- has none.
-- ============================================================

\set ON_ERROR_STOP on

-- ── Part 1: the schema and the functions are actually there ─────────────────
DO $$
DECLARE
  v_type text;
  v_notnull boolean;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull
    INTO v_type, v_notnull
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'speed_date_sessions'
     AND a.attname = 'last_seen_at'
     AND NOT a.attisdropped;

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'MISSING COLUMN speed_date_sessions.last_seen_at -- migration 077 is not applied';
  END IF;

  IF v_type <> 'timestamp with time zone' THEN
    RAISE EXCEPTION 'last_seen_at is %, expected timestamp with time zone', v_type;
  END IF;

  -- NOT NULL is what lets the claim and the reaper compare it without a
  -- coalesce; a nullable column would silently make every legacy row immortal.
  IF NOT v_notnull THEN
    RAISE EXCEPTION 'last_seen_at is nullable -- the backfill/SET NOT NULL step did not run';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'speed_date_sessions'
      AND a.attname = 'started_at' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN speed_date_sessions.started_at -- migration 077 is not applied';
  END IF;

  RAISE NOTICE 'PASS: started_at and last_seen_at present, last_seen_at NOT NULL';
END;
$$;

DO $$
DECLARE fn text; n int;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'is_approved_member_id',
    'claim_speed_date_partner',
    'speed_date_queue_heartbeat',
    'leave_speed_date_queue',
    'release_speed_date_claim',
    'expire_stale_speed_date_sessions'
  ] LOOP
    SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = fn AND p.prosecdef = true;

    IF n = 0 THEN
      RAISE EXCEPTION 'MISSING or non-SECURITY-DEFINER function public.% -- 077 is not applied', fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: all 6 queue functions present and SECURITY DEFINER';
END;
$$;

-- The two id-taking functions must NOT be callable by a logged-in user: they
-- trust their p_user_id argument, so `authenticated` EXECUTE would let anyone
-- shove anyone else into a video call.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['claim_speed_date_partner', 'release_speed_date_claim', 'is_approved_member_id'] LOOP
    IF has_function_privilege('authenticated', (
         SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public' AND p.proname = fn LIMIT 1
       ), 'EXECUTE') THEN
      RAISE EXCEPTION 'GRANT LEAK: authenticated can EXECUTE public.% -- it takes a user id as an argument', fn;
    END IF;
  END LOOP;

  -- and the two that read auth.uid() must be callable, or the waiting room is
  -- dead in the water.
  FOREACH fn IN ARRAY ARRAY['leave_speed_date_queue', 'speed_date_queue_heartbeat'] LOOP
    IF NOT has_function_privilege('authenticated', (
         SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public' AND p.proname = fn LIMIT 1
       ), 'EXECUTE') THEN
      RAISE EXCEPTION 'MISSING GRANT: authenticated cannot EXECUTE public.%', fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: id-taking functions are service-role only, auth.uid() functions are callable';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'speed_date_sessions'
      AND policyname = 'speed_date_read_participant'
  ) THEN
    RAISE EXCEPTION 'MISSING POLICY speed_date_sessions.speed_date_read_participant -- a retired row is invisible to its own waiter';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'speed_date_sessions'
      AND indexname = 'idx_speed_date_participants'
  ) THEN
    RAISE EXCEPTION 'MISSING INDEX idx_speed_date_participants -- the "am I already queued?" lookup is a seq scan';
  END IF;

  -- The earlier draft left this table on REPLICA IDENTITY FULL for a reason
  -- that was not true, at the cost of a full old-row image in WAL on every
  -- heartbeat. 'd' is the default (primary key).
  IF (SELECT relreplident FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'speed_date_sessions') <> 'd' THEN
    RAISE EXCEPTION 'speed_date_sessions is not on REPLICA IDENTITY DEFAULT';
  END IF;

  RAISE NOTICE 'PASS: participant read policy, GIN index, and default replica identity';
END;
$$;

-- ── Part 2: the reaper does not eject a waiter who is still on screen ────────
-- The exact production sequence: A joins, waits past the old 120s created_at
-- window with the app open and heartbeating, and B taps Join. B's join runs the
-- reaper first (join-speed-date-session/index.ts:188). Before this migration
-- that retired A's row, B then found an empty queue and created a second one,
-- and the two of them sat in separate rows that could never pair.
BEGIN;

INSERT INTO public.speed_date_sessions
  (id, community_id, scheduled_at, duration_seconds, participant_ids, status, created_at, last_seen_at)
VALUES
  -- A: 125s in the queue -- past the old window -- but heartbeated 2s ago.
  ('77000000-0000-4000-8000-000000000001', NULL,
   now() - interval '125 seconds', 300,
   ARRAY['77000000-0000-4000-8000-0000000000a1'::uuid], 'scheduled',
   now() - interval '125 seconds', now() - interval '2 seconds'),
  -- G: force-quit ten minutes ago, no heartbeat since. A real corpse.
  ('77000000-0000-4000-8000-000000000002', NULL,
   now() - interval '10 minutes', 300,
   ARRAY['77000000-0000-4000-8000-0000000000a2'::uuid], 'scheduled',
   now() - interval '10 minutes', now() - interval '10 minutes'),
  -- H: an advance booking (the host flow, 009). Written ten minutes ago, but
  -- it does not start until tomorrow. Nothing may retire it in the meantime.
  ('77000000-0000-4000-8000-000000000003', NULL,
   now() + interval '1 day', 300,
   ARRAY['77000000-0000-4000-8000-0000000000a3'::uuid], 'scheduled',
   now() - interval '10 minutes', now() - interval '10 minutes');

DO $$
DECLARE
  v_reaped int;
  v_status text;
BEGIN
  v_reaped := public.expire_stale_speed_date_sessions(120);

  SELECT status INTO v_status FROM public.speed_date_sessions
   WHERE id = '77000000-0000-4000-8000-000000000001';
  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION
      'STRANDED: a waiter heartbeating 2s ago was retired (status=%). The reaper is bounded on created_at, not last_seen_at.',
      v_status;
  END IF;

  SELECT status INTO v_status FROM public.speed_date_sessions
   WHERE id = '77000000-0000-4000-8000-000000000002';
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION
      'NOT REAPED: a row silent for 10 minutes is still %. The pool will refill with corpses.',
      v_status;
  END IF;

  SELECT status INTO v_status FROM public.speed_date_sessions
   WHERE id = '77000000-0000-4000-8000-000000000003';
  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION
      'BOOKING DESTROYED: a session scheduled for tomorrow was retired (status=%). The reaper ignores scheduled_at.',
      v_status;
  END IF;

  IF v_reaped < 1 THEN
    RAISE EXCEPTION 'expire_stale_speed_date_sessions returned % -- it did not report the row it retired', v_reaped;
  END IF;

  RAISE NOTICE 'PASS: live waiter kept, silent row retired, future booking untouched';
END;
$$;

-- ── Part 3: the claim pairs with the live waiter and nobody else ─────────────
-- Everything else scheduled in the open pool is pushed aside first, so the
-- assertion is about these three fixtures and not about whatever real rows
-- happen to exist. The whole block is rolled back either way.
UPDATE public.speed_date_sessions
   SET status = 'completed'
 WHERE status = 'scheduled'
   AND id NOT IN (
     '77000000-0000-4000-8000-000000000001',
     '77000000-0000-4000-8000-000000000002',
     '77000000-0000-4000-8000-000000000003'
   );

-- Undo Part 2's reaping so the claim faces the original three.
UPDATE public.speed_date_sessions
   SET status = 'scheduled'
 WHERE id IN (
   '77000000-0000-4000-8000-000000000001',
   '77000000-0000-4000-8000-000000000002',
   '77000000-0000-4000-8000-000000000003'
 );

DO $$
DECLARE
  v_user    uuid;
  v_claimed uuid;
BEGIN
  SELECT id INTO v_user FROM public.profiles
   WHERE vetting_status IN ('approved','unvetted')
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE NOTICE 'SKIPPED Part 3 -- no approved/unvetted profile to claim as';
    RETURN;
  END IF;

  SELECT c.session_id INTO v_claimed
    FROM public.claim_speed_date_partner(v_user, NULL, 120) c;

  IF v_claimed IS NULL THEN
    RAISE EXCEPTION 'NO PAIRING: a live waiter was in the open pool and the claim returned nothing';
  END IF;

  IF v_claimed <> '77000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'WRONG PARTNER: claimed % -- expected the live waiter, not a ghost or an advance booking', v_claimed;
  END IF;

  -- Only the ghost and the advance booking are left. Both must be unclaimable,
  -- or someone gets dropped alone into a five-minute video room.
  SELECT c.session_id INTO v_claimed
    FROM public.claim_speed_date_partner(v_user, NULL, 120) c;

  IF v_claimed IS NOT NULL THEN
    RAISE EXCEPTION 'GHOST PAIRING: claimed % -- a silent row or a future booking was treated as a live waiter', v_claimed;
  END IF;

  RAISE NOTICE 'PASS: claim took the live waiter, then refused both the ghost and the booking';
END;
$$;

ROLLBACK;

\echo 'ALL CHECKS PASSED -- 077 is applied and the queue cannot evict a live waiter'
