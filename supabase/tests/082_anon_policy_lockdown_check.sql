-- ============================================================
-- Verification for 082_anon_policy_lockdown.sql
--
-- Run against the Roxy project AFTER `npx supabase db push`:
--   psql "$ROXY_DB_URL" -f supabase/tests/082_anon_policy_lockdown_check.sql
--
-- Fixture-free, like 080's check, and for the same reason: an RLS SELECT that
-- matches no row returns 0 rows whether the table is empty or locked, so the
-- assertion "anon sees nothing" is true and meaningful on an empty database and
-- runnable in CI forever. Nothing here needs a seeded user or a real object.
--
-- Part 1 reads the catalog -- are the TO clauses actually applied? (A migration
--        file is not an applied migration.)
-- Part 2 asserts the invariant 082's safety argument rests on: the six buckets
--        are still public, so bytes still come off the CDN un-RLS'd and
--        restricting the listing policy cannot break image rendering.
-- Part 3 impersonates anon and proves the listings and the vote table are shut.
-- Part 4 proves we did not over-restrict -- authenticated must still read all
--        ten, or avatars stop upserting and the badge/roadmap screens go blank.
-- ============================================================

\set ON_ERROR_STOP on

-- ── Part 1: all ten policies exist, are FOR SELECT, and are TO authenticated ─
DO $$
DECLARE
  item   text;
  sch    text;
  tbl    text;
  pol    text;
  found  record;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    -- public tables
    'public:badges:badges_read_all',
    'public:games:games_read_all',
    'public:feature_requests:feature_requests_read',
    'public:feature_votes:feature_votes_read',
    -- storage object listing, one per public bucket
    'storage:objects:avatars_read_public',
    'storage:objects:business_logos_read_public',
    'storage:objects:product_photos_read_public',
    'storage:objects:post_media_read',
    'storage:objects:profile_photos_storage_read',
    'storage:objects:room_banners_read'
  ] LOOP
    sch := split_part(item, ':', 1);
    tbl := split_part(item, ':', 2);
    pol := split_part(item, ':', 3);

    SELECT roles, cmd, qual INTO found
    FROM pg_policies
    WHERE schemaname = sch AND tablename = tbl AND policyname = pol;

    IF found IS NULL THEN
      RAISE EXCEPTION 'MISSING POLICY %.%.% -- migration 082 is not applied', sch, tbl, pol;
    END IF;

    -- The entire point of 082. No TO clause means TO PUBLIC, which means the
    -- anon key hardcoded in apps/mobile/eas.json works against this relation.
    IF NOT (found.roles = '{authenticated}') THEN
      RAISE EXCEPTION
        'POLICY %.%.% is scoped to % -- expected {authenticated}. The shipped anon key can still read this',
        sch, tbl, pol, found.roles;
    END IF;

    -- Guards against a future edit that widens the policy to ALL and silently
    -- hands anon (or anyone) write access under a read policy's name.
    IF found.cmd <> 'SELECT' THEN
      RAISE EXCEPTION
        'POLICY %.%.% is FOR % -- expected SELECT; a read policy must not carry write commands',
        sch, tbl, pol, found.cmd;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: all 10 policies present, FOR SELECT, scoped TO authenticated';
END;
$$;

-- Nothing else may re-open the same six buckets to anon. Policies are OR'd, so
-- one permissive sibling with no TO clause undoes this whole migration.
DO $$
DECLARE
  rec     record;
  leaked  text[] := '{}';
BEGIN
  FOR rec IN
    SELECT policyname, roles, qual
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND cmd IN ('SELECT', 'ALL')
      AND qual ~ '(avatars|business-logos|product-photos|post-media|profile-photos|room-banners)'
      AND ('public' = ANY(roles) OR 'anon' = ANY(roles))
  LOOP
    leaked := leaked || format('%s (roles=%s)', rec.policyname, rec.roles);
  END LOOP;

  IF array_length(leaked, 1) > 0 THEN
    RAISE EXCEPTION
      'LEAK: another SELECT policy still exposes an 082 bucket to anon: %',
      array_to_string(leaked, ', ');
  END IF;

  RAISE NOTICE 'PASS: no sibling SELECT policy re-opens the six buckets to anon';
END;
$$;

-- Informational only: a SELECT policy on storage.objects open to public for some
-- *other* bucket is outside 082's scope, but it is the same defect and the next
-- person should see it here rather than in an audit six months from now.
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT policyname, roles
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND cmd IN ('SELECT', 'ALL')
      AND ('public' = ANY(roles) OR 'anon' = ANY(roles))
      AND qual !~ '(avatars|business-logos|product-photos|post-media|profile-photos|room-banners)'
  LOOP
    RAISE NOTICE 'NOTE: storage.objects policy % is open to % and is not covered by 082 -- same defect, different bucket',
      rec.policyname, rec.roles;
  END LOOP;
END;
$$;

-- ── Part 2: the invariant that makes this migration safe ────────────────────
-- 082 restricts the listing policy on the strength of the buckets being public:
-- public buckets serve bytes over the CDN path without an RLS check, so images
-- keep rendering. Flip one to private and that stops being true -- every avatar,
-- post image and product photo in the product goes dark, because there is no
-- signed-URL or download() code path anywhere in apps/ to fall back on.
-- This assertion is the tripwire for that.
DO $$
DECLARE
  b       text;
  broken  text[] := '{}';
  is_pub  boolean;
