-- ============================================================
-- Verification for 081_gate_hardening.sql
--
-- Run against the Roxy project AFTER `npx supabase db push`:
--   psql "$ROXY_DB_URL" -f supabase/tests/081_gate_hardening_check.sql
--
-- Parts 1 and 2 need no fixture and no user id, so they run in CI on an empty
-- database forever. They read the catalog rather than the migrations table,
-- because a migration file is not an applied migration -- and because 069 and
-- 072 can both silently revert later policy work by being re-run out of order
-- (see the HAZARD block at the top of 081).
--
-- Part 3 is the live isolation proof for H1 and H5. It needs real ids, supplied
-- on the command line, and rolls back everything it does:
--
--   psql "$ROXY_DB_URL" \
--     -v outsider="'<uuid of a user who is not in some community>'" \
--     -v applicant="'<uuid of a user with a pending application>'" \
--     -f supabase/tests/081_gate_hardening_check.sql
-- ============================================================

\set ON_ERROR_STOP on

-- ── Part 1: the shape of the fix is actually in the database ────────────────

-- H5 -- the post-visibility rule reaches comments through can_read_post.
DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'can_read_post';

  IF src IS NULL THEN
    RAISE EXCEPTION 'MISSING public.can_read_post -- 069 is not applied';
  END IF;

  IF src NOT LIKE '%posted_as_community%' OR src NOT LIKE '%is_community_member%' THEN
    RAISE EXCEPTION
      'can_read_post does not carry 073''s membership rule -- comments on member-only posts are readable by non-members';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'can_read_comment';

  IF src NOT LIKE '%can_read_post%' THEN
    RAISE EXCEPTION
      'can_read_comment no longer delegates to can_read_post -- it now owns a second copy of the visibility rule';
  END IF;

  RAISE NOTICE 'PASS (H5): comment visibility inherits the post visibility rule';
END;
$$;

-- H1 -- the self-attestation boundary exists and the answers policy uses it.
DO $$
DECLARE
  v_default text;
  v_check   text;
  v_bad     text;
BEGIN
  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'verification_criteria'
    AND column_name = 'self_attestable';

  IF v_default IS NULL THEN
    RAISE EXCEPTION 'MISSING verification_criteria.self_attestable -- 081 is not applied';
  END IF;
  IF v_default NOT LIKE '%false%' THEN
    RAISE EXCEPTION
      'verification_criteria.self_attestable defaults to % -- a new criterion must fail closed', v_default;
  END IF;

  SELECT with_check INTO v_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'application_answers' AND policyname = 'ans_own';

  IF v_check IS NULL OR v_check NOT LIKE '%can_self_attest_criterion%' THEN
    RAISE EXCEPTION
      'ans_own WITH CHECK is % -- an applicant can still answer her way to gov_id and kyc_liveness', coalesce(v_check, 'MISSING');
  END IF;

  -- The two criteria that must never be self-awarded, whatever else is tuned
  -- from the studio.
  SELECT string_agg(key, ', ') INTO v_bad
  FROM public.verification_criteria
  WHERE key IN ('gov_id','kyc_liveness') AND self_attestable = true;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'self_attestable is true on: % -- these are awarded by the KYC webhook only', v_bad;
  END IF;

  RAISE NOTICE 'PASS (H1): answers can only satisfy self-attestable criteria, and the ID checks are not';
END;
$$;

-- M7 -- the direct reviewer UPDATE path is gone, so decide_application is the
-- only way a decision can happen.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'membership_applications'
    AND policyname = 'ma_update_reviewer';

  IF n > 0 THEN
    RAISE EXCEPTION
      'ma_update_reviewer still exists -- a reviewer can PATCH status and skip the audit row, the profile flip and the email';
  END IF;

  RAISE NOTICE 'PASS (M7): decide_application is the only decision path';
END;
$$;

