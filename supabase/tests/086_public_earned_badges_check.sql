-- ============================================================
-- Verification for 086_public_earned_badges.sql
--
-- Run against the Roxy project AFTER `npx supabase db push`:
--   psql "$ROXY_DB_URL" -f supabase/tests/086_public_earned_badges_check.sql
--
-- Part 1 is fixture-free and answers the question that has burned this project
--        before: a migration FILE is not an APPLIED migration. It reads
--        pg_policies rather than trusting supabase_migrations.
-- Part 2 is the behavioural half, and it is the reason this file exists. The
--        brief for 086 is a SPLIT -- earned rows public, in-progress rows
--        private -- and a split can only be proven by asserting the refusal.
--        A test that only shows the allowed read working would pass just as
--        happily against `USING (true)`, which is the exact mistake 086 is
--        meant not to make. Every phase below therefore asserts a count of 0
--        as well as a count of 1.
--
-- SAFETY. Part 2 runs inside BEGIN ... ROLLBACK. It inserts two throwaway
-- badges and two user_badge_progress rows of its own, and it briefly flips
-- is_ghost on the target profile and vetting_status on the viewer profile to
-- prove the two gate clauses. Both flips are on real rows and both are rolled
-- back; the pattern (and the row-lock cost) is the one 077's Part 3 already
-- established. Nothing is left behind on either path.
--
-- It needs two distinct profiles that are active, non-ghost and approved. It
-- finds them itself and skips the whole of Part 2 with a NOTICE if the database
-- has fewer than two, so this is runnable on an empty database forever.
-- ============================================================

\set ON_ERROR_STOP on

-- ── Part 1: the four policies exist, and are scoped to an audience ──────────
--
-- ubp_owner_* were shipped in 007 with no TO clause. They were never
-- exploitable (auth.uid() is NULL for anon, and `user_id = NULL` is NULL, so no
-- row matched), but 086 adds a SECOND permissive SELECT policy to this table
-- and permissive policies are OR'd -- so one sibling anon can satisfy would
-- republish the lot. That is what these assertions defend.
DO $$
DECLARE
  item  text;
  pol   text;
  want  text;
  found record;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'ubp_earned_public_select:SELECT',
    'ubp_owner_select:SELECT',
    'ubp_owner_insert:INSERT',
    'ubp_owner_update:UPDATE'
  ] LOOP
    pol  := split_part(item, ':', 1);
    want := split_part(item, ':', 2);

    SELECT permissive, roles, cmd, qual, with_check INTO found
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'user_badge_progress'
      AND policyname = pol;

    IF found IS NULL THEN
      RAISE EXCEPTION
        'MISSING POLICY public.user_badge_progress.% -- migration 086 is not applied', pol;
    END IF;

    IF NOT (found.roles = '{authenticated}') THEN
      RAISE EXCEPTION
        'POLICY % is scoped to % -- expected {authenticated}. The anon key hardcoded in apps/mobile/eas.json can reach this table',
        pol, found.roles;
    END IF;

    IF found.cmd <> want THEN
      RAISE EXCEPTION
        'POLICY % is FOR %, expected % -- a widened command here hands write access under a read policy''s name',
        pol, found.cmd, want;
    END IF;

    -- 086 relies on OR-combination to give the owner her in-progress rows back.
    -- A RESTRICTIVE policy here would AND instead, and the owner would lose
    -- every unearned row -- the Grow progress bars would empty out.
    IF found.permissive <> 'PERMISSIVE' THEN
      RAISE EXCEPTION
        'POLICY % is %, expected PERMISSIVE -- 086''s two-audience split depends on OR, not AND',
        pol, found.permissive;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: all 4 ubp_* policies present, correct command, PERMISSIVE, TO authenticated';
END;
$$;

-- The public policy's predicate carries three clauses and all three are
-- load-bearing. Asserted as text because a predicate can be silently widened
-- without changing anything else the catalog reports.
DO $$
DECLARE
  q text;
BEGIN
  SELECT qual INTO q
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'user_badge_progress'
    AND policyname = 'ubp_earned_public_select';

  IF q !~ 'earned_at IS NOT NULL' THEN
    RAISE EXCEPTION
      'ubp_earned_public_select no longer tests earned_at -- in-progress rows are public. Predicate is: %', q;
  END IF;

  IF q !~ 'is_approved_member' THEN
    RAISE EXCEPTION
      'ubp_earned_public_select no longer gates the viewer on is_approved_member() -- a pending applicant can enumerate members. Predicate is: %', q;
  END IF;

  IF q !~ 'is_active' OR q !~ 'is_ghost' THEN
    RAISE EXCEPTION
      'ubp_earned_public_select no longer mirrors profiles_select_public -- a badge can now out a ghosted or deactivated account. Predicate is: %', q;
  END IF;

  RAISE NOTICE 'PASS: public predicate still carries earned_at, is_approved_member(), is_active/is_ghost';
END;
$$;

-- The explicit WITH CHECK on the UPDATE policy. Postgres reuses USING when
-- WITH CHECK is omitted, so its absence is invisible until someone widens
-- USING and the row-ownership rule silently widens with it (070:158).
DO $$
DECLARE
  wc text;