BEGIN
  FOREACH b IN ARRAY ARRAY[
    'avatars', 'business-logos', 'product-photos',
    'post-media', 'profile-photos', 'room-banners'
  ] LOOP
    SELECT public INTO is_pub FROM storage.buckets WHERE id = b;

    IF is_pub IS NULL THEN
      broken := broken || (b || ' (bucket missing)');
    ELSIF is_pub = false THEN
      broken := broken || (b || ' (public=false)');
    END IF;
  END LOOP;

  IF array_length(broken, 1) > 0 THEN
    RAISE EXCEPTION
      'RENDERING BROKEN: 082 restricted listing to authenticated because these buckets serve bytes publicly, but: %. Either revert those policies to allow anon SELECT or add signed URLs to apps/.',
      array_to_string(broken, ', ');
  END IF;

  RAISE NOTICE 'PASS: all 6 buckets are still public -- CDN rendering is unaffected by 082';
END;
$$;

-- ── Part 3: live proof under the shipped anon key's role ────────────────────

BEGIN;

SET LOCAL ROLE anon;

-- The two listings named in the brief. `SELECT ... FROM storage.objects WHERE
-- bucket_id = ...` is precisely the query the Storage list endpoint runs under
-- RLS, so zero rows here is zero rows from POST /storage/v1/object/list/<bucket>.
-- A 42501 is an even stronger pass (no table grant at all), so it is accepted.
DO $$
DECLARE
  b      text;
  n      int;
  leaked text[] := '{}';
BEGIN
  FOREACH b IN ARRAY ARRAY['post-media', 'profile-photos'] LOOP
    BEGIN
      SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = b;
      IF n > 0 THEN
        leaked := leaked || format('%s (%s objects)', b, n);
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS: anon has no privilege on storage.objects at all (%)', b;
    END;
  END LOOP;

  IF array_length(leaked, 1) > 0 THEN
    RAISE EXCEPTION
      'LEAK: anon can enumerate % -- paths are <user_uuid>/<timestamp>, so this is a member roster plus an upload timeline with no session',
      array_to_string(leaked, ', ');
  END IF;

  RAISE NOTICE 'PASS: anon lists 0 objects in post-media and profile-photos';
END;
$$;

-- The remaining four buckets, same proof, so a partial revert cannot pass.
DO $$
DECLARE
  b      text;
  n      int;
  leaked text[] := '{}';
BEGIN
  FOREACH b IN ARRAY ARRAY['avatars', 'business-logos', 'product-photos', 'room-banners'] LOOP
    BEGIN
      SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = b;
      IF n > 0 THEN
        leaked := leaked || format('%s (%s objects)', b, n);
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  IF array_length(leaked, 1) > 0 THEN
    RAISE EXCEPTION 'LEAK: anon can enumerate %', array_to_string(leaked, ', ');
  END IF;

  RAISE NOTICE 'PASS: anon lists 0 objects in the other four buckets';
END;
$$;

-- feature_votes is the one that matters most of the four tables: user_id is a
-- bare auth.users FK, so reading this table unauthenticated yields real member
-- UUIDs -- a join key into everything else, and the enumeration primitive 080
-- removed from profiles.
DO $$
DECLARE
  t      text;
  n      int;
  leaked text[] := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY['feature_votes', 'feature_requests', 'badges', 'games'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        leaked := leaked || format('%s (%s rows)', t, n);
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS: anon holds no SELECT grant on public.% at all', t;
    END;
  END LOOP;

  IF array_length(leaked, 1) > 0 THEN
    RAISE EXCEPTION
      'LEAK: anon can read % -- feature_votes.user_id in that set is a live auth.users join key',
      array_to_string(leaked, ', ');
  END IF;

  RAISE NOTICE 'PASS: anon reads 0 rows from feature_votes, feature_requests, badges, games';
END;
$$;

RESET ROLE;

-- ── Part 4: we did not over-restrict ────────────────────────────────────────
-- Everything above is worthless if it also broke the app. A signed-in member
-- must still read all ten, or: the badges screen empties (grow/badges.tsx:40
-- reads badges as an embedded join, and PostgREST applies the embedded table's
-- own RLS), the roadmap board empties (feedbackStore.ts:73), games vanish from
-- Discover and Connect, and -- the loud one -- every `upsert: true` avatar and
-- profile-photo upload starts failing, because upsert needs SELECT on
-- storage.objects as well as INSERT.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text,
  true
);

DO $$
DECLARE
  t       text;
  n       int;
  denied  text[] := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY['badges', 'games', 'feature_requests', 'feature_votes'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    EXCEPTION
      WHEN insufficient_privilege THEN
        denied := denied || t;
    END;
  END LOOP;

  IF array_length(denied, 1) > 0 THEN
    RAISE EXCEPTION
      'OVER-RESTRICTED: authenticated can no longer read % -- badge, roadmap or games screens are now blank',
      array_to_string(denied, ', ');
  END IF;

  RAISE NOTICE 'PASS: authenticated still reads all four public tables';
END;
$$;

DO $$
DECLARE
  b       text;
  n       int;
  denied  text[] := '{}';
BEGIN
  FOREACH b IN ARRAY ARRAY[
    'avatars', 'business-logos', 'product-photos',
    'post-media', 'profile-photos', 'room-banners'
  ] LOOP
    BEGIN
      SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = b;
    EXCEPTION
      WHEN insufficient_privilege THEN
        denied := denied || b;
    END;
  END LOOP;

  IF array_length(denied, 1) > 0 THEN
    RAISE EXCEPTION
      'OVER-RESTRICTED: authenticated denied SELECT on storage.objects for % -- upsert uploads (avatars, profile-photos, business-logos, room-banners) need SELECT alongside INSERT and will now 403',
      array_to_string(denied, ', ');
  END IF;

  RAISE NOTICE 'PASS: authenticated still has object SELECT on all 6 buckets -- upsert uploads survive';
END;
$$;

RESET ROLE;
ROLLBACK;

\echo '082 verification complete -- every DO block above must have printed PASS'