-- M4, M5, M6 -- delete behaviour and the composite key.
DO $$
DECLARE
  item     text;
  tbl      text;
  col      text;
  want     text;
  got      char;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    -- table:column:expected confdeltype  (n = SET NULL, c = CASCADE)
    'application_access_log:viewer_id:n',
    'invite_codes:created_by:n',
    'member_safety:community_id:c'
  ] LOOP
    tbl  := split_part(item, ':', 1);
    col  := split_part(item, ':', 2);
    want := split_part(item, ':', 3);

    SELECT con.confdeltype INTO got
    FROM pg_constraint con
    WHERE con.conrelid = ('public.' || tbl)::regclass
      AND con.contype = 'f'
      AND con.conkey::smallint[] = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = ('public.' || tbl)::regclass AND attname = col AND NOT attisdropped)
      ]::smallint[];

    IF got IS NULL THEN
      RAISE EXCEPTION 'NO foreign key on %.% -- expected one with ON DELETE %', tbl, col, want;
    END IF;

    IF got <> want THEN
      RAISE EXCEPTION
        'FK %.% has ON DELETE % -- expected %. Deleting the parent row destroys data it must not',
        tbl, col, got, want;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS (M4, M5, M6): audit trail, code attribution and safety scoping survive account deletion';
END;
$$;

DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO cols
  FROM pg_constraint con
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
  WHERE con.conrelid = 'public.member_safety'::regclass AND con.contype = 'p';

  IF cols IS DISTINCT FROM 'community_id,user_id' THEN
    RAISE EXCEPTION
      'member_safety primary key is (%) -- expected (user_id, community_id), or a second community cannot record its own rating',
      coalesce(cols, 'none');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'member_safety'
      AND column_name = 'community_id' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'member_safety.community_id is nullable -- an unscoped rating is unreachable by every policy';
  END IF;

  -- The subject of a rating must be someone the community actually has.
  -- coalesce, so a missing policy fails here instead of evaluating to NULL and
  -- quietly passing.
  IF coalesce(
       (SELECT with_check FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'member_safety'
          AND policyname = 'ms_own_community'),
       'MISSING'
     ) NOT LIKE '%subject%' THEN
    RAISE EXCEPTION
      'ms_own_community WITH CHECK has no subject-membership test -- an admin can flag a stranger';
  END IF;

  RAISE NOTICE 'PASS (M6): safety records are keyed per community and only about its own members';
END;
$$;

-- L1 -- the rate-limit thresholds are not published to every account.
DO $$
DECLARE q text;
BEGIN
  SELECT qual INTO q
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'gate_settings' AND policyname = 'gs_read';

  IF q IS NULL THEN
    RAISE EXCEPTION 'MISSING gate_settings.gs_read';
  END IF;
  IF btrim(q) = 'true' THEN
    RAISE EXCEPTION
      'gs_read is still USING (true) -- code_attempt_limit and code_lock_threshold are readable by any account';
  END IF;

  RAISE NOTICE 'PASS (L1): gate thresholds are staff-only';
END;
$$;

-- L8 -- announced_on is recomputed on every update, from the transition rule.
DO $$
DECLARE
  src   text;
  cols  text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_announced_on';

  IF src IS NULL THEN
    RAISE EXCEPTION 'MISSING public.set_announced_on -- 073 is not applied';
  END IF;
  IF src NOT LIKE '%OLD.announced_on%' THEN
    RAISE EXCEPTION
      'set_announced_on still assigns unconditionally -- editing an old announcement burns today''s slot';
  END IF;

  SELECT t.tgattr::text INTO cols
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.posts'::regclass AND t.tgname = 'trg_set_announced_on';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'MISSING trigger trg_set_announced_on on public.posts';
  END IF;
  IF btrim(cols) <> '' THEN
    RAISE EXCEPTION
      'trg_set_announced_on is UPDATE OF <columns> -- a PATCH that writes announced_on directly skips it entirely';
  END IF;

  RAISE NOTICE 'PASS (L8): the announcement date cannot be rewritten by an edit or by a direct PATCH';
