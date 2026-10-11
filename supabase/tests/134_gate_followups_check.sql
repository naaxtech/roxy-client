-- Behaviour proof for 134_gate_followups.sql on a LOCAL database, applied on
-- top of 129..133. Runs inside one transaction the runner ROLLS BACK.
--   node <scratch>/chain-proof.cjs green
-- Each assertion names its rule so a RED run says which one broke.
\set ON_ERROR_STOP on

-- ── fixtures (as postgres, no JWT) ─────────────────────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- One transaction = one now(): earlier checks' code attempts all count as
-- "this minute". Clear the attempt log for this proof only (rolled back).
DELETE FROM public.code_attempts WHERE true;

INSERT INTO auth.users (id, email, last_sign_in_at) VALUES
  ('13400000-0000-0000-0000-0000000000a1', 'core@gate134.test',     now()),
  ('13400000-0000-0000-0000-0000000000a2', 'staff@gate134.test',    now()),
  ('13400000-0000-0000-0000-0000000000b1', 'admin-a@gate134.test',  now()),
  ('13400000-0000-0000-0000-0000000000b2', 'member-m@gate134.test', now()),
  ('13400000-0000-0000-0000-0000000000b3', 'owner-o@gate134.test',  now()),
  ('13400000-0000-0000-0000-0000000000b4', 'admin-s@gate134.test',  now()),
  ('13400000-0000-0000-0000-0000000000b5', 'admin-p@gate134.test',  now()),
  ('13400000-0000-0000-0000-0000000000b6', 'plain@gate134.test',    now()),
  ('13400000-0000-0000-0000-0000000000c1', 'appl-x@gate134.test',   now() - interval '2 days 3 hours'),
  ('13400000-0000-0000-0000-0000000000c2', 'appl-y@gate134.test',   now()),
  ('13400000-0000-0000-0000-0000000000c3', 'appl-z@gate134.test',   now()),
  ('13400000-0000-0000-0000-0000000000c4', 'appl-r@gate134.test',   now()),
  ('13400000-0000-0000-0000-0000000000c5', 'appl-v@gate134.test',   now()),
  ('13400000-0000-0000-0000-0000000000e1', 'gone-p@gate134.test',   now() - interval '40 days'),
  ('13400000-0000-0000-0000-0000000000e2', 'gone-q@gate134.test',   now() - interval '10 days'),
  ('13400000-0000-0000-0000-0000000000e3', 'gone-buyer@gate134.test', now() - interval '40 days');

INSERT INTO public.profiles (id, username, display_name, is_staff, staff_role, vetting_status, admitted_at, is_active, deleted_at) VALUES
  ('13400000-0000-0000-0000-0000000000a1', 'g134_core',  'Cora Core',  true,  'core',  'approved', now() - interval '90 days', true, NULL),
  ('13400000-0000-0000-0000-0000000000a2', 'g134_staff', 'Sia Staff',  true,  'staff', 'approved', now() - interval '90 days', true, NULL),
  ('13400000-0000-0000-0000-0000000000b1', 'g134_admin', 'Ada Admin',  false, NULL,    'approved', now() - interval '30 days', true, NULL),
  ('13400000-0000-0000-0000-0000000000b2', 'g134_m',     'Mel Member', false, NULL,    'approved', now() - interval '30 days', true, NULL),
  ('13400000-0000-0000-0000-0000000000b3', 'g134_owner', 'Ola Owner',  false, NULL,    'approved', now() - interval '30 days', true, NULL),
  ('13400000-0000-0000-0000-0000000000b4', 'g134_sus',   'Sue Susp',   false, NULL,    'approved', now() - interval '30 days', true, NULL),
  ('13400000-0000-0000-0000-0000000000b6', 'g134_plain', 'Pam Plain',  false, NULL,    'approved', now() - interval '30 days', true, NULL),
  ('13400000-0000-0000-0000-0000000000b5', 'g134_pend',  'Pia Pend',   false, NULL,    'pending',  NULL,                       false, NULL),
  ('13400000-0000-0000-0000-0000000000c1', 'g134_x',     'Xan X',      false, NULL,    'pending',  NULL,                       false, NULL),
  ('13400000-0000-0000-0000-0000000000c2', 'g134_y',     'Yas Y',      false, NULL,    'pending',  NULL,                       false, NULL),
  ('13400000-0000-0000-0000-0000000000c3', 'g134_z',     'Zoe Z',      false, NULL,    'pending',  NULL,                       false, NULL),
  ('13400000-0000-0000-0000-0000000000e1', 'g134_gone',  'Deleted User', true, 'staff', 'approved', now() - interval '200 days', false, now() - interval '31 days'),
  ('13400000-0000-0000-0000-0000000000e2', 'g134_gone2', 'Deleted User', false, NULL,  'approved', now() - interval '200 days', false, now() - interval '5 days'),
  ('13400000-0000-0000-0000-0000000000e3', 'g134_gone3', 'Deleted User', false, NULL,  'approved', now() - interval '200 days', false, now() - interval '31 days');

