-- Behaviour proof for 130_gate_airtight.sql on a LOCAL database.
-- Runs inside one transaction that the runner ROLLS BACK; leaves nothing behind.
--   node <skill>/scripts/migration-proof.cjs <repo> 130_gate_airtight
-- Each assertion names its finding (G-xx / PRO-01) so a RED run says which rule broke.
\set ON_ERROR_STOP on

-- ── fixtures (as postgres, no JWT) ─────────────────────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

INSERT INTO auth.users (id, email) VALUES
  ('13000000-0000-0000-0000-0000000000a1', 'staff@gate130.test'),
  ('13000000-0000-0000-0000-0000000000a2', 'core@gate130.test'),
  ('13000000-0000-0000-0000-0000000000b1', 'member-m@gate130.test'),
  ('13000000-0000-0000-0000-0000000000b2', 'member-n@gate130.test'),
  ('13000000-0000-0000-0000-0000000000c1', 'applicant-a@gate130.test'),
  ('13000000-0000-0000-0000-0000000000c2', 'applicant-b@gate130.test'),
  ('13000000-0000-0000-0000-0000000000d1', 'nocode-x@gate130.test'),
  ('13000000-0000-0000-0000-0000000000d2', 'nocode-y@gate130.test'),
  ('13000000-0000-0000-0000-0000000000d3', 'vouched-z@gate130.test'),
  ('13000000-0000-0000-0000-0000000000d4', 'reviewer-r@gate130.test'),
  ('13000000-0000-0000-0000-0000000000d5', 'oldclient-q@gate130.test'),
  ('13000000-0000-0000-0000-0000000000e1', 'deleted-d@gate130.test');

INSERT INTO public.profiles (id, username, display_name, is_staff, staff_role, vetting_status, admitted_at, is_active, deleted_at) VALUES
  ('13000000-0000-0000-0000-0000000000a1', 'gate130_staff', 'Sam Staff', true,  'staff', 'approved', now() - interval '90 days', true, NULL),
  ('13000000-0000-0000-0000-0000000000a2', 'gate130_core',  'Kai Core',  true,  'core',  'approved', now() - interval '90 days', true, NULL),
  ('13000000-0000-0000-0000-0000000000b1', 'gate130_m',     'Maya M',    false, NULL,    'approved', now() - interval '8 days',  true, NULL),
  ('13000000-0000-0000-0000-0000000000b2', 'gate130_n',     'Nia N',     false, NULL,    'approved', now() - interval '1 day',   true, NULL),
  ('13000000-0000-0000-0000-0000000000e1', 'gate130_d',     'Dee D',     false, NULL,    'approved', now() - interval '60 days', true, now() - interval '31 days');

UPDATE public.profiles SET last_seen_at = now() WHERE id = '13000000-0000-0000-0000-0000000000b2';

INSERT INTO public.reviewer_settings (user_id, reviewer_agreement_at)
VALUES ('13000000-0000-0000-0000-0000000000a1', now());

INSERT INTO public.communities (id, name, slug, category, created_by)
VALUES ('13000000-0000-0000-0000-0000000000f1', 'Gate Test Circle', 'gate-test-130', 'interest',
        '13000000-0000-0000-0000-0000000000b1');
INSERT INTO public.community_members (community_id, user_id, role)
VALUES ('13000000-0000-0000-0000-0000000000f1', '13000000-0000-0000-0000-0000000000b1', 'admin')
ON CONFLICT (community_id, user_id) DO UPDATE SET role = 'admin';

INSERT INTO public.invite_codes (code, community_id, created_by, max_uses) VALUES
  ('GATETEST01', '13000000-0000-0000-0000-0000000000f1', '13000000-0000-0000-0000-0000000000a2', 1),
  ('GATETEST02', '13000000-0000-0000-0000-0000000000f1', '13000000-0000-0000-0000-0000000000a2', 5),
  ('GATETEST03', '13000000-0000-0000-0000-0000000000f1', '13000000-0000-0000-0000-0000000000a2', 1);

INSERT INTO public.membership_applications (auth_user_id, community_id, status, submitted_at, ready_at, decided_at)
VALUES ('13000000-0000-0000-0000-0000000000e1', '13000000-0000-0000-0000-0000000000f1', 'approved',
        now() - interval '70 days', now() - interval '70 days', now() - interval '65 days');

