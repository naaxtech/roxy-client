-- ============================================================
-- Verification for 069_community_content_visibility_rls.sql
--
-- Run against the Roxy project AFTER `npx supabase db push`:
--   psql "$ROXY_DB_URL" -f supabase/tests/069_community_visibility_check.sql
--
-- Part 1 is fixture-free and answers the question that has burned us before:
-- "is the migration actually applied, or does the file just exist?" It reads
-- pg_policies rather than trusting the migrations table.
--
-- Part 2 is the real proof: it impersonates a non-member and confirms private
-- community content is unreadable. It needs one non-member user id, passed in.
-- ============================================================

\set ON_ERROR_STOP on

-- ── Part 1: the policies exist and are not USING (true) ─────────────────────
DO $$
DECLARE
  expected text[] := ARRAY[
    'posts:posts_select', 'posts:posts_select_staff', 'posts:posts_insert',
    'comments:comments_select', 'comments:comments_select_staff', 'comments:comments_insert',
    'post_likes:pl_select', 'post_likes:pl_select_staff', 'post_likes:pl_insert',
    'post_saves:ps_select', 'post_saves:ps_insert',
    'comment_likes:cl_select', 'comment_likes:cl_select_staff', 'comment_likes:cl_insert'
  ];
  item text;
  tbl  text;
  pol  text;
  found_qual text;
BEGIN
  FOREACH item IN ARRAY expected LOOP
    tbl := split_part(item, ':', 1);
    pol := split_part(item, ':', 2);

    SELECT coalesce(qual, with_check) INTO found_qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = tbl AND policyname = pol;

    IF found_qual IS NULL THEN
      RAISE EXCEPTION 'MISSING POLICY %.% -- migration 069 is not applied', tbl, pol;
    END IF;

    IF btrim(found_qual) = 'true' THEN
      RAISE EXCEPTION 'POLICY %.% is still USING (true) -- 069 did not take effect', tbl, pol;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: all 14 policies present, none open';
END;
$$;

-- The helper functions must exist and be SECURITY DEFINER, or the policies
-- silently fall back to the caller's own (RLS-filtered) view of membership.
DO $$
DECLARE fn text; n int;
BEGIN
  FOREACH fn IN ARRAY ARRAY['can_read_community_content','can_read_post','can_read_comment','is_roxy_staff'] LOOP
    SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = fn AND p.prosecdef = true;

    IF n = 0 THEN
      RAISE EXCEPTION 'MISSING or non-SECURITY-DEFINER function public.%', fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: all 4 helpers present and SECURITY DEFINER';
END;
$$;

-- ── Part 2: a non-member cannot read a private community's content ──────────
-- Supply a user id that is NOT a member of at least one private community:
--   psql "$ROXY_DB_URL" -v outsider="'00000000-0000-0000-0000-000000000000'" -f ...
-- Skipped when :outsider is unset, so Part 1 still runs standalone.
\if :{?outsider}

BEGIN;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', :outsider, 'role', 'authenticated')::text,
  true
);

DO $$
DECLARE leaked int;
BEGIN
  SELECT count(*) INTO leaked
  FROM public.posts p
  JOIN public.communities c ON c.id = p.community_id
  WHERE c.is_private = true
    AND NOT EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = c.id
        AND m.user_id = (current_setting('request.jwt.claims')::json ->> 'sub')::uuid
    );

  IF leaked > 0 THEN
    RAISE EXCEPTION 'LEAK: outsider can read % post(s) in private communities', leaked;
  END IF;

  RAISE NOTICE 'PASS: outsider reads 0 posts from private communities they are not in';
END;
$$;

DO $$
DECLARE leaked int;
BEGIN
  SELECT count(*) INTO leaked
  FROM public.post_likes
  WHERE user_id <> (current_setting('request.jwt.claims')::json ->> 'sub')::uuid;

  IF leaked > 0 THEN
    RAISE EXCEPTION 'LEAK: outsider can read % like row(s) belonging to other users', leaked;
  END IF;

  RAISE NOTICE 'PASS: like rows are own-row only';
END;
$$;

ROLLBACK;

\else
\echo 'SKIPPED Part 2 -- rerun with -v outsider="''<uuid>''" to prove isolation live'
\endif