BEGIN
  SELECT with_check INTO wc
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'user_badge_progress'
    AND policyname = 'ubp_owner_update';

  IF wc IS NULL THEN
    RAISE EXCEPTION
      'ubp_owner_update has no explicit WITH CHECK -- it is riding on Postgres reusing USING, which stops being correct the moment USING is widened';
  END IF;

  RAISE NOTICE 'PASS: ubp_owner_update carries an explicit WITH CHECK';
END;
$$;

-- Nothing else may re-open this table. One permissive sibling with no TO
-- clause undoes the whole migration, and 082 caught exactly this class on
-- storage.objects.
DO $$
DECLARE
  rec    record;
  leaked text[] := '{}';
BEGIN
  FOR rec IN
    SELECT policyname, roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'user_badge_progress'
      AND cmd IN ('SELECT', 'ALL')
      AND ('public' = ANY(roles) OR 'anon' = ANY(roles))
  LOOP
    leaked := leaked || format('%s (roles=%s)', rec.policyname, rec.roles);
  END LOOP;

  IF array_length(leaked, 1) > 0 THEN
    RAISE EXCEPTION
      'LEAK: a SELECT policy on user_badge_progress is open to anon: %',
      array_to_string(leaked, ', ');
  END IF;

  RAISE NOTICE 'PASS: no policy on user_badge_progress is readable by anon';
END;
$$;

-- badges is embedded on every read (.select('*, badges(*)')) and PostgREST
-- applies the embedded table's own RLS, so 086 is worthless if 082's
-- badges_read_all ever goes away: the strip would render blank for a different
-- reason than the one just fixed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'badges'
      AND policyname = 'badges_read_all' AND roles = '{authenticated}'
  ) THEN
    RAISE EXCEPTION
      'badges_read_all is missing or no longer TO authenticated -- the embedded badges(*) join returns nothing and the strip stays blank regardless of 086';
  END IF;

  RAISE NOTICE 'PASS: badges_read_all still serves the embedded join';
END;
$$;

-- ── Part 2: the split, proved on fixtures ───────────────────────────────────

BEGIN;

-- Fixtures. Two throwaway badges and two rows for the target: one earned, one
-- in progress. Fresh badge ids mean no collision with real rows on the
-- (user_id, badge_id) primary key.
DO $$
DECLARE
  v_viewer uuid;
  v_target uuid;
  v_earned uuid;
  v_wip    uuid;
BEGIN
  CREATE TEMP TABLE t086 (
    ready       boolean NOT NULL,
    viewer_id   uuid,
    target_id   uuid,
    earned_badge uuid,
    wip_badge   uuid
  ) ON COMMIT DROP;

  SELECT id INTO v_viewer
  FROM public.profiles
  WHERE is_active = true AND is_ghost = false
    AND public.is_approved_member_id(id)
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_target
  FROM public.profiles
  WHERE is_active = true AND is_ghost = false
    AND id <> v_viewer
  ORDER BY created_at
  LIMIT 1;

  IF v_viewer IS NULL OR v_target IS NULL THEN
    INSERT INTO t086 VALUES (false, NULL, NULL, NULL, NULL);
    RAISE NOTICE 'SKIP: Part 2 needs two distinct active, non-ghost profiles (one approved). Part 1 still ran.';
    RETURN;
  END IF;

  INSERT INTO public.badges
    (name, description, emoji, category, points_value, requirement_type, requirement_threshold)
  VALUES
    ('086 check earned',      'fixture', 'X', 'milestone', 0, 'fixture', 1),
    ('086 check in progress', 'fixture', 'X', 'milestone', 0, 'fixture', 50);

  SELECT id INTO v_earned FROM public.badges WHERE name = '086 check earned';
  SELECT id INTO v_wip    FROM public.badges WHERE name = '086 check in progress';

  INSERT INTO public.user_badge_progress (user_id, badge_id, current_value, earned_at)
  VALUES
    (v_target, v_earned, 1,  now()),   -- earned: a social signal, must be public
    (v_target, v_wip,    37, NULL);    -- 37/50: an activity metric, must not be

  INSERT INTO t086 VALUES (true, v_viewer, v_target, v_earned, v_wip);
  RAISE NOTICE 'Fixtures ready: viewer=% target=%', v_viewer, v_target;
END;
$$;

-- Phase A -- the whole point of 086, both directions at once.
DO $$
DECLARE
  f      record;
  n_wip  int;
  n_earn int;