-- ── T0 schema ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'vetting_status')
     <> '''pending''::text' THEN
    RAISE EXCEPTION 'T0 G-02: vetting_status default is not pending';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE vetting_status = 'unvetted') THEN
    RAISE EXCEPTION 'T0 G-23: unvetted profiles remain';
  END IF;
  IF has_table_privilege('anon', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'T0 G-25: anon can still SELECT profiles';
  END IF;
  IF has_column_privilege('authenticated', 'public.profiles', 'last_seen_at', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'stripe_customer_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'vetting_status', 'SELECT') THEN
    RAISE EXCEPTION 'T0 PRO-01: private profile columns are granted to authenticated';
  END IF;
  RAISE NOTICE 'T0 PASS';
END $$;

-- ── T1 G-02: a client insert is pending whatever it sends ──────────────────
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
INSERT INTO public.profiles (id, username, display_name, vetting_status, admitted_at)
VALUES ('13000000-0000-0000-0000-0000000000d2', 'gate130_y', 'Yara Y', 'approved', now());
DO $$
BEGIN
  IF (SELECT vetting_status FROM public.profiles WHERE id = '13000000-0000-0000-0000-0000000000d2') <> 'pending'
     OR (SELECT admitted_at FROM public.profiles WHERE id = '13000000-0000-0000-0000-0000000000d2') IS NOT NULL THEN
    RAISE EXCEPTION 'T1 G-02: a JWT-authenticated insert kept vetting_status=approved';
  END IF;
  RAISE NOTICE 'T1a PASS';
END $$;

-- raw no-code signup through PostgREST: the column grant + trigger
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.profiles (id, username, display_name)
VALUES ('13000000-0000-0000-0000-0000000000d1', 'gate130_x', 'Xena X');
DO $$
DECLARE ok boolean := false;
BEGIN
  IF public.is_approved_member() THEN
    RAISE EXCEPTION 'T1 G-02: a no-code signup is an approved member';
  END IF;
  IF (SELECT vetting_status FROM public.my_profile) <> 'pending' THEN
    RAISE EXCEPTION 'T1 G-02: my_profile does not show pending';
  END IF;
  BEGIN
    INSERT INTO public.profiles (id, username, vetting_status)
    VALUES ('13000000-0000-0000-0000-0000000000d1', 'x2', 'approved');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; WHEN unique_violation THEN ok := false; END;
  IF NOT ok THEN RAISE EXCEPTION 'T1 G-02: vetting_status is client-insertable'; END IF;
  RAISE NOTICE 'T1b PASS';
END $$;

-- ── T3 G-06 / PRO-01: the waiting room sees nobody ─────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.profiles WHERE id <> auth.uid();
  IF n <> 0 THEN RAISE EXCEPTION 'T3a G-06: a pending account can read % other profiles', n; END IF;
  SELECT count(*) INTO n FROM public.member_presence(ARRAY['13000000-0000-0000-0000-0000000000b2'::uuid]);
  IF n <> 0 THEN RAISE EXCEPTION 'T3a G-06: a pending account can read presence'; END IF;
  IF NOT public.is_username_available('gate130_x') OR public.is_username_available('GATE130_M') THEN
    RAISE EXCEPTION 'T3a username availability is wrong';
  END IF;
  RAISE NOTICE 'T3a PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; ok boolean;
BEGIN
  SELECT count(*) INTO n FROM public.profiles WHERE id IN (
    '13000000-0000-0000-0000-0000000000a1', '13000000-0000-0000-0000-0000000000b2');
  IF n <> 2 THEN RAISE EXCEPTION 'T3b G-06: an approved member cannot see approved members (%)', n; END IF;
  SELECT count(*) INTO n FROM public.profiles WHERE id IN (
    '13000000-0000-0000-0000-0000000000d1', '13000000-0000-0000-0000-0000000000e1');
  IF n <> 0 THEN RAISE EXCEPTION 'T3b G-06: pending or deleted accounts are visible to members'; END IF;

  ok := false;
  BEGIN PERFORM last_seen_at FROM public.profiles LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T3c PRO-01: last_seen_at readable by another member'; END IF;
  ok := false;
  BEGIN PERFORM stripe_customer_id FROM public.profiles LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T3c PRO-01: stripe_customer_id readable by another member'; END IF;
  ok := false;
  BEGIN PERFORM vetting_status FROM public.profiles LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T3c PRO-01: vetting_status readable by another member'; END IF;

  IF (SELECT vetting_status FROM public.my_profile) <> 'approved' OR (SELECT count(*) FROM public.my_profile) <> 1 THEN
    RAISE EXCEPTION 'T3d my_profile does not return her own full row';
  END IF;
  IF (SELECT count(*) FROM public.staff_profiles) <> 0 THEN
    RAISE EXCEPTION 'T3d staff_profiles visible to a non-staff member';
  END IF;
  IF NOT COALESCE((SELECT online FROM public.member_presence(ARRAY['13000000-0000-0000-0000-0000000000b2'::uuid])), false) THEN
    RAISE EXCEPTION 'T3e member_presence does not report an active member online';
  END IF;
  RAISE NOTICE 'T3b-e PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE id = '13000000-0000-0000-0000-0000000000d1' AND vetting_status = 'pending') THEN
    RAISE EXCEPTION 'T3f staff cannot see the pending roster';
  END IF;
  RAISE NOTICE 'T3f PASS';
END $$;

-- ── T6 G-08 + T7 G-14: redemption, drafts, sending ────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb; v2 jsonb;
BEGIN
  v := public.redeem_invite_code(' gatetest01 ');
  IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION 'T6a redeem failed: %', v; END IF;
  v2 := public.redeem_invite_code('GATETEST01');
  IF NOT (v2->>'ok')::boolean OR v2->>'application_id' <> v->>'application_id' OR NOT (v2->>'existing')::boolean THEN
    RAISE EXCEPTION 'T6a G-15: retrying a redemption is not idempotent: %', v2;
  END IF;
  IF (SELECT ready_at FROM public.membership_applications WHERE auth_user_id = auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'T7a G-14: a fresh application is in the queue before she sent it';
  END IF;
  IF (SELECT vetting_status FROM public.my_profile) <> 'pending' THEN
    RAISE EXCEPTION 'T6a applicant profile is not pending';
  END IF;
  UPDATE public.profiles SET username = 'gate130_a', display_name = 'Ada A', onboarding_completed = true
  WHERE id = auth.uid();
  RAISE NOTICE 'T6a PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
DO $$
BEGIN
  IF (SELECT uses_count FROM public.invite_codes WHERE code = 'GATETEST01') <> 1 THEN
    RAISE EXCEPTION 'T6b G-08: a retried redemption consumed a second use';
  END IF;
  IF EXISTS (SELECT 1 FROM public.community_members cm JOIN public.communities c ON c.id = cm.community_id
             WHERE c.slug = 'roxy-official' AND cm.user_id IN ('13000000-0000-0000-0000-0000000000c1', '13000000-0000-0000-0000-0000000000d1')) THEN
    RAISE EXCEPTION 'T11 G-25: an applicant was auto-joined to Roxy Official';
  END IF;
  RAISE NOTICE 'T6b PASS';
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb;
BEGIN
  v := public.redeem_invite_code('GATETEST01');
  IF (v->>'ok')::boolean OR v->>'reason' <> 'exhausted' THEN
    RAISE EXCEPTION 'T6c G-08: a single-use code admitted a second person: %', v;
  END IF;
  RAISE NOTICE 'T6c PASS';
END $$;

-- staff cannot decide a draft; a non-granted admin cannot see it at all
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean := false; v_app uuid;
BEGIN
  SELECT id INTO v_app FROM public.membership_applications WHERE auth_user_id = '13000000-0000-0000-0000-0000000000c1';
  BEGIN
    PERFORM public.decide_application(v_app, 'approved', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T7b G-14: a draft application could be decided'; END IF;
  RAISE NOTICE 'T7b PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb; v_app uuid; v_crit uuid;
BEGIN
  SELECT id INTO v_app FROM public.membership_applications WHERE auth_user_id = auth.uid();
  SELECT id INTO v_crit FROM public.verification_criteria WHERE key = 'join_reason' AND community_id IS NULL;
  INSERT INTO public.application_answers (application_id, criterion_id, answer)
  VALUES (v_app, v_crit, 'asdf')
  ON CONFLICT (application_id, criterion_id) DO UPDATE SET answer = EXCLUDED.answer;
  IF EXISTS (SELECT 1 FROM public.application_criteria_met WHERE application_id = v_app AND criterion_id = v_crit) THEN
    RAISE EXCEPTION 'T15 G-24: "asdf" earned the join_reason point';
  END IF;
  v := public.submit_application();
  IF (v->>'ok')::boolean OR v->>'reason' <> 'join_reason_too_short' THEN
    RAISE EXCEPTION 'T7c G-14: a 4-character reason was accepted: %', v;
  END IF;
  INSERT INTO public.application_answers (application_id, criterion_id, answer)
  VALUES (v_app, v_crit, 'Maya invited me after we met at the Gate Test Circle book club.')
  ON CONFLICT (application_id, criterion_id) DO UPDATE SET answer = EXCLUDED.answer;
  v := public.submit_application();
  IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION 'T7d G-14: a complete application could not be sent: %', v; END IF;
  PERFORM public.save_applicant_legal_name('Ada Lovelace');
  PERFORM public.save_applicant_legal_name('Ada King');
  RAISE NOTICE 'T7d PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.email_queue WHERE email_type = 'application_received'
      AND recipient_user_id = '13000000-0000-0000-0000-0000000000c1') <> 1 THEN
    RAISE EXCEPTION 'T7e G-01: application_received was not queued exactly once';
  END IF;
  IF (SELECT count(*) FROM public.email_queue WHERE email_type = 'staff_application_alert'
      AND recipient_user_id IN ('13000000-0000-0000-0000-0000000000a1', '13000000-0000-0000-0000-0000000000a2')) < 2 THEN
    RAISE EXCEPTION 'T7e G-10: staff were not alerted to a sent application';
  END IF;
  RAISE NOTICE 'T7e PASS';
END $$;

-- ── T4 G-04 + T8 G-09: staff decide; visible at once; record frozen ────────
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_app uuid; ctx jsonb;
BEGIN
  SELECT id INTO v_app FROM public.membership_applications WHERE auth_user_id = '13000000-0000-0000-0000-0000000000c1';
  ctx := public.application_review_context(v_app);
  IF jsonb_array_length(ctx->'answers') <> 1 OR NOT (ctx->>'legal_name_on_file')::boolean
     OR ctx::text LIKE '%Ada King%' OR ctx->'applicant'->>'display_name' <> 'Ada A' THEN
    RAISE EXCEPTION 'T13 G-13: review context is wrong or leaks the legal name: %', ctx;
  END IF;
  IF public.reveal_applicant_legal_name(v_app) <> 'Ada King' THEN
    RAISE EXCEPTION 'T19 G-19: a corrected legal name was not saved';
  END IF;
  PERFORM public.decide_application(v_app, 'approved', 'Known to the circle admin.');
  RAISE NOTICE 'T4a PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
DO $$
DECLARE ok boolean := false;
BEGIN
  IF NOT (SELECT is_active AND vetting_status = 'approved' FROM public.profiles
          WHERE id = '13000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'T4b G-04: an applicant who onboarded while pending was approved into an invisible account';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_members cm JOIN public.communities c ON c.id = cm.community_id
                 WHERE c.slug = 'roxy-official' AND cm.user_id = '13000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'T11 G-25: approval did not join Roxy Official';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.application_decisions WHERE subject_user_id = '13000000-0000-0000-0000-0000000000c1'
                 AND decision = 'approved' AND decided_by = '13000000-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'T8a G-09: approval was not logged with its reviewer';
  END IF;
  IF EXISTS (SELECT 1 FROM public.email_queue WHERE email_type LIKE 'application_%' AND payload ? 'community_name') THEN
    RAISE EXCEPTION 'T10 G-01: an applicant email payload carries the community name';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.email_queue WHERE email_type = 'application_approved'
                 AND recipient_user_id = '13000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'T10 G-01: approval email not queued';
  END IF;
  BEGIN
    UPDATE public.application_decisions SET note = 'rewritten' WHERE subject_user_id = '13000000-0000-0000-0000-0000000000c1';
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T8b G-09: the decision log can be rewritten'; END IF;
  RAISE NOTICE 'T4b/T8b PASS';
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean := false; n int; v_app uuid;
BEGIN
  SELECT id INTO v_app FROM public.membership_applications WHERE auth_user_id = '13000000-0000-0000-0000-0000000000c1';
  BEGIN
    UPDATE public.application_reviews SET decision_note = 'changed my mind' WHERE application_id = v_app;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T8c G-09: a reviewer can rewrite the decision note'; END IF;
  UPDATE public.application_reviews SET watchlist = false WHERE application_id = v_app;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'T8c G-09: a decided review row is still editable'; END IF;
  ok := false;
  BEGIN DELETE FROM public.application_reviews WHERE application_id = v_app;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T8c G-09: a reviewer can delete the review row'; END IF;
  RAISE NOTICE 'T8c PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  UPDATE public.application_answers SET answer = 'I rewrote this after I was let in, which should not be possible.'
  WHERE application_id = (SELECT id FROM public.membership_applications WHERE auth_user_id = auth.uid());
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'T15 G-24: answers are editable after the decision'; END IF;
  RAISE NOTICE 'T15 PASS';
END $$;

-- ── T5 G-07: an admin cannot make herself a gatekeeper ─────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- prod's legacy state: an admin who self-signed the agreement under the old rs_own policy
INSERT INTO public.reviewer_settings (user_id, reviewer_agreement_at, accepts_overflow)
VALUES ('13000000-0000-0000-0000-0000000000b1', now(), true);

SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb; v_crit uuid;
BEGIN
  v := public.redeem_invite_code('GATETEST03');
  IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION 'T5 setup: B could not redeem: %', v; END IF;
  SELECT id INTO v_crit FROM public.verification_criteria WHERE key = 'join_reason' AND community_id IS NULL;
  INSERT INTO public.application_answers (application_id, criterion_id, answer)
  VALUES ((v->>'application_id')::uuid, v_crit, 'I have been part of the circle''s online group for a year now.');
  v := public.submit_application();
  IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION 'T5 setup: B could not send: %', v; END IF;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean; v_app uuid;
BEGIN
  SELECT id INTO v_app FROM public.membership_applications WHERE auth_user_id = '13000000-0000-0000-0000-0000000000c2';
  IF v_app IS NOT NULL OR public.can_review_application(
       (SELECT a.id FROM public.membership_applications a WHERE false)) THEN
    RAISE EXCEPTION 'T5a G-07: a self-signed admin can read the application';
  END IF;
  ok := false;
  BEGIN
    INSERT INTO public.invite_codes (community_id, created_by, max_uses, expires_at)
    VALUES ('13000000-0000-0000-0000-0000000000f1', auth.uid(), 5, now() + interval '7 days');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5b G-07: a self-signed admin can mint codes'; END IF;
  ok := false;
  BEGIN
    UPDATE public.reviewer_settings SET reviewer_granted_at = now() WHERE user_id = auth.uid();
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5c G-07: an admin can grant herself reviewer'; END IF;
  ok := false;
  BEGIN PERFORM public.sign_reviewer_agreement();
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5c G-07: an ungranted admin can sign the agreement'; END IF;
  ok := false;
  BEGIN PERFORM public.grant_reviewer(auth.uid(), true);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5c G-07: a member can call grant_reviewer'; END IF;
  RAISE NOTICE 'T5a-c PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.grant_reviewer('13000000-0000-0000-0000-0000000000b1', true);

-- a draft (never sent) in the reviewer's own community
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.membership_applications (auth_user_id, community_id, status, submitted_at)
VALUES ('13000000-0000-0000-0000-0000000000d1', '13000000-0000-0000-0000-0000000000f1', 'pending', now() - interval '3 days');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean; v_app uuid;
BEGIN
  SELECT id INTO v_app FROM public.membership_applications WHERE auth_user_id = '13000000-0000-0000-0000-0000000000c2';
  IF v_app IS NULL OR NOT public.can_review_application(v_app) THEN
    RAISE EXCEPTION 'T5d G-07: a granted reviewer cannot see her community''s sent application';
  END IF;
  IF EXISTS (SELECT 1 FROM public.membership_applications WHERE auth_user_id = '13000000-0000-0000-0000-0000000000d1') THEN
    RAISE EXCEPTION 'T5d G-14: a community reviewer can see a draft that was never sent';
  END IF;
  ok := false;
  BEGIN
    INSERT INTO public.invite_codes (community_id, created_by, max_uses, expires_at)
    VALUES ('13000000-0000-0000-0000-0000000000f1', auth.uid(), NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5e G-18: a reviewer minted an unlimited, never-expiring code'; END IF;
  INSERT INTO public.invite_codes (community_id, created_by, max_uses, expires_at)
  VALUES ('13000000-0000-0000-0000-0000000000f1', auth.uid(), 5, now() + interval '7 days');
  ok := false;
  BEGIN PERFORM public.reveal_applicant_legal_name(v_app);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5f G-07: a community reviewer can reveal a legal name'; END IF;
  PERFORM public.decide_application(v_app, 'rejected', 'Nobody in the circle knows her yet.', 'not_known');
  RAISE NOTICE 'T5d-f PASS';
END $$;

-- ── T9 G-12: reason shown, appeal heard by staff ───────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean := false; v_app public.membership_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM public.membership_applications WHERE auth_user_id = auth.uid();
  IF v_app.decision_reason <> 'not_known' OR v_app.rejected_until IS NULL THEN
    RAISE EXCEPTION 'T9a G-12: rejected applicant cannot see her reason category / cooldown';
  END IF;
  INSERT INTO public.application_appeals (application_id, reason)
  VALUES (v_app.id, 'Please look again: Maya has known me for years.');
  BEGIN
    UPDATE public.application_appeals SET reason = 'edited after the fact, oops' WHERE application_id = v_app.id;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T9b G-24: an appeal is editable'; END IF;
  RAISE NOTICE 'T9a-b PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.resolve_appeal((SELECT id FROM public.application_appeals LIMIT 1), 'overturned', 'I would like her in please.');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T9c G-12: a community reviewer resolved an appeal'; END IF;
  RAISE NOTICE 'T9c PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.resolve_appeal(
  (SELECT ap.id FROM public.application_appeals ap JOIN public.membership_applications a ON a.id = ap.application_id
   WHERE a.auth_user_id = '13000000-0000-0000-0000-0000000000c2'),
  'overturned', 'Spoke to the circle admin; she is known.');

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
DO $$
BEGIN
  IF NOT (SELECT vetting_status = 'approved' AND is_active FROM public.profiles WHERE id = '13000000-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'T9d G-12: an overturned appeal did not admit her';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.application_decisions WHERE subject_user_id = '13000000-0000-0000-0000-0000000000c2' AND decision = 'appeal_overturned')
     OR NOT EXISTS (SELECT 1 FROM public.application_decisions WHERE subject_user_id = '13000000-0000-0000-0000-0000000000c2' AND decision = 'rejected' AND reason_category = 'not_known') THEN
    RAISE EXCEPTION 'T9d G-09: rejection + appeal not both in the log';
  END IF;
  IF (SELECT count(*) FROM public.email_queue WHERE email_type = 'staff_appeal_alert') < 2 THEN
    RAISE EXCEPTION 'T9d G-12: staff were not alerted to the appeal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.email_queue WHERE email_type = 'application_approved'
                 AND recipient_user_id = '13000000-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'T9d G-01: no approval email after an overturned appeal';
  END IF;
  RAISE NOTICE 'T9d PASS';
END $$;

-- ── T6d G-08: RPC rate limit; members are never demoted ───────────────────
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb; i int;
BEGIN
  FOR i IN 1..5 LOOP
    v := public.redeem_invite_code('NOPE00000' || i);
  END LOOP;
  v := public.redeem_invite_code('GATETEST02');
  IF v->>'reason' IS DISTINCT FROM 'rate_limited' THEN
    RAISE EXCEPTION 'T6d G-08: the redemption RPC has no rate limit: %', v;
  END IF;
  RAISE NOTICE 'T6d PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb;
BEGIN
  v := public.redeem_invite_code('GATETEST02');
  IF v->>'reason' IS DISTINCT FROM 'already_member' OR (SELECT vetting_status FROM public.my_profile) <> 'approved' THEN
    RAISE EXCEPTION 'T6e G-08: an approved member redeeming a code was demoted: %', v;
  END IF;
  v := public.my_member_invites();
  IF v->>'status' <> 'waiting' THEN RAISE EXCEPTION 'T12a G-18: a 1-day member got codes: %', v; END IF;
  RAISE NOTICE 'T6e/T12a PASS';
END $$;

-- ── T12 G-18: member vouch codes after 7 days ──────────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb;
BEGIN
  v := public.my_member_invites();
  IF v->>'status' <> 'ready' OR jsonb_array_length(v->'codes') <> 2 THEN
    RAISE EXCEPTION 'T12b G-18: an 8-day member did not get 2 codes: %', v;
  END IF;
  v := public.my_member_invites();
  IF jsonb_array_length(v->'codes') <> 2 THEN
    RAISE EXCEPTION 'T12b G-18: asking twice minted more codes';
  END IF;
  PERFORM set_config('gate130.member_code', v->'codes'->0->>'code', true);
  RAISE NOTICE 'T12b PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb;
BEGIN
  v := public.redeem_invite_code(current_setting('gate130.member_code'));
  IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION 'T12c G-18: a member vouch code does not redeem: %', v; END IF;
  RAISE NOTICE 'T12c PASS';
END $$;

-- ── T14 G-22: store review code ────────────────────────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM public.mint_review_code('App Store review');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T14a G-22: non-core staff minted a review code'; END IF;
  RAISE NOTICE 'T14a PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT set_config('gate130.review_code', public.mint_review_code('App Store review'), true);

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb;
BEGIN
  v := public.redeem_invite_code(current_setting('gate130.review_code'));
  IF NOT (v->>'ok')::boolean OR NOT (v->>'approved')::boolean OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'T14b G-22: a store review code did not admit the reviewer: %', v;
  END IF;
  RAISE NOTICE 'T14b PASS';
END $$;

-- ── T17 older installed builds still redeem (and are sent at once) ─────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000d5","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_app uuid;
BEGIN
  v_app := public.create_membership_application('GATETEST02');
  IF v_app IS NULL OR (SELECT ready_at FROM public.membership_applications WHERE id = v_app) IS NULL THEN
    RAISE EXCEPTION 'T17 legacy create_membership_application broke';
  END IF;
  RAISE NOTICE 'T17 PASS';
END $$;

-- ── T16 G-16: deleted accounts are out, and purged ─────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.is_approved_member() THEN RAISE EXCEPTION 'T16a G-16: a deleted account is still a member'; END IF;
  IF (SELECT count(*) FROM public.profiles WHERE id <> auth.uid()) <> 0 THEN
    RAISE EXCEPTION 'T16a G-16: a deleted account can read profiles';
  END IF;
  RAISE NOTICE 'T16a PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM public.purge_expired_applicant_data();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.membership_applications WHERE auth_user_id = '13000000-0000-0000-0000-0000000000e1') THEN
    RAISE EXCEPTION 'T16b G-16: a 31-day-deleted account kept its application';
  END IF;
  RAISE NOTICE 'T16b PASS';
END $$;

-- ── T2 G-23: grandfathered accounts (fixture seeded by the pre-step) ───────
DO $$
DECLARE g uuid := '13000000-0000-0000-0000-0000000000f9';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = g) THEN
    RAISE NOTICE 'T2 SKIPPED (no pre-migration unvetted fixture in this run)';
    RETURN;
  END IF;
  IF NOT (SELECT vetting_status = 'approved' AND admitted_at IS NOT NULL AND is_active
          FROM public.profiles WHERE id = g) THEN
    RAISE EXCEPTION 'T2 G-23: the unvetted account was not grandfathered to an active approved member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.application_decisions WHERE subject_user_id = g
                 AND decision = 'grandfathered' AND note = 'grandfathered pre-gate member') THEN
    RAISE EXCEPTION 'T2 G-23: grandfathering left no decision-log row';
  END IF;
  RAISE NOTICE 'T2 PASS';
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL 130 CHECKS PASS'; END $$;