INSERT INTO public.communities (id, name, slug, category, created_by) VALUES
  ('13400000-0000-0000-0000-0000000000f1', 'Gate134 Circle', 'gate134-circle', 'interest', '13400000-0000-0000-0000-0000000000b3'),
  ('13400000-0000-0000-0000-0000000000f2', 'Gate134 Other',  'gate134-other',  'interest', '13400000-0000-0000-0000-0000000000a1');
INSERT INTO public.community_members (community_id, user_id, role) VALUES
  ('13400000-0000-0000-0000-0000000000f1', '13400000-0000-0000-0000-0000000000b1', 'admin'),
  ('13400000-0000-0000-0000-0000000000f1', '13400000-0000-0000-0000-0000000000b2', 'member'),
  ('13400000-0000-0000-0000-0000000000f1', '13400000-0000-0000-0000-0000000000b6', 'member'),
  ('13400000-0000-0000-0000-0000000000f1', '13400000-0000-0000-0000-0000000000b3', 'member'),
  ('13400000-0000-0000-0000-0000000000f1', '13400000-0000-0000-0000-0000000000b4', 'admin'),
  ('13400000-0000-0000-0000-0000000000f1', '13400000-0000-0000-0000-0000000000b5', 'admin'),
  ('13400000-0000-0000-0000-0000000000f1', '13400000-0000-0000-0000-0000000000e1', 'member')
