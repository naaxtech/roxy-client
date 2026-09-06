-- ============================================================
-- Verification for 087_server_authoritative_badges.sql
--
-- Run against the Roxy project AFTER `npx supabase db push`:
--   psql "$ROXY_DB_URL" -f supabase/tests/087_server_authoritative_badges_check.sql
--
-- Run 086's check as well -- the two migrations ship together and 086 asserts
-- the read split this file does not touch.
--
-- Part 1 is fixture-free and reads pg_catalog directly, because a migration
--        FILE is not an APPLIED migration. Its centrepiece is the ACL:
--        has_table_privilege() is the only thing that can tell you the grant
--        came off, and the grant -- not the policy -- is what makes badges
--        unforgeable. A check that only looked at pg_policies would pass
--        against a table `authenticated` can still write at will.
-- Part 2 is behavioural and is built around refusals. Every phase that proves
--        something works is paired with one that proves the matching thing is
--        refused: a suite that only demonstrated the happy path would pass
--        unchanged against the wide-open table this migration exists to close.
--
-- SAFETY. Part 2 runs inside BEGIN ... ROLLBACK. It creates one throwaway
-- community, three throwaway badges and the progress rows that follow from
-- them, and it joins one real profile to the throwaway community so the trigger
-- has something real to observe. That join moves the profile's
-- gamification_points, and the ROLLBACK is what puts it back -- the same
-- pattern 077's Part 3 and 086's Phases C/D already use on this database.
-- Nothing is left behind on either path.
--
-- It needs one active, non-ghost profile. It finds one itself and skips the
-- whole of Part 2 with a NOTICE if the database has none, so this is runnable
-- on an empty database forever.
-- ============================================================

\set ON_ERROR_STOP on

