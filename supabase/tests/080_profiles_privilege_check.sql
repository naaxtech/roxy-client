-- ============================================================
-- Verification for 080_profiles_privilege_and_anon_lockdown.sql
--
-- Run against the Roxy project AFTER `npx supabase db push`:
--   psql "$ROXY_DB_URL" -f supabase/tests/080_profiles_privilege_check.sql
--
-- Unlike 069's check, this one needs NO fixture and NO user id. Column
-- privileges are checked by the executor before any row is touched, so
-- `UPDATE profiles SET is_staff = true WHERE id = auth.uid()` raises 42501 even
-- when auth.uid() is NULL and the statement would have matched zero rows. That
-- makes the escalation proof runnable on an empty database, in CI, forever.
--
-- Part 1 reads the catalog: are the grants and the TO clauses actually there?
--         (The lesson from before: a migration file is not an applied migration.)
-- Part 2 impersonates anon and authenticated and proves the two holes are shut.
-- Part 3 proves we did not over-revoke -- every column the apps write is still
--         writable, so onboarding and profile editing still work.
-- ============================================================

\set ON_ERROR_STOP on

-- ── Part 1: the policies exist, are scoped to authenticated, and have WITH CHECK
DO $$
DECLARE
  item      text;
  tbl       text;
  pol       text;
  found     record;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'profiles:profiles_select_public',
    'profiles:profiles_select_own',
    'profiles:profiles_insert_own',
    'profiles:profiles_update_own',
    'communities:communities_read_public'
  ] LOOP
    tbl := split_part(item, ':', 1);
    pol := split_part(item, ':', 2);

    SELECT roles, qual, with_check INTO found
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = tbl AND policyname = pol;

    IF found IS NULL THEN
      RAISE EXCEPTION 'MISSING POLICY %.% -- migration 080 is not applied', tbl, pol;
    END IF;

    -- The whole point of 080's section 2: no TO clause means TO PUBLIC, which
    -- means the shipped anon key works.
    IF NOT (found.roles = '{authenticated}') THEN
      RAISE EXCEPTION
        'POLICY %.% is scoped to % -- expected {authenticated}. anon can still reach this table',
        tbl, pol, found.roles;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: all 5 policies present and scoped TO authenticated';
END;
$$;

DO $$
DECLARE wc text;
BEGIN
  SELECT with_check INTO wc
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_own';

  IF wc IS NULL THEN
    RAISE EXCEPTION
      'profiles_update_own has no WITH CHECK -- Postgres is silently reusing USING for the new row';
  END IF;

  RAISE NOTICE 'PASS: profiles_update_own has an explicit WITH CHECK (%)', wc;
END;
$$;

-- The escalation surface, asserted column by column against the catalog.
-- has_column_privilege answers the real question: can this role write this
-- column by ANY route -- table grant, column grant, or role inheritance.
DO $$
DECLARE
  col     text;
  blocked text[] := ARRAY[
    -- named in the brief
    'vetting_status', 'is_staff', 'is_verified', 'gov_verified',
    'gamification_points', 'badge_ids', 'admitted_via_code_id', 'admitted_at',
    'streak_count',
    -- same class of hole, found during the 080 audit
    'streak_last_day', 'can_create_room', 'can_submit_game',
    'is_active', 'deleted_at', 'behavioural_consent',
    'stripe_customer_id', 'last_shipping_address', 'created_at'
  ];
  leaked text[] := '{}';
BEGIN
  FOREACH col IN ARRAY blocked LOOP
    IF has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE') THEN
      leaked := leaked || col;
    END IF;
    IF has_column_privilege('authenticated', 'public.profiles', col, 'INSERT') THEN
      leaked := leaked || (col || ' (INSERT)');
    END IF;
  END LOOP;

  IF array_length(leaked, 1) > 0 THEN
    RAISE EXCEPTION 'ESCALATION: authenticated can still write profiles.% ', array_to_string(leaked, ', ');
  END IF;

  RAISE NOTICE 'PASS: authenticated has no INSERT/UPDATE on any of the % protected columns', array_length(blocked, 1);
END;
$$;

-- anon must hold nothing at all on this table.
DO $$
DECLARE leaked text[] := '{}';
BEGIN
  IF has_table_privilege('anon', 'public.profiles', 'INSERT') THEN leaked := leaked || 'INSERT'; END IF;
  IF has_table_privilege('anon', 'public.profiles', 'UPDATE') THEN leaked := leaked || 'UPDATE'; END IF;

  IF array_length(leaked, 1) > 0 THEN
    RAISE EXCEPTION 'anon still holds % on public.profiles', array_to_string(leaked, ', ');
  END IF;

  RAISE NOTICE 'PASS: anon holds no INSERT/UPDATE on public.profiles';
END;
$$;

-- ── Part 2: live proof, no fixture required ─────────────────────────────────

BEGIN;

-- HOLE 2: the shipped anon key must return zero rows.
SET LOCAL ROLE anon;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.profiles;
  IF n > 0 THEN
    RAISE EXCEPTION 'LEAK: anon can read % profile row(s) -- the WLW roster is public', n;
  END IF;
  RAISE NOTICE 'PASS: anon reads 0 rows from public.profiles';