END;
$$;

-- ── Part 2: privileges, checked by the executor and so fixture-free ─────────
-- Column and function privileges are enforced before a single row is examined,
-- which is what makes these provable on an empty database.

-- H2 -- the applicant may withdraw and nothing else.
DO $$
DECLARE
  col     text;
  allowed boolean;
BEGIN
  FOREACH col IN ARRAY ARRAY['community_id','code_id','submitted_at','status','decided_at','rejected_until'] LOOP
    allowed := has_column_privilege('authenticated', 'public.membership_applications', col, 'UPDATE');

    IF col = 'status' AND NOT allowed THEN
      RAISE EXCEPTION
        'authenticated cannot UPDATE membership_applications.status -- ma_withdraw_own is now unusable and withdrawal is broken';
    END IF;

    IF col <> 'status' AND allowed THEN
      RAISE EXCEPTION
        'authenticated can still UPDATE membership_applications.% -- an applicant can reassign her own community or forge her queue position',
        col;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS (H2): status is the only client-writable column on an application';
END;
$$;

-- L2 -- has_consent takes its subject from an argument, so no client role may
-- call it. service_role must keep it: kyc-create-session depends on it.
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.has_consent(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can still call has_consent(uuid, text) for any user id';
  END IF;

  IF has_function_privilege('anon', 'public.has_consent(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can still call has_consent(uuid, text) -- the shipped publishable key is enough to probe consent';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.has_consent(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on has_consent -- kyc-create-session (index.ts:64) is now broken';
  END IF;

  RAISE NOTICE 'PASS (L2): has_consent is server-side only and the KYC path still works';
END;
$$;

-- L4 -- lives in 075, checked here because this is the file that gets run.
-- issue_code_for_request must compare the request's own community against the
-- one the caller claims to administer, or an admin of A can answer a request
-- naming B. Skipped rather than failed when 075 has not been pushed yet.
DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'issue_code_for_request';

  IF src IS NULL THEN
    RAISE NOTICE 'SKIPPED (L4): issue_code_for_request does not exist -- 075 is not applied';
    RETURN;
  END IF;

  IF src NOT LIKE '%v_request.community_id IS DISTINCT FROM p_community_id%' THEN
    RAISE EXCEPTION
      'issue_code_for_request does not check the request''s community -- an admin of one community can issue codes against another''s requests';
  END IF;

  RAISE NOTICE 'PASS (L4): a code can only be issued against a request naming that community';
END;
$$;

-- ── Part 3a: H5 live -- a non-member cannot read or write the comments ──────
\if :{?outsider}

BEGIN;

-- Built BEFORE impersonation, on purpose. Once RLS applies, a join to posts
-- hides exactly the rows this test is looking for: the leaked comment would be
-- filtered out by its own parent's policy and the test would pass while the
-- hole was open.
CREATE TEMP TABLE t_hidden_posts ON COMMIT DROP AS
  SELECT p.id
  FROM public.posts p
  WHERE p.community_id IS NOT NULL
    AND p.posted_as_community = false
    AND p.author_id <> :outsider::uuid
    AND NOT EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = p.community_id AND m.user_id = :outsider::uuid
    );

GRANT SELECT ON t_hidden_posts TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', :outsider, 'role', 'authenticated')::text,
  true
);

DO $$
DECLARE
  n_posts int;
  leaked  int;
  victim  uuid;
BEGIN
  SELECT count(*) INTO n_posts FROM t_hidden_posts;
  IF n_posts = 0 THEN
    RAISE NOTICE 'SKIPPED (H5 live): this user can already reach every post -- pick an outsider to a community';
    RETURN;
  END IF;

  SELECT count(*) INTO leaked
  FROM public.comments c
  WHERE c.post_id IN (SELECT id FROM t_hidden_posts);

  IF leaked > 0 THEN
    RAISE EXCEPTION 'LEAK (H5): outsider reads % comment(s) on member-only posts in communities she is not in', leaked;
  END IF;

  RAISE NOTICE 'PASS (H5 live): 0 comments readable across % member-only post(s)', n_posts;

  -- Readable was only half of it: comments_insert goes through the same helper.
  SELECT id INTO victim FROM t_hidden_posts LIMIT 1;
  BEGIN
    INSERT INTO public.comments (post_id, author_id, content)
    VALUES (victim, auth.uid(), 'isolation probe -- rolled back');
    RAISE EXCEPTION 'LEAK (H5): outsider WROTE a comment onto a member-only post she cannot read';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS (H5 live): the write is refused too';
  END;
END;
$$;

ROLLBACK;

\else
\echo 'SKIPPED H5 live -- rerun with -v outsider="''<uuid>''"'
\endif

-- ── Part 3b: H1 live -- she cannot answer her way to a verified identity ────
\if :{?applicant}

BEGIN;

CREATE TEMP TABLE t_app ON COMMIT DROP AS
  SELECT a.id AS application_id,
         a.status,
         (SELECT c.id FROM public.verification_criteria c
           WHERE c.key = 'gov_id' AND c.community_id IS NULL LIMIT 1)      AS gov_id_criterion,
         (SELECT c.id FROM public.verification_criteria c
           WHERE c.key = 'join_reason' AND c.community_id IS NULL LIMIT 1) AS question_criterion
  FROM public.membership_applications a
  WHERE a.auth_user_id = :applicant::uuid;

GRANT SELECT ON t_app TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', :applicant, 'role', 'authenticated')::text,
  true
);

