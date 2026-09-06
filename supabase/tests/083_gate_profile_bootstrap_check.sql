-- ============================================================
-- Verification for 083_gate_profile_bootstrap.sql
--
-- Run against the Roxy project AFTER `npx supabase db push`:
--   psql "$ROXY_DB_URL" -f supabase/tests/083_gate_profile_bootstrap_check.sql
--
-- Every part reads the catalog rather than the migrations table, because a
-- migration file is not an applied migration. No fixture and no user id, so it
-- runs in CI on an empty database forever.
--
-- The single most important assertion in this file is Part 4: gov_id and
-- kyc_liveness must NEVER be self_attestable. 083 makes legal_name
-- self-attestable so its point can be scored at all, and the failure mode of
-- getting that wrong is an applicant scoring herself as identity-verified with
-- no vendor session in existence -- the H1 hole 081 closed.
-- ============================================================

\set ON_ERROR_STOP on

-- ── Part 1: mark_criterion_met exists, and delegates its authorisation ──────

DO $$
DECLARE
  v_oid oid;
  v_src text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'mark_criterion_met'
    AND pg_get_function_identity_arguments(p.oid) = 'p_application_id uuid, p_criterion_id uuid';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'MISSING public.mark_criterion_met(uuid, uuid) -- 083 is not applied, and gateStore.saveLegalName can never score the legal-name criterion';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'mark_criterion_met is not SECURITY DEFINER -- application_criteria_met has no write policy, so it would be refused for every caller';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF v_src NOT LIKE '%can_self_attest_criterion%' THEN
    RAISE EXCEPTION
      'mark_criterion_met does not call can_self_attest_criterion -- 081:158 requires it of every write path onto application_criteria_met, and a second copy of that predicate is how the two drift';
  END IF;

  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'mark_criterion_met is not executable by authenticated -- the applicant cannot call it';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'mark_criterion_met is executable by anon -- the shipped publishable key could reach it without a session';
  END IF;

  RAISE NOTICE 'OK: mark_criterion_met is present, SECURITY DEFINER, delegates to can_self_attest_criterion, authenticated-only';
END;
$$;

-- ── Part 2: application_criteria_met still has no client write path ─────────
-- The RPC is the door. A policy that lets the client write this table directly
-- reopens H1 regardless of how good the RPC is.

DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(policyname || ' (' || cmd || ')', ', ') INTO v_bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'application_criteria_met'
    AND cmd <> 'SELECT';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'application_criteria_met has a non-SELECT policy (%) -- an applicant can score criteria directly again', v_bad;
  END IF;

  RAISE NOTICE 'OK: application_criteria_met is still SELECT-only for every client role';
END;
$$;

-- ── Part 3: the applicant actually gets a profile row ──────────────────────
-- Without this the vetting UPDATE at the end of create_membership_application
-- matches zero rows and returns success, and approval fails on the
-- community_members foreign key. Both are silent.

DO $$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_membership_application';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'MISSING public.create_membership_application -- 071 is not applied';
  END IF;

  IF v_src NOT LIKE '%INSERT INTO public.profiles%' THEN
    RAISE EXCEPTION
      'create_membership_application does not create the applicant profile row -- vetting_status never becomes pending, so the gate does not close and onboarding later creates the row at its unvetted DEFAULT';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_apply_decision';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'MISSING public._apply_decision -- 071 is not applied';
  END IF;

  IF v_src NOT LIKE '%is_active%' THEN
    RAISE EXCEPTION
      '_apply_decision does not lift the dormant applicant placeholder -- an approved member stays is_active = false and is invisible to every other member';
  END IF;

  RAISE NOTICE 'OK: the applicant profile row is created on application and activated on approval';
END;
$$;

-- ── Part 4: the self-attestation boundary is where it should be ────────────
-- Data, not schema, so it is checked against the seeded rows. Skips rather than
-- fails if the seed is absent, because an empty database has no criteria yet.

DO $$
DECLARE
  v_legal   boolean;
  v_gov     boolean;
  v_liveness boolean;
BEGIN
  SELECT self_attestable INTO v_legal
  FROM public.verification_criteria WHERE key = 'legal_name' AND community_id IS NULL;

  SELECT self_attestable INTO v_gov
  FROM public.verification_criteria WHERE key = 'gov_id' AND community_id IS NULL;

  SELECT self_attestable INTO v_liveness
  FROM public.verification_criteria WHERE key = 'kyc_liveness' AND community_id IS NULL;

  IF v_legal IS NULL AND v_gov IS NULL AND v_liveness IS NULL THEN
    RAISE NOTICE 'SKIPPED: the 071 criteria seed is not present on this database';
    RETURN;
  END IF;

  -- The dangerous direction. These two are awarded by the KYC webhook on the
  -- service role and by nothing else, ever.
  IF v_gov IS TRUE OR v_liveness IS TRUE THEN
    RAISE EXCEPTION
      'gov_id or kyc_liveness is self_attestable -- an applicant can score herself as identity-verified with no vendor session (H1, 081:94)';
  END IF;

  -- The benign direction, but it is what makes the legal-name point reachable.
  IF v_legal IS NOT TRUE THEN
    RAISE EXCEPTION
      'legal_name is not self_attestable -- mark_criterion_met refuses the only call the client makes to it, and the point can never be scored by any path';
  END IF;

  RAISE NOTICE 'OK: legal_name is self-attestable; gov_id and kyc_liveness are not';
END;
$$;