END;
$$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.communities;
  IF n > 0 THEN
    RAISE EXCEPTION 'LEAK: anon can read % community row(s) pre-auth', n;
  END IF;
  RAISE NOTICE 'PASS: anon reads 0 rows from public.communities';
END;
$$;

RESET ROLE;

-- HOLE 1: a signed-in member must not be able to promote herself.
-- The jwt sub is arbitrary on purpose -- the privilege check fires before row
-- matching, so this proves the denial without needing that user to exist.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text,
  true
);

DO $$
DECLARE
  col       text;
  escalated text[] := '{}';
BEGIN
  FOREACH col IN ARRAY ARRAY['vetting_status', 'is_staff'] LOOP
    BEGIN
      IF col = 'vetting_status' THEN
        UPDATE public.profiles SET vetting_status = 'approved' WHERE id = auth.uid();
      ELSE
        UPDATE public.profiles SET is_staff = true WHERE id = auth.uid();
      END IF;
      -- Reaching here means the statement was ACCEPTED. On a populated database
      -- that is a live compromise; on an empty one it is still a compromise
      -- waiting for the first row.
      escalated := escalated || col;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS: authenticated denied UPDATE on profiles.% (42501)', col;
    END;
  END LOOP;

  IF array_length(escalated, 1) > 0 THEN
    RAISE EXCEPTION
      'ESCALATION: a member can PATCH her own profiles.% -- is_roxy_staff()/is_approved_member() are one request away',
      array_to_string(escalated, ' and profiles.');
  END IF;
END;
$$;

-- Self-minting a staff row at creation time must fail on the column grant.
-- Asserted strictly on 42501: any other sqlstate means the privilege check did
-- NOT fire and something else (a constraint) happened to save us, which is not
-- the guarantee we are shipping.
-- The verdict is carried out of the block in a variable rather than raised
-- inside it: a RAISE in the BEGIN body would be caught by this block's own
-- `WHEN others` handler and misreported as INCONCLUSIVE.
DO $$
DECLARE verdict text;
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, username, display_name, is_staff)
    VALUES (auth.uid(), 'escalation_probe', 'probe', true);
    verdict := 'ESCALATION: authenticated inserted a profile row with is_staff = true';
  EXCEPTION
    WHEN insufficient_privilege THEN
      verdict := NULL;
    WHEN others THEN
      verdict := format(
        'INCONCLUSIVE: INSERT was blocked by %s (%s), not by the column grant -- the privilege check did not fire',
        sqlerrm, sqlstate);
  END;

  IF verdict IS NOT NULL THEN
    RAISE EXCEPTION '%', verdict;
  END IF;

  RAISE NOTICE 'PASS: authenticated denied INSERT of profiles.is_staff (42501)';
END;
$$;

-- ── Part 3: we did not over-revoke ──────────────────────────────────────────
-- Every column the shipped code writes must still be writable, or onboarding
-- and profile editing break with a bare 42501 in production.
DO $$
DECLARE
  col     text;
  -- step1-identity.tsx:44 upserts these five; the upsert takes the
  -- ON CONFLICT DO UPDATE path whenever a user re-enters step 1, so they need
  -- INSERT *and* UPDATE.
  onboard text[] := ARRAY['id', 'username', 'display_name', 'identity_labels', 'pronouns'];
  -- profileStore.ts:23 + edit.tsx + settings.tsx + themeStore + friendStore +
  -- studio account-actions/ThemeToggle + onboarding steps 2-4.
  writes  text[] := ARRAY[
    'id', 'username', 'display_name', 'bio', 'avatar_url', 'pronouns',
    'identity_labels', 'interests', 'is_dating_mode', 'is_ghost',
    'onboarding_completed', 'theme_preference', 'notification_preferences',
    'last_seen_at', 'updated_at'
  ];
  missing text[] := '{}';
BEGIN
  FOREACH col IN ARRAY onboard LOOP
    IF NOT has_column_privilege('authenticated', 'public.profiles', col, 'INSERT') THEN
      missing := missing || (col || ' (INSERT -- breaks onboarding/step1-identity.tsx)');
    END IF;
  END LOOP;

  FOREACH col IN ARRAY writes LOOP
    IF NOT has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE') THEN
      missing := missing || (col || ' (UPDATE)');
    END IF;
  END LOOP;

  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'OVER-REVOKED: the app writes these but authenticated cannot: %',
      array_to_string(missing, ', ');
  END IF;

  RAISE NOTICE 'PASS: all % app-written columns remain writable by authenticated', array_length(writes, 1);
END;
$$;

-- A legitimate edit must not be refused. Zero rows matched is the expected and
-- correct outcome here; what we are asserting is the absence of 42501.
DO $$
BEGIN
  UPDATE public.profiles
     SET bio = 'privilege probe', updated_at = now()
   WHERE id = auth.uid();
  RAISE NOTICE 'PASS: authenticated may still edit her own bio';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'OVER-REVOKED: profile/edit.tsx bio save is now denied (42501)';
END;
$$;

RESET ROLE;
ROLLBACK;

\echo '080 verification complete -- every DO block above must have printed PASS'