ON CONFLICT (community_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- ── T0 schema ──────────────────────────────────────────────────────────────
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
  IF v_def !~ '\mapplication_decided\M'
     OR v_def !~ '\mfriend_request\M' OR v_def !~ '\mfriend_accept\M'
     OR v_def !~ '\mcommunity_event\M' OR v_def !~ '\mmessage\M'
     OR v_def !~ '\mchannel_message\M' OR v_def !~ '\mpost_reaction\M'
     OR v_def !~ '\mcomment\M' OR v_def !~ '\mfollow\M'
     OR v_def !~ '\marchive_revision\M' THEN
    RAISE EXCEPTION 'T0 notification types are not the union of 126-133 + application_decided: %', v_def;
  END IF;
  IF has_function_privilege('authenticated', 'public.purge_deleted_accounts()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purge_deleted_accounts()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.purge_deleted_accounts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T0 purge_deleted_accounts is not service_role only';
  END IF;
  IF has_function_privilege('authenticated', 'public.account_purge_storage_batch(integer)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.account_purges', 'SELECT') THEN
    RAISE EXCEPTION 'T0 account purge plumbing is reachable by members';
  END IF;
  IF has_function_privilege('anon', 'public.suspend_member(uuid,text,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.suspend_member(uuid,text,timestamptz)', 'EXECUTE')
     OR to_regprocedure('public.suspend_member(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'T0 suspend_member grants/signature wrong';
  END IF;
  IF has_function_privilege('anon', 'public.invite_code_ledger(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T0 anon can read the invite ledger';
  END IF;
  RAISE NOTICE 'T0 PASS';
END $$;

-- ── T1 suspension: end date, and the gate honours it (SB-08) ───────────────
-- An expired suspension (ended yesterday) is not a suspension.
INSERT INTO public.account_suspensions (user_id, reason, suspended_by, suspended_at, suspended_until)
VALUES ('13400000-0000-0000-0000-0000000000b2', 'old one', '13400000-0000-0000-0000-0000000000a2',
        now() - interval '10 days', now() - interval '1 day');
DO $$
BEGIN
  IF public.is_suspended('13400000-0000-0000-0000-0000000000b2') THEN
    RAISE EXCEPTION 'T1a an expired suspension still suspends';
  END IF;
  IF NOT public.is_approved_member_id('13400000-0000-0000-0000-0000000000b2') THEN
    RAISE EXCEPTION 'T1a a member whose suspension expired is not a member';
  END IF;
  RAISE NOTICE 'T1a PASS';
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean := false; v uuid;
BEGIN
  BEGIN PERFORM public.suspend_member('13400000-0000-0000-0000-0000000000b4', 'spam after warnings', now() - interval '1 hour');
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T1b a suspension ending in the past was accepted'; END IF;

  v := public.suspend_member('13400000-0000-0000-0000-0000000000b4', 'spam after warnings', now() + interval '7 days');
  IF v IS NULL THEN RAISE EXCEPTION 'T1b suspend_member(p_until) returned nothing'; END IF;
  -- The member with an expired suspension can be suspended again.
  v := public.suspend_member('13400000-0000-0000-0000-0000000000b2', 'second strike', NULL);
  RAISE NOTICE 'T1b PASS';
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT suspended_until FROM public.account_suspensions
      WHERE user_id = '13400000-0000-0000-0000-0000000000b4' AND lifted_at IS NULL) IS DISTINCT FROM now() + interval '7 days' THEN
    RAISE EXCEPTION 'T1c the end date was not stored';
  END IF;
  IF (SELECT banned_until FROM auth.users WHERE id = '13400000-0000-0000-0000-0000000000b4') IS DISTINCT FROM now() + interval '7 days' THEN
    RAISE EXCEPTION 'T1c the auth ban does not end on the end date';
  END IF;
  IF NOT public.is_suspended('13400000-0000-0000-0000-0000000000b4') THEN
    RAISE EXCEPTION 'T1c a suspension until next week is not active';
  END IF;
  IF (SELECT count(*) FROM public.account_suspensions
      WHERE user_id = '13400000-0000-0000-0000-0000000000b2' AND lifted_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'T1c the expired suspension was not closed before the new one';
  END IF;
  RAISE NOTICE 'T1c PASS';
END $$;

-- Her token is still valid: the gate itself must say no.
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000b4","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.is_approved_member() THEN
    RAISE EXCEPTION 'T1d SB-08: a suspended member is still a member';
  END IF;
  IF (SELECT count(*) FROM public.profiles WHERE id <> auth.uid()) <> 0 THEN
    RAISE EXCEPTION 'T1d SB-08: a suspended member can still read other members';
  END IF;
  RAISE NOTICE 'T1d PASS';
END $$;
RESET ROLE;
DO $$
BEGIN
  IF public.is_approved_member_id('13400000-0000-0000-0000-0000000000b4') THEN
    RAISE EXCEPTION 'T1e SB-08: is_approved_member_id counts a suspended member';
  END IF;
  RAISE NOTICE 'T1e PASS';
END $$;

-- ── T2 the decision reaches her phone (G-11) ───────────────────────────────
INSERT INTO public.membership_applications (id, auth_user_id, community_id, status, submitted_at, ready_at) VALUES
  ('13400000-0000-0000-0000-00000000aa01', '13400000-0000-0000-0000-0000000000c1', '13400000-0000-0000-0000-0000000000f1', 'pending', now(), now()),
  ('13400000-0000-0000-0000-00000000aa02', '13400000-0000-0000-0000-0000000000c2', '13400000-0000-0000-0000-0000000000f1', 'pending', now(), now());

SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.decide_application('13400000-0000-0000-0000-00000000aa01', 'approved', NULL, NULL);
SELECT public.decide_application('13400000-0000-0000-0000-00000000aa02', 'rejected', 'Could not verify the vouch.', 'not_known');
RESET ROLE;
DO $$
DECLARE v_n integer; v_title text; v_body text;
BEGIN
  SELECT count(*) INTO v_n FROM public.notifications
  WHERE user_id = '13400000-0000-0000-0000-0000000000c1' AND type = 'application_decided';
  IF v_n <> 1 THEN RAISE EXCEPTION 'T2a G-11: approval made % application_decided notifications', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.notifications
  WHERE user_id = '13400000-0000-0000-0000-0000000000c2' AND type = 'application_decided';
  IF v_n <> 1 THEN RAISE EXCEPTION 'T2a G-11: rejection made % application_decided notifications', v_n; END IF;
  SELECT title, body INTO v_title, v_body FROM public.notifications
  WHERE user_id = '13400000-0000-0000-0000-0000000000c2' AND type = 'application_decided';
  IF v_title ILIKE '%reject%' OR v_body ILIKE '%reject%' OR v_body ILIKE '%Gate134%' THEN
    RAISE EXCEPTION 'T2a privacy: the rejection notification says rejected or names the community';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_outbox o JOIN public.notifications n ON n.id = o.notification_id
                 WHERE n.user_id = '13400000-0000-0000-0000-0000000000c1' AND n.type = 'application_decided') THEN
    RAISE EXCEPTION 'T2a G-11: the approval was not queued for push';
  END IF;
  RAISE NOTICE 'T2a PASS';
END $$;

INSERT INTO public.application_appeals (id, application_id, reason)
VALUES ('13400000-0000-0000-0000-00000000ab01', '13400000-0000-0000-0000-00000000aa02', 'Ada knows me from the book club.');
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.resolve_appeal('13400000-0000-0000-0000-00000000ab01', 'upheld', 'Checked with the admin, no vouch.');
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.notifications
      WHERE user_id = '13400000-0000-0000-0000-0000000000c2' AND type = 'application_decided') <> 2 THEN
    RAISE EXCEPTION 'T2b G-12: an upheld appeal did not notify her';
  END IF;
  RAISE NOTICE 'T2b PASS';
END $$;

-- ── T3 invite codes: who may mint ──────────────────────────────────────────
-- A community admin who was never granted reviewer can mint for HER community.
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.invite_codes (community_id, created_by, label)
VALUES ('13400000-0000-0000-0000-0000000000f1', '13400000-0000-0000-0000-0000000000b1', 'for Yara');
DO $$
DECLARE ok boolean := false;
BEGIN
  IF (SELECT max_uses FROM public.invite_codes WHERE created_by = auth.uid() AND label = 'for Yara') <> 1 THEN
    RAISE EXCEPTION 'T3a a minted code is not single-use by default';
  END IF;
  BEGIN
    INSERT INTO public.invite_codes (community_id, created_by, label)
    VALUES ('13400000-0000-0000-0000-0000000000f2', auth.uid(), 'not mine');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T3a an admin minted for a community she does not run'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.invite_codes (community_id, created_by, label, max_uses)
    VALUES ('13400000-0000-0000-0000-0000000000f1', auth.uid(), 'five', 5);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T3a an admin minted a multi-use code'; END IF;
  RAISE NOTICE 'T3a PASS';
END $$;

-- The community owner (created_by) mints too, even as a plain member row.
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.invite_codes (community_id, created_by, label)
VALUES ('13400000-0000-0000-0000-0000000000f1', '13400000-0000-0000-0000-0000000000b3', 'owner code');
DO $$ BEGIN RAISE NOTICE 'T3b PASS'; END $$;

-- A plain member, a suspended admin and a pending admin cannot.
RESET ROLE;
-- b6: approved, never suspended, a plain member of the community.
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000b6","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.invite_codes (community_id, created_by, label)
    VALUES ('13400000-0000-0000-0000-0000000000f1', auth.uid(), 'member try');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T3c a plain member minted a code'; END IF;
  RAISE NOTICE 'T3c PASS';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000b4","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.invite_codes (community_id, created_by, label)
    VALUES ('13400000-0000-0000-0000-0000000000f1', auth.uid(), 'suspended try');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T3d a suspended admin minted a code'; END IF;
  RAISE NOTICE 'T3d PASS';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000b5","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.invite_codes (community_id, created_by, label)
    VALUES ('13400000-0000-0000-0000-0000000000f1', auth.uid(), 'pending try');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T3e a not-approved admin minted a code'; END IF;
  RAISE NOTICE 'T3e PASS';
END $$;

-- ── T4 cap: 10 unused codes per admin; staff uncapped ──────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.invite_codes (community_id, created_by, label)
SELECT '13400000-0000-0000-0000-0000000000f1', '13400000-0000-0000-0000-0000000000b1', 'batch ' || i
FROM generate_series(1, 9) i;           -- 1 earlier + 9 = 10 unused
DO $$
DECLARE ok boolean := false;
BEGIN
  IF public.invite_code_quota_ok() THEN
    RAISE EXCEPTION 'T4a quota_ok says yes at 10 unused codes';
  END IF;
  BEGIN
    INSERT INTO public.invite_codes (community_id, created_by, label)
    VALUES ('13400000-0000-0000-0000-0000000000f1', auth.uid(), 'eleventh');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T4a cap: an admin minted an 11th unused code'; END IF;
  RAISE NOTICE 'T4a PASS';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.invite_codes (community_id, created_by, label)
    SELECT '13400000-0000-0000-0000-0000000000f2', '13400000-0000-0000-0000-0000000000a2', 'wave ' || i
    FROM generate_series(1, 25) i;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'T4b staff are capped (%)', SQLERRM;
  END;
  IF (SELECT count(*) FROM public.invite_codes WHERE created_by = auth.uid()) < 25 OR NOT public.invite_code_quota_ok() THEN
    RAISE EXCEPTION 'T4b staff are capped';
  END IF;
  RAISE NOTICE 'T4b PASS';
END $$;

-- ── T5 single use, one person per code ─────────────────────────────────────
RESET ROLE;
SELECT set_config('gate134.code', (SELECT code FROM public.invite_codes WHERE label = 'for Yara'), true);
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb;
BEGIN
  v := public.redeem_invite_code(current_setting('gate134.code'));
  IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION 'T5a first redemption failed: %', v; END IF;
  IF (v->>'approved')::boolean THEN RAISE EXCEPTION 'T5a a code approved someone'; END IF;
  RAISE NOTICE 'T5a PASS';
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.invite_codes WHERE label = 'for Yara'
                 AND redeemed_by = '13400000-0000-0000-0000-0000000000c3' AND redeemed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'T5b redemption did not record who and when';
  END IF;
  RAISE NOTICE 'T5b PASS';
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000c4","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb;
BEGIN
  v := public.redeem_invite_code(current_setting('gate134.code'));
  IF (v->>'ok')::boolean THEN RAISE EXCEPTION 'T5c a used code admitted a second account: %', v; END IF;
  RAISE NOTICE 'T5c PASS';
END $$;

-- The table itself refuses, whatever path writes (SECURITY DEFINER, service).
RESET ROLE;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    UPDATE public.invite_codes SET uses_count = uses_count + 1 WHERE label = 'for Yara';
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5d single-use: a used code took a second redemption at the table'; END IF;
  ok := false;
  BEGIN
    UPDATE public.invite_codes SET redeemed_by = '13400000-0000-0000-0000-0000000000c1' WHERE label = 'for Yara';
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5d who used a code was rewritten'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.invite_codes (community_id, created_by, label, max_uses)
    VALUES ('13400000-0000-0000-0000-0000000000f2', '13400000-0000-0000-0000-0000000000a1', 'service multi', 3);
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5d single-use: a multi-use code was stored'; END IF;
  ok := false;
  BEGIN
    UPDATE public.invite_codes SET revoked_at = now() WHERE label = 'owner code';
    UPDATE public.invite_codes SET revoked_at = NULL WHERE label = 'owner code';
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5d a revoked code was brought back'; END IF;
  RAISE NOTICE 'T5d PASS';
END $$;

-- A store review code goes to review like everyone else.
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT set_config('gate134.review', public.mint_review_code('Play review'), true);
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000c5","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb;
BEGIN
  v := public.redeem_invite_code(current_setting('gate134.review'));
  IF NOT (v->>'ok')::boolean OR (v->>'approved')::boolean OR public.is_approved_member() THEN
    RAISE EXCEPTION 'T5e a store review code approved its redeemer: %', v;
  END IF;
  RAISE NOTICE 'T5e PASS';
END $$;
RESET ROLE;

-- ── T6 accountability ledger ───────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r record; v_other integer;
BEGIN
  SELECT * INTO r FROM public.invite_code_ledger('13400000-0000-0000-0000-0000000000f1', 200) WHERE label = 'for Yara';
  IF r.redeemer_name IS DISTINCT FROM 'Zoe Z' OR r.redeemer_username IS DISTINCT FROM 'g134_z'
     OR r.redeemed_at IS NULL OR r.redeemer_status IS DISTINCT FROM 'pending'
     OR r.minter_name IS DISTINCT FROM 'Ada Admin' OR r.redeemer_last_sign_in IS NULL THEN
    RAISE EXCEPTION 'T6a the admin ledger is missing who used her code: %', row_to_json(r);
  END IF;
  IF r.redeemer_last_sign_in <> date_trunc('day', r.redeemer_last_sign_in) THEN
    RAISE EXCEPTION 'T6a an admin sees the exact sign-in time';
  END IF;
  SELECT count(*) INTO v_other FROM public.invite_code_ledger(NULL, 1000) WHERE minted_by <> auth.uid();
  IF v_other <> 0 THEN RAISE EXCEPTION 'T6a an admin sees % codes she did not mint', v_other; END IF;
  RAISE NOTICE 'T6a PASS';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.invite_code_ledger(NULL, 1000) WHERE label = 'for Yara' AND redeemer_name = 'Zoe Z') THEN
    RAISE EXCEPTION 'T6b staff do not see every code';
  END IF;
  RAISE NOTICE 'T6b PASS';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM * FROM public.invite_code_ledger(NULL, 10);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T6c an applicant read the ledger'; END IF;
  RAISE NOTICE 'T6c PASS';
END $$;
RESET ROLE;

-- ── T7 purge: deleted 30+ days ago = erased, files listed (G-16) ───────────
-- e1 deleted 31 days ago: former staff who decided c1's application, posted,
-- was commented on, had friends, a notification, an application of her own.
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.application_decisions (subject_user_id, decision, note, decided_by)
VALUES ('13400000-0000-0000-0000-0000000000c1', 'approved', 'second look', '13400000-0000-0000-0000-0000000000e1');
INSERT INTO public.membership_applications (auth_user_id, community_id, status, submitted_at, ready_at, decided_at)
VALUES ('13400000-0000-0000-0000-0000000000e1', '13400000-0000-0000-0000-0000000000f1', 'approved', now() - interval '200 days', now() - interval '200 days', now() - interval '199 days');
INSERT INTO public.posts (id, author_id, content) VALUES
  ('13400000-0000-0000-0000-00000000ac01', '13400000-0000-0000-0000-0000000000e1', 'hello');
INSERT INTO public.comments (post_id, author_id, content) VALUES
  ('13400000-0000-0000-0000-00000000ac01', '13400000-0000-0000-0000-0000000000b2', 'hi!');
INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES
  ('13400000-0000-0000-0000-0000000000e1', '13400000-0000-0000-0000-0000000000b2', 'accepted');
INSERT INTO public.notifications (user_id, actor_id, type, title) VALUES
  ('13400000-0000-0000-0000-0000000000b2', '13400000-0000-0000-0000-0000000000e1', 'friend_accept', 'x');
INSERT INTO public.email_queue (email_type, recipient_type, recipient_user_id, payload)
VALUES ('application_approved', 'applicant', '13400000-0000-0000-0000-0000000000e1', '{}');
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
  ('avatars', '13400000-0000-0000-0000-0000000000e1/a.jpg', '13400000-0000-0000-0000-0000000000e1'),
  ('post-media', '13400000-0000-0000-0000-0000000000e1/p.jpg', NULL),
  ('avatars', '13400000-0000-0000-0000-0000000000b2/keep.jpg', '13400000-0000-0000-0000-0000000000b2');
-- e3 deleted 31 days ago but has an order: kept for the accounts.
DO $$
DECLARE v_biz uuid;
BEGIN
  SELECT id INTO v_biz FROM public.businesses LIMIT 1;
  IF v_biz IS NOT NULL THEN
    INSERT INTO public.orders (buyer_id, business_id, shipping_name, shipping_line1, shipping_city, shipping_state,
                               shipping_postal_code, subtotal_cents, platform_fee_cents, stripe_payment_intent_id)
    VALUES ('13400000-0000-0000-0000-0000000000e3', v_biz, 'x', 'x', 'x', 'x', 'x', 100, 10, 'pi_gate134_test');
  ELSE
    UPDATE public.profiles SET deleted_at = now() - interval '1 day' WHERE id = '13400000-0000-0000-0000-0000000000e3';
  END IF;
END $$;

SET LOCAL ROLE service_role;
SELECT set_config('gate134.purge', public.purge_deleted_accounts()::text, true);
RESET ROLE;
DO $$
DECLARE v jsonb := current_setting('gate134.purge')::jsonb; v_files integer;
BEGIN
  IF (v->>'failed')::int <> 0 THEN RAISE EXCEPTION 'T7a G-16: % accounts failed to purge: %', v->>'failed', v; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = '13400000-0000-0000-0000-0000000000e1')
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = '13400000-0000-0000-0000-0000000000e1') THEN
    RAISE EXCEPTION 'T7a G-16: an account deleted 31 days ago was not erased: %', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '13400000-0000-0000-0000-0000000000e2') THEN
    RAISE EXCEPTION 'T7a G-16: an account deleted 5 days ago was erased early';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '13400000-0000-0000-0000-0000000000e3') THEN
    RAISE EXCEPTION 'T7a an account with money records was erased';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.application_decisions
                 WHERE subject_user_id = '13400000-0000-0000-0000-0000000000c1' AND note = 'second look' AND decided_by IS NULL) THEN
    RAISE EXCEPTION 'T7a the decision she made was lost or still points at her';
  END IF;
  SELECT count(*) INTO v_files FROM public.account_purge_storage_batch(100)
  WHERE name LIKE '13400000-0000-0000-0000-0000000000e1/%';
  IF v_files <> 2 THEN RAISE EXCEPTION 'T7b her files are not all listed for deletion (%)', v_files; END IF;
  IF EXISTS (SELECT 1 FROM public.account_purge_storage_batch(100) WHERE name LIKE '13400000-0000-0000-0000-0000000000b2/%') THEN
    RAISE EXCEPTION 'T7b someone else''s file is listed for deletion';
  END IF;
  RAISE NOTICE 'T7a-b PASS';
END $$;

-- The applicant purge used to stop at the decision log (append-only refused
-- the FK's SET NULL).
UPDATE public.membership_applications SET purge_after = now() - interval '1 day'
WHERE id = '13400000-0000-0000-0000-00000000aa02';
SELECT * FROM public.purge_expired_applicant_data();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.membership_applications WHERE id = '13400000-0000-0000-0000-00000000aa02') THEN
    RAISE EXCEPTION 'T7c the expired rejected application was not purged';
  END IF;
  IF (SELECT count(*) FROM public.application_decisions
      WHERE subject_user_id = '13400000-0000-0000-0000-0000000000c2' AND application_id IS NULL) < 2 THEN
    RAISE EXCEPTION 'T7c the decision log lost the rejection';
  END IF;
  BEGIN
    UPDATE public.application_decisions SET note = 'rewritten' WHERE subject_user_id = '13400000-0000-0000-0000-0000000000c2';
    RAISE EXCEPTION 'T7c the decision log can be rewritten';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'T7c PASS';
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL 134 CHECKS PASS'; END $$;