DO $$
DECLARE
  app t_app%ROWTYPE;
  scored int;
BEGIN
  SELECT * INTO app FROM t_app LIMIT 1;

  IF app.application_id IS NULL THEN
    RAISE NOTICE 'SKIPPED (H1 live): that user has no application';
    RETURN;
  END IF;
  IF app.status <> 'pending' THEN
    RAISE NOTICE 'SKIPPED (H1 live): application is %, not pending -- answers are closed either way', app.status;
    RETURN;
  END IF;
  IF app.gov_id_criterion IS NULL OR app.question_criterion IS NULL THEN
    RAISE NOTICE 'SKIPPED (H1 live): the seeded gov_id / join_reason criteria are missing';
    RETURN;
  END IF;

  -- The attack: name the criterion you want, let the trigger score it for you.
  BEGIN
    INSERT INTO public.application_answers (application_id, criterion_id, answer)
    VALUES (app.application_id, app.gov_id_criterion, 'I promise I have one');

    SELECT count(*) INTO scored
    FROM public.application_criteria_met
    WHERE application_id = app.application_id AND criterion_id = app.gov_id_criterion;

    RAISE EXCEPTION
      'SELF-AWARD (H1): applicant inserted an answer for gov_id and sync_answer_criterion scored it (% row(s))', scored;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS (H1 live): gov_id refused';
  END;

  -- And the thing that must still work, or the applicant screen is bricked.
  INSERT INTO public.application_answers (application_id, criterion_id, answer)
  VALUES (app.application_id, app.question_criterion, 'isolation probe -- rolled back')
  ON CONFLICT (application_id, criterion_id) DO UPDATE SET answer = EXCLUDED.answer;

  SELECT count(*) INTO scored
  FROM public.application_criteria_met
  WHERE application_id = app.application_id AND criterion_id = app.question_criterion;

  IF scored = 0 THEN
    RAISE EXCEPTION 'REGRESSION (H1): answering a real question no longer scores it';
  END IF;

  RAISE NOTICE 'PASS (H1 live): the question still answers and still scores';
END;
$$;

ROLLBACK;

\else
\echo 'SKIPPED H1 live -- rerun with -v applicant="''<uuid of a pending applicant>''"'
\endif