BEGIN
  SELECT * INTO f FROM t086;
  IF NOT f.ready THEN RETURN; END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', f.viewer_id, 'role', 'authenticated')::text, true);

  -- THE NEGATIVE. This is the assertion that distinguishes 086 from USING
  -- (true). A half-finished progress bar toward someone else's badge is not
  -- a fact she published about herself.
  SELECT count(*) INTO n_wip
  FROM public.user_badge_progress
  WHERE user_id = f.target_id AND badge_id = f.wip_badge;

  IF n_wip <> 0 THEN
    RAISE EXCEPTION
      'LEAK: another member can read an IN-PROGRESS badge row (37/50). 086''s earned_at split is not being enforced';
  END IF;

  -- THE POSITIVE. Without this the migration is just a stricter version of the
  -- bug it was written to fix.
  SELECT count(*) INTO n_earn
  FROM public.user_badge_progress
  WHERE user_id = f.target_id AND badge_id = f.earned_badge;

  IF n_earn <> 1 THEN
    RAISE EXCEPTION
      'STILL BROKEN: another member reads % rows for an EARNED badge, expected 1. ProfileCard.tsx:317 renders blank exactly as before 086',
      n_earn;
  END IF;

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS: viewer sees the earned badge and NOT the in-progress row';
END;
$$;

-- Phase B -- we did not over-restrict. 086 ADDS a policy; the owner must keep
-- reading every row of her own, or the Grow progress bars (grow/badges.tsx:146)
-- and the locked-badge grid (BadgeRow.tsx:71) empty out.
DO $$
DECLARE
  f record;
  n int;
BEGIN
  SELECT * INTO f FROM t086;
  IF NOT f.ready THEN RETURN; END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', f.target_id, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO n
  FROM public.user_badge_progress
  WHERE user_id = f.target_id AND badge_id IN (f.earned_badge, f.wip_badge);

  IF n <> 2 THEN
    RAISE EXCEPTION
      'OVER-RESTRICTED: the owner reads % of her own 2 badge rows. ubp_owner_select must still return in-progress rows to their owner',
      n;
  END IF;

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS: the owner still reads all of her own rows, earned or not';
END;
$$;

-- Phase C -- the target-side gate. A ghosted account's badges must not be a
-- back door to the fact that the account exists.
DO $$
DECLARE
  f record;
  n int;
BEGIN
  SELECT * INTO f FROM t086;
  IF NOT f.ready THEN RETURN; END IF;

  UPDATE public.profiles SET is_ghost = true WHERE id = f.target_id;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', f.viewer_id, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO n
  FROM public.user_badge_progress
  WHERE user_id = f.target_id;

  IF n <> 0 THEN
    RAISE EXCEPTION
      'LEAK: a ghosted member''s earned badges are still readable (% rows). GET /rest/v1/user_badge_progress?select=user_id enumerates the accounts 080 hid',
      n;
  END IF;

  EXECUTE 'RESET ROLE';
  UPDATE public.profiles SET is_ghost = false WHERE id = f.target_id;
  RAISE NOTICE 'PASS: a ghosted profile''s earned badges are refused';
END;
$$;

-- Phase D -- the viewer-side gate. An account still sitting at
-- vetting_status='pending' has not been let in, and reading another member's
-- badges is reading another member's content (072/073/076 doctrine).
DO $$
DECLARE
  f      record;
  n      int;
  v_was  text;
BEGIN
  SELECT * INTO f FROM t086;
  IF NOT f.ready THEN RETURN; END IF;

  -- Captured rather than assumed: the viewer qualifies as approved on either
  -- 'approved' or the grandfathered 'unvetted' (072:51), so a hardcoded
  -- restore would rewrite a real row to the wrong value. ROLLBACK is the real
  -- guarantee; this just keeps the transaction honest while it is open.
  SELECT vetting_status INTO v_was FROM public.profiles WHERE id = f.viewer_id;
  UPDATE public.profiles SET vetting_status = 'pending' WHERE id = f.viewer_id;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', f.viewer_id, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO n
  FROM public.user_badge_progress
  WHERE user_id = f.target_id;

  IF n <> 0 THEN
    RAISE EXCEPTION
      'LEAK: an unapproved (pending) account reads another member''s badges (% rows) -- the invite gate does not cover this table',
      n;
  END IF;

  EXECUTE 'RESET ROLE';
  UPDATE public.profiles SET vetting_status = v_was WHERE id = f.viewer_id;
  RAISE NOTICE 'PASS: a pending applicant is refused another member''s badges';
END;
$$;

-- Phase E -- the shipped anon key. This is the one 080 and 082 were written
-- about, and the reason every policy in 086 carries TO authenticated.
DO $$
DECLARE
  f record;
  n int;
BEGIN
  SELECT * INTO f FROM t086;
  IF NOT f.ready THEN RETURN; END IF;

  EXECUTE 'SET LOCAL ROLE anon';
  -- A valid claims object with no `sub`, not an empty string: auth.uid() casts
  -- this setting to json, and '' would raise a parse error instead of NULL.
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);

  BEGIN
    SELECT count(*) INTO n FROM public.user_badge_progress;
    IF n <> 0 THEN
      RAISE EXCEPTION
        'LEAK: anon reads % rows from user_badge_progress -- user_id is a live auth.users join key and this is a member roster', n;
    END IF;
    RAISE NOTICE 'PASS: anon reads 0 rows from user_badge_progress';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: anon holds no SELECT grant on user_badge_progress at all';
  END;

  EXECUTE 'RESET ROLE';
END;
$$;

ROLLBACK;

\echo '086 verification complete -- every DO block above must have printed PASS or SKIP'