-- ── Part 1a: the grants are off. THE assertion of this migration. ───────────
--
-- Supabase's bootstrap `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,
-- authenticated` is what made badge forgery possible for the life of this
-- product, and no migration before 087 ever took it back. If any of these four
-- flip to true, a member can POST herself an earned badge again and the
-- SECURITY DEFINER points trigger will pay her for it.
DO $$
DECLARE
  item  text;
  role  text;
  priv  text;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'authenticated:INSERT',
    'authenticated:UPDATE',
    'authenticated:DELETE',
    'anon:INSERT',
    'anon:UPDATE',
    'anon:DELETE',
    'anon:SELECT'
  ] LOOP
    role := split_part(item, ':', 1);
    priv := split_part(item, ':', 2);

    IF has_table_privilege(role, 'public.user_badge_progress', priv) THEN
      RAISE EXCEPTION
        'FORGEABLE: role % still holds % on public.user_badge_progress. 087 section 1 is not applied, or a later GRANT put it back -- a member can mint her own earned badges and inflate gamification_points through award_badge_points()',
        role, priv;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: neither anon nor authenticated can write user_badge_progress; anon cannot read it';
END;
$$;

-- The other half of the same statement: we did not over-restrict. The owner
-- SELECT policy is worthless without the SELECT grant behind it, and
-- grow/badges.tsx:39 + profile/edit.tsx:45 both need in-progress rows.
DO $$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.user_badge_progress', 'SELECT') THEN
    RAISE EXCEPTION
      'OVER-RESTRICTED: authenticated lost SELECT on user_badge_progress. Every badge surface in the app goes blank and 086''s two-audience read cannot work at all';
  END IF;

  RAISE NOTICE 'PASS: authenticated still holds SELECT on user_badge_progress';
END;
$$;

-- The catalog. points_value is the multiplier every award is computed from, so
-- a writable badges row is a slower route to the same forgery.
DO $$
DECLARE
  item text;
  role text;
  priv text;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'authenticated:INSERT',
    'authenticated:UPDATE',
    'authenticated:DELETE',
    'anon:INSERT',
    'anon:UPDATE',
    'anon:DELETE',
    'anon:SELECT'
  ] LOOP
    role := split_part(item, ':', 1);
    priv := split_part(item, ':', 2);

    IF has_table_privilege(role, 'public.badges', priv) THEN
      RAISE EXCEPTION
        'FORGEABLE: role % still holds % on public.badges -- points_value is writable, so a badge already earned can simply be repriced',
        role, priv;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('authenticated', 'public.badges', 'SELECT') THEN
    RAISE EXCEPTION
      'OVER-RESTRICTED: authenticated lost SELECT on badges. Every read in the app is .select(''*, badges(*)''), and PostgREST applies the embedded table''s own privileges -- the strip renders blank';
  END IF;

  RAISE NOTICE 'PASS: badges is read-only to authenticated and invisible to anon';
END;
$$;

-- ── Part 1b: the functions exist, and are shaped the way they must be ───────
--
-- SECURITY DEFINER is what lets these write a table nobody else can, so it is
-- also what makes a missing `SET search_path` a privilege-escalation bug rather
-- than a style nit. Asserted for every one of them.
DO $$
DECLARE
  item text;
  sig  text;
  fn   record;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'public.badge_requirement_value(uuid, text, integer)',
    'public._sync_badges_for(uuid, text)',
    'public.sync_my_badges()',
    'public.badges_on_community_join()',
    'public.reconcile_forged_badges(boolean)'
  ] LOOP
    sig := item;

    IF to_regprocedure(sig) IS NULL THEN
      RAISE EXCEPTION
        'MISSING FUNCTION % -- migration 087 is not applied', sig;
    END IF;

    SELECT p.prosecdef, p.proconfig INTO fn
    FROM pg_proc p
    WHERE p.oid = to_regprocedure(sig);

    IF NOT fn.prosecdef THEN
      RAISE EXCEPTION
        'FUNCTION % is SECURITY INVOKER -- it cannot write user_badge_progress after section 1, so awards silently stop happening',
        sig;
    END IF;

    IF fn.proconfig IS NULL
       OR NOT (fn.proconfig && ARRAY['search_path=public']) THEN
      RAISE EXCEPTION
        'FUNCTION % is SECURITY DEFINER with no pinned search_path -- a caller-controlled search_path can redirect its writes',
        sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: all 5 functions exist, SECURITY DEFINER, search_path pinned';
END;
$$;

-- Who may call what. The three internal functions all take a user id or change
-- data wholesale; the only one a member may execute is the one she cannot
-- influence.
DO $$
DECLARE
  item text;
  sig  text;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'public.badge_requirement_value(uuid, text, integer)',
    'public._sync_badges_for(uuid, text)',
    'public.reconcile_forged_badges(boolean)'
  ] LOOP
    sig := item;

    IF has_function_privilege('authenticated', sig, 'EXECUTE') THEN
      RAISE EXCEPTION
        'LEAK: authenticated can EXECUTE % -- it takes a user id, so a member can drive it against another member''s account or read her counts one uuid at a time',
        sig;
    END IF;

    IF has_function_privilege('anon', sig, 'EXECUTE') THEN
      RAISE EXCEPTION
        'LEAK: anon can EXECUTE % -- the publishable key in apps/mobile/eas.json reaches this', sig;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.sync_my_badges()', 'EXECUTE') THEN
    RAISE EXCEPTION
      'sync_my_badges() is not executable by authenticated -- the three badges with no trigger can never be awarded to a real member';
  END IF;

  IF has_function_privilege('anon', 'public.sync_my_badges()', 'EXECUTE') THEN
    RAISE EXCEPTION
      'LEAK: anon can EXECUTE sync_my_badges(). It raises on a NULL auth.uid(), but an unauthenticated role should not reach a writer at all';
  END IF;

  RAISE NOTICE 'PASS: internals are unreachable by client roles; sync_my_badges() is authenticated-only';
END;
$$;

-- The member-facing entry point takes no arguments. This is the structural
-- statement of "derive, never accept": there is no count, no threshold, no
-- earned_at and no user id in the call, so there is no field to falsify.
DO $$
DECLARE
  n int;
BEGIN
  SELECT pronargs INTO n FROM pg_proc WHERE oid = to_regprocedure('public.sync_my_badges()');

  IF n <> 0 THEN
    RAISE EXCEPTION
      'sync_my_badges() now takes % argument(s). Every argument on this function is a value a client supplies, and the whole design is that it supplies none',
      n;
  END IF;

  RAISE NOTICE 'PASS: sync_my_badges() takes no arguments -- nothing in the call can be forged';
END;
$$;

-- ── Part 1c: the earn event is actually wired ───────────────────────────────
DO $$
DECLARE
  t record;
BEGIN
  SELECT tgtype, tgenabled INTO t
  FROM pg_trigger
  WHERE tgrelid = 'public.community_members'::regclass
    AND tgname  = 'trg_badges_on_community_join'
    AND NOT tgisinternal;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'MISSING TRIGGER trg_badges_on_community_join on community_members -- the award path exists but nothing calls it, which is the state 087 was written to end';
  END IF;

  -- tgtype bit 0 = ROW, bit 2 = INSERT. AFTER is bit 1 clear.
  IF (t.tgtype & 1) = 0 THEN
    RAISE EXCEPTION 'trg_badges_on_community_join is a STATEMENT trigger -- NEW.user_id is not available and no member is ever awarded';
  END IF;
  IF (t.tgtype & 4) = 0 THEN
    RAISE EXCEPTION 'trg_badges_on_community_join does not fire on INSERT';
  END IF;
  IF (t.tgtype & 2) <> 0 THEN
    RAISE EXCEPTION 'trg_badges_on_community_join is a BEFORE trigger -- it would count the join before the row exists and award nothing';
  END IF;
  IF t.tgenabled = 'D' THEN
    RAISE EXCEPTION 'trg_badges_on_community_join is DISABLED';
  END IF;

  RAISE NOTICE 'PASS: trg_badges_on_community_join is an enabled AFTER INSERT row trigger';
END;
$$;

-- The points path 087 deliberately reuses rather than replaces. If 007's
-- trigger ever goes away, badges are awarded and paid for with nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.user_badge_progress'::regclass
      AND tgname  = 'trg_award_badge_points'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'MISSING TRIGGER trg_award_badge_points (007:58) -- _sync_badges_for sets earned_at in a separate UPDATE precisely so this fires; without it no badge is ever worth any points';
  END IF;

  RAISE NOTICE 'PASS: trg_award_badge_points still carries the points transition';
END;
$$;

-- 087 keeps ubp_owner_insert/ubp_owner_update behind the revoke rather than
-- dropping them, and 086 pins all four ubp_* policies to authenticated. Both
-- migrations land in the same push, so this asserts the combined end state --
-- if 087 ever starts dropping them, this fails here rather than as a confusing
-- "086 is not applied" in the other file.
DO $$
DECLARE
  item text;
  pol  text;
  r    name[];
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'ubp_earned_public_select',
    'ubp_owner_select',
    'ubp_owner_insert',
    'ubp_owner_update'
  ] LOOP
    pol := item;

    SELECT roles INTO r
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_badge_progress' AND policyname = pol;

    IF r IS NULL THEN
      RAISE EXCEPTION
        'MISSING POLICY public.user_badge_progress.% -- 086 and 087 must be applied together', pol;
    END IF;

    IF NOT (r = '{authenticated}') THEN
      RAISE EXCEPTION
        'POLICY % is scoped to % -- expected {authenticated}', pol, r;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: all 4 ubp_* policies present and TO authenticated';
END;
$$;

-- ── Part 2: behaviour, on fixtures ──────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_user   uuid;
  v_comm   uuid;
  v_joins  int;
  v_tip    uuid;
  v_unre   uuid;
  v_opaq   uuid;
BEGIN
  CREATE TEMP TABLE t087 (
    ready       boolean NOT NULL,
    user_id     uuid,
    community   uuid,
    tipping     uuid,
    unreachable uuid,
    opaque      uuid,
    joins_before int
  ) ON COMMIT DROP;

  SELECT id INTO v_user
  FROM public.profiles
  WHERE is_active = true AND is_ghost = false
  ORDER BY created_at
  LIMIT 1;

  IF v_user IS NULL THEN
    INSERT INTO t087 VALUES (false, NULL, NULL, NULL, NULL, NULL, NULL);
    RAISE NOTICE 'SKIP: Part 2 needs one active, non-ghost profile. Part 1 still ran.';
    RETURN;
  END IF;

  SELECT count(*)::int INTO v_joins
  FROM public.community_members WHERE user_id = v_user;

  INSERT INTO public.communities (name, slug, description, category)
  VALUES ('087 check fixture', '087-check-fixture', 'fixture', 'interest')
  RETURNING id INTO v_comm;

  -- Three fixtures, each proving one rule:
  --   tipping     threshold is exactly one join away, so the trigger has a
  --               visible, deterministic effect no matter how many communities
  --               this profile is already in.
  --   unreachable threshold can never be met, so any earned_at on it is proof
  --               the award path is not checking.
  --   opaque      requirement_type with no server-side source, so it must
  --               produce no row at all.
  INSERT INTO public.badges
    (name, description, emoji, category, points_value, requirement_type, requirement_threshold)
  VALUES
    ('087 check tipping',     'fixture', 'X', 'community', 7,  'community_joins', v_joins + 1),
    ('087 check unreachable', 'fixture', 'X', 'community', 11, 'community_joins', v_joins + 5000),
    ('087 check opaque',      'fixture', 'X', 'community', 13, '087_no_source',   1);

  SELECT id INTO v_tip  FROM public.badges WHERE name = '087 check tipping';
  SELECT id INTO v_unre FROM public.badges WHERE name = '087 check unreachable';
  SELECT id INTO v_opaq FROM public.badges WHERE name = '087 check opaque';

  -- Materialise progress rows without joining anything yet.
  PERFORM public._sync_badges_for(v_user, NULL);

  INSERT INTO t087 VALUES (true, v_user, v_comm, v_tip, v_unre, v_opaq, v_joins);
  RAISE NOTICE 'Fixtures ready: user=% community=% joins_before=%', v_user, v_comm, v_joins;
END;
$$;

-- Phase A -- THE NEGATIVE. A plain authenticated session cannot INSERT.
--
-- The row attempted is one ubp_owner_insert would happily allow (user_id =
-- auth.uid()), which is the point: after 087 the policy is no longer what
-- refuses it. Part 1a is what pins the refusal to the ACL specifically; here we
-- only require that the write does not land.
DO $$
DECLARE
  f       record;
  n       int;
  landed  boolean := false;
BEGIN
  SELECT * INTO f FROM t087;
  IF NOT f.ready THEN RETURN; END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);

  BEGIN
    INSERT INTO public.user_badge_progress (user_id, badge_id, current_value, earned_at)
    VALUES (f.user_id, f.opaque, 1, now());
    landed := true;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  EXECUTE 'RESET ROLE';

  IF landed THEN
    RAISE EXCEPTION
      'FORGEABLE: a plain authenticated session INSERTed an earned badge row for itself. This is the exact request 087 exists to refuse';
  END IF;

  SELECT count(*) INTO n
  FROM public.user_badge_progress
  WHERE user_id = f.user_id AND badge_id = f.opaque;

  IF n <> 0 THEN
    RAISE EXCEPTION 'FORGEABLE: the refused INSERT left % row(s) behind', n;
  END IF;

  RAISE NOTICE 'PASS: authenticated cannot INSERT into user_badge_progress';
END;
$$;

-- Phase B -- THE NEGATIVE, the half that actually paid out. The forgery that
-- inflates gamification_points is the PATCH, not the POST: trg_award_badge_points
-- is AFTER UPDATE (007:58), so it is setting earned_at on an existing row that
-- moves the points.
DO $$
DECLARE
  f      record;
  landed boolean := false;
  v_earn timestamptz;
BEGIN
  SELECT * INTO f FROM t087;
  IF NOT f.ready THEN RETURN; END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);

  BEGIN
    UPDATE public.user_badge_progress
       SET earned_at = now(), current_value = 999999
     WHERE user_id = f.user_id AND badge_id = f.unreachable;
    landed := true;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  EXECUTE 'RESET ROLE';

  IF landed THEN
    RAISE EXCEPTION
      'FORGEABLE: a plain authenticated session UPDATEd its own badge row. PATCH {"earned_at": ...} fires the SECURITY DEFINER points trigger and inflates profiles.gamification_points';
  END IF;

  SELECT earned_at INTO v_earn
  FROM public.user_badge_progress
  WHERE user_id = f.user_id AND badge_id = f.unreachable;

  IF v_earn IS NOT NULL THEN
    RAISE EXCEPTION 'FORGEABLE: the refused UPDATE still set earned_at';
  END IF;

  RAISE NOTICE 'PASS: authenticated cannot UPDATE user_badge_progress';
END;
$$;

-- Phase C -- THE NEGATIVE that distinguishes an award function from an
-- award-anything function. The threshold is unreachable, so the badge must
-- stay unearned no matter how many times the awarder is asked.
DO $$
DECLARE
  f      record;
  r      record;
  v_thr  int;
BEGIN
  SELECT * INTO f FROM t087;
  IF NOT f.ready THEN RETURN; END IF;

  PERFORM public._sync_badges_for(f.user_id, 'community_joins');

  -- NOT FOUND, never `r IS NULL`: a composite is NULL when every field is, and
  -- the legitimate answer here is (current_value 0, earned_at NULL) for a
  -- profile in no communities -- which would read as "no row" and pass a test
  -- that should have failed.
  SELECT ubp.current_value, ubp.earned_at INTO r
  FROM public.user_badge_progress ubp
  WHERE ubp.user_id = f.user_id AND ubp.badge_id = f.unreachable;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The awarder created no progress row for a derivable badge -- grow/badges.tsx has nothing to draw a progress bar from';
  END IF;

  SELECT requirement_threshold INTO v_thr FROM public.badges WHERE id = f.unreachable;

  IF r.earned_at IS NOT NULL THEN
    RAISE EXCEPTION
      'AWARDED WITHOUT EARNING: badge threshold is %, derived progress is %, and earned_at is set. The awarder is not checking the threshold at all',
      v_thr, r.current_value;
  END IF;

  IF r.current_value <> f.joins_before THEN
    RAISE EXCEPTION
      'DERIVATION WRONG: current_value is % but this profile is in % communities. Progress is not being read from community_members',
      r.current_value, f.joins_before;
  END IF;

  RAISE NOTICE 'PASS: a badge whose threshold is not met is not awarded, and its progress is the real count';
END;
$$;

-- Phase D -- THE NEGATIVE against the forgery in its second costume. A number
-- a caller wrote into current_value must not survive a sync and must never buy
-- a badge. Written here at the table (as the owner, since no client role can),
-- which is strictly more generous to the attacker than PostgREST now is.
DO $$
DECLARE
  f record;
  r record;
BEGIN
  SELECT * INTO f FROM t087;
  IF NOT f.ready THEN RETURN; END IF;

  UPDATE public.user_badge_progress
     SET current_value = 999999
   WHERE user_id = f.user_id AND badge_id = f.unreachable;

  PERFORM public._sync_badges_for(f.user_id, 'community_joins');

  SELECT ubp.current_value, ubp.earned_at INTO r
  FROM public.user_badge_progress ubp
  WHERE ubp.user_id = f.user_id AND ubp.badge_id = f.unreachable;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The progress row disappeared during a re-sync -- _sync_badges_for is deleting rows it should only be updating';
  END IF;

  IF r.earned_at IS NOT NULL THEN
    RAISE EXCEPTION
      'FORGEABLE: writing current_value=999999 earned the badge. The awarder is trusting a stored counter instead of deriving one';
  END IF;

  IF r.current_value <> f.joins_before THEN
    RAISE EXCEPTION
      'FORGEABLE: current_value is still % after a sync, expected the derived %. _sync_badges_for is merging with the old value instead of overwriting it',
      r.current_value, f.joins_before;
  END IF;

  RAISE NOTICE 'PASS: a forged current_value is overwritten by the derived count and buys nothing';
END;
$$;

-- Phase E -- THE NEGATIVE for the unknown. A requirement_type with no
-- server-side source must yield no row: a badge nobody can compute is a badge
-- nobody earns, and an empty progress row for one is a bar that can never move.
DO $$
DECLARE
  f record;
  n int;
BEGIN
  SELECT * INTO f FROM t087;
  IF NOT f.ready THEN RETURN; END IF;

  PERFORM public._sync_badges_for(f.user_id, NULL);

  SELECT count(*) INTO n
  FROM public.user_badge_progress
  WHERE user_id = f.user_id AND badge_id = f.opaque;

  IF n <> 0 THEN
    RAISE EXCEPTION
      'A badge with an underivable requirement_type produced % progress row(s). badge_requirement_value returned something other than NULL, or the NULL is being read as 0',
      n;
  END IF;

  RAISE NOTICE 'PASS: an underivable requirement_type produces no row and no award';
END;
$$;

-- Phase F -- we did not over-restrict. The owner must still read her own
-- in-progress rows through ubp_owner_select, or the Grow progress bars
-- (grow/badges.tsx:146) and profile/edit.tsx:295 empty out. This is the
-- requirement the REVOKE is most likely to break.
DO $$
DECLARE
  f record;
  n int;
BEGIN
  SELECT * INTO f FROM t087;
  IF NOT f.ready THEN RETURN; END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO n
  FROM public.user_badge_progress
  WHERE user_id = f.user_id AND badge_id = f.unreachable AND earned_at IS NULL;

  EXECUTE 'RESET ROLE';

  IF n <> 1 THEN
    RAISE EXCEPTION
      'OVER-RESTRICTED: the owner reads % of her own in-progress rows, expected 1. REVOKE ALL took SELECT with it, or ubp_owner_select was lost',
      n;
  END IF;

  RAISE NOTICE 'PASS: the owner still reads her own in-progress rows';
END;
$$;

-- Phase G -- THE POSITIVE. Without this the migration is a lockdown with no
-- award path, which is the state the product has been in since 007.
DO $$
DECLARE
  f          record;
  v_expected int;
  v_before   int;
  v_after    int;
  r          record;
  v_thr      int;
BEGIN
  SELECT * INTO f FROM t087;
  IF NOT f.ready THEN RETURN; END IF;

  -- What this join is worth, read from the catalog rather than hardcoded: this
  -- profile may already hold Community Builder from the 087 backfill, and the
  -- fixture threshold is relative to her existing membership.
  SELECT COALESCE(sum(b.points_value), 0)::int INTO v_expected
  FROM public.badges b
  LEFT JOIN public.user_badge_progress ubp
         ON ubp.badge_id = b.id AND ubp.user_id = f.user_id
  WHERE b.requirement_type      = 'community_joins'
    AND b.requirement_threshold <= f.joins_before + 1
    AND ubp.earned_at IS NULL;

  SELECT gamification_points INTO v_before FROM public.profiles WHERE id = f.user_id;

  -- The real earn event. No RPC, no client, no sync call -- just the write the
  -- app already makes when a woman joins a community.
  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (f.community, f.user_id, 'member');

  SELECT ubp.current_value, ubp.earned_at INTO r
  FROM public.user_badge_progress ubp
  WHERE ubp.user_id = f.user_id AND ubp.badge_id = f.tipping;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'NOT AWARDED: joining a community created no progress row at all for a community_joins badge. trg_badges_on_community_join did not fire';
  END IF;

  SELECT requirement_threshold INTO v_thr FROM public.badges WHERE id = f.tipping;

  IF r.earned_at IS NULL THEN
    RAISE EXCEPTION
      'NOT AWARDED: joining a community did not earn a community_joins badge at threshold %. trg_badges_on_community_join did not fire, or its exception handler swallowed a real failure (check that badges_on_community_join is SECURITY DEFINER -- authenticated has no EXECUTE on _sync_badges_for)',
      v_thr;
  END IF;

  -- The cap. 086's documented residual is that an earned row publishes
  -- current_value to other members; capping it at the threshold is what closes
  -- that, so a regression here is a privacy regression, not a cosmetic one.
  IF r.current_value <> v_thr THEN
    RAISE EXCEPTION
      'CAP LOST: current_value is % on an earned row whose threshold is %. An earned badge is publicly readable under 086 and now leaks a live activity count',
      r.current_value, v_thr;
  END IF;

  SELECT gamification_points INTO v_after FROM public.profiles WHERE id = f.user_id;

  IF v_after - v_before <> v_expected THEN
    RAISE EXCEPTION
      'POINTS WRONG: gamification_points moved by %, expected % from the catalog. award_badge_points() is firing the wrong number of times',
      v_after - v_before, v_expected;
  END IF;

  RAISE NOTICE 'PASS: joining a community awarded the badge, capped current_value, and paid exactly % points', v_expected;
END;
$$;

-- Phase H -- idempotency, asserted on the two things that can go wrong:
-- double-paid points, and a moved earned_at (which would reshuffle the Grow
-- tab's `.order('earned_at')` every time anything synced).
DO $$
DECLARE
  f        record;
  v_earn1  timestamptz;
  v_earn2  timestamptz;
  v_pts1   int;
  v_pts2   int;
BEGIN
  SELECT * INTO f FROM t087;
  IF NOT f.ready THEN RETURN; END IF;

  SELECT earned_at INTO v_earn1
  FROM public.user_badge_progress WHERE user_id = f.user_id AND badge_id = f.tipping;
  SELECT gamification_points INTO v_pts1 FROM public.profiles WHERE id = f.user_id;

  PERFORM public._sync_badges_for(f.user_id, NULL);
  PERFORM public._sync_badges_for(f.user_id, 'community_joins');
  PERFORM public._sync_badges_for(f.user_id, NULL);

  SELECT earned_at INTO v_earn2
  FROM public.user_badge_progress WHERE user_id = f.user_id AND badge_id = f.tipping;
  SELECT gamification_points INTO v_pts2 FROM public.profiles WHERE id = f.user_id;

  IF v_earn1 IS DISTINCT FROM v_earn2 THEN
    RAISE EXCEPTION
      'NOT IDEMPOTENT: earned_at moved from % to % on a re-sync', v_earn1, v_earn2;
  END IF;

  IF v_pts1 <> v_pts2 THEN
    RAISE EXCEPTION
      'NOT IDEMPOTENT: three re-syncs changed gamification_points from % to % -- the badge was paid for more than once',
      v_pts1, v_pts2;
  END IF;

  RAISE NOTICE 'PASS: re-syncing awards nothing twice and does not move earned_at';
END;
$$;

-- Phase I -- the cleanup tool reports without changing anything on its default.
-- A destructive default on a function that revokes badges and points from live
-- accounts is the failure mode this shape exists to avoid.
DO $$
DECLARE
  f        record;
  n        int;
  v_earn1  timestamptz;
  v_earn2  timestamptz;
BEGIN
  SELECT * INTO f FROM t087;
  IF NOT f.ready THEN RETURN; END IF;

  -- Plant a forgery the only way that is still possible: as the table owner.
  UPDATE public.user_badge_progress
     SET earned_at = now()
   WHERE user_id = f.user_id AND badge_id = f.unreachable;

  SELECT earned_at INTO v_earn1
  FROM public.user_badge_progress WHERE user_id = f.user_id AND badge_id = f.unreachable;

  SELECT count(*) INTO n
  FROM public.reconcile_forged_badges()
  WHERE member_id = f.user_id AND badge = f.unreachable;

  IF n <> 1 THEN
    RAISE EXCEPTION
      'reconcile_forged_badges() did not report a badge earned at % against an unreachable threshold. It cannot find the rows 086 would publish',
      v_earn1;
  END IF;

  SELECT earned_at INTO v_earn2
  FROM public.user_badge_progress WHERE user_id = f.user_id AND badge_id = f.unreachable;

  IF v_earn2 IS DISTINCT FROM v_earn1 THEN
    RAISE EXCEPTION
      'DESTRUCTIVE DEFAULT: reconcile_forged_badges() changed data on a dry run';
  END IF;

  -- And it does act when told to.
  PERFORM public.reconcile_forged_badges(false);

  SELECT earned_at INTO v_earn2
  FROM public.user_badge_progress WHERE user_id = f.user_id AND badge_id = f.unreachable;

  IF v_earn2 IS NOT NULL THEN
    RAISE EXCEPTION
      'reconcile_forged_badges(false) did not clear earned_at on a provably unearned badge';
  END IF;

  -- The genuinely earned fixture must survive it untouched. A cleanup that
  -- takes real badges away is worse than the forgeries it removes.
  IF (SELECT earned_at FROM public.user_badge_progress
       WHERE user_id = f.user_id AND badge_id = f.tipping) IS NULL THEN
    RAISE EXCEPTION
      'OVER-REACH: reconcile_forged_badges(false) revoked a badge whose threshold IS met';
  END IF;

  RAISE NOTICE 'PASS: reconcile_forged_badges reports on a dry run, revokes only when told, and spares earned badges';
END;
$$;

ROLLBACK;

\echo '087 verification complete -- every DO block above must have printed PASS or SKIP'
