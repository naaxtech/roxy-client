-- ============================================================
-- 083_gate_profile_bootstrap.sql
--
-- The invite gate never actually closes, and the reason is one row that does not
-- exist yet. Fixed forward: 069-082 are applied to production and are never
-- edited, so everything here is additive or a CREATE OR REPLACE of an object
-- they created -- the same shape as 081.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- There is no handle_new_user trigger on auth.users. 080:50 says so outright
-- after auditing every write path: the ONLY thing that ever creates a
-- public.profiles row is the client upsert in onboarding step 1
-- (apps/mobile/app/(auth)/onboarding/step1-identity.tsx:39). profiles.username
-- and profiles.display_name are NOT NULL with no default (001:5-6), so the row
-- cannot be created before she has picked a username.
--
-- But the gate runs BEFORE onboarding, on purpose -- apps/mobile/app/_layout.tsx
-- :103 "The gate outranks onboarding... She waits, and completes onboarding once
-- a human says yes." So for the entire life of an application, the applicant has
-- an auth.users row and no profiles row. Four things break on that, and every
-- one of them is silent:
--
--   1. create_membership_application (071:426) ends with
--        UPDATE public.profiles SET vetting_status = 'pending' WHERE id = auth.uid()
--      An UPDATE that matches no rows is not an error. It affects zero rows and
--      returns success. So the RPC reports an application id, the applicant is
--      told she is in the queue, and NOTHING recorded that she is pending.
--
--   2. is_approved_member() (072:39) is EXISTS(... WHERE id = auth.uid() AND
--      vetting_status IN ('approved','unvetted')). With no row it returns false,
--      so she is denied everything -- correct behaviour reached by accident,
--      because the row is absent rather than because it says 'pending'.
--
--   3. The accident then reverses. She is routed to onboarding, step 1 inserts
--      her profile, and vetting_status takes its column DEFAULT -- which 079 set
--      back to 'unvetted' precisely so the un-gated live build keeps working.
--      'unvetted' is the grandfather state with FULL ACCESS. So the finished
--      journey is: hold a code, sign up, get admitted to the entire app without
--      a reviewer ever seeing the application. The gate is not merely open, it
--      is open for exactly the people who came through the front door.
--
--   4. And a reviewer cannot close it by hand either. _apply_decision (071:516)
--      inserts into community_members on approval, whose user_id is a foreign
--      key to profiles(id) (003:34). With no profile row that INSERT raises
--      23503 and the whole decide_application transaction aborts. Approving a
--      genuine applicant fails with a raw foreign-key error.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
-- Make the row exist at the only moment that is guaranteed to precede all four:
-- when the application is created. create_membership_application is already
-- SECURITY DEFINER, already writes this exact row, and is already the one place
-- that knows an applicant now exists.
--
-- The alternative -- a trigger on profiles that back-fills vetting_status when
-- onboarding finally inserts the row -- was rejected: it leaves (4) broken
-- (approval still cannot join her to the community that vouched), and it splits
-- admission across two objects that have to be kept in step. One writer is the
-- point.
--
-- Retry-safe: idempotent throughout. The placeholder insert is ON CONFLICT DO
-- NOTHING, the criterion update is guarded on its own outcome, and every
-- function is CREATE OR REPLACE.
-- ============================================================

-- ── 1. The applicant's profile row ──────────────────────────────────────────
--
-- Replaces 071:373. Identical except for the block marked below.
--
-- The placeholder is deliberately the smallest legal row and nothing more:
--
--   username      NOT NULL UNIQUE and there is no CHECK on it (verified across
--                 001-082), so it is derived from the user's own uuid. That is
--                 unique by construction -- no retry loop, no collision with a
--                 name a real member could plausibly choose -- and step 1's
--                 upsert is ON CONFLICT (id) DO UPDATE over a payload that
--                 includes username (080:103), so her real choice overwrites it
--                 the moment she onboards.
--   display_name  NOT NULL. Nothing here is shown to her, and reviewers identify
--                 an applicant by the legal name they reveal through
--                 reveal_applicant_legal_name (070:422), not by this.
--   is_active     FALSE, and this one is load-bearing. profiles_select_public
--                 (080:155) is USING (is_active = true AND is_ghost = false) and
--                 072:119 deliberately left profiles ungated, so an active
--                 placeholder would put every pending applicant into the member
--                 directory of a WLW app under the name 'Applicant'. That
--                 discloses the fact that she applied, to everyone, which is the
--                 opposite of what an invite gate is for. FALSE keeps the row
--                 invisible to everyone but her -- profiles_select_own (080:165)
--                 is unaffected, so _layout's profile fetch and the pending
--                 screen still work.
--
-- vetting_status is set by the UPDATE at the end of the function, exactly as it
-- always was. It is not named in this INSERT, so the reapplication path (an
-- existing member with a real profile) hits ON CONFLICT DO NOTHING and keeps
-- every column she already had.
CREATE OR REPLACE FUNCTION public.create_membership_application(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_code public.invite_codes%ROWTYPE;
  v_app  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_code FROM public.invite_codes WHERE code = upper(btrim(p_code));

  IF v_code.id IS NULL
     OR v_code.revoked_at IS NOT NULL
     OR v_code.locked_at IS NOT NULL
     OR (v_code.expires_at IS NOT NULL AND v_code.expires_at < now())
     OR (v_code.max_uses IS NOT NULL AND v_code.uses_count >= v_code.max_uses) THEN
    RAISE EXCEPTION 'invite code is not usable' USING ERRCODE = '22023';
  END IF;

  -- Cooldown: a rejected applicant cannot simply obtain another community's
  -- code and try again the same afternoon.
  IF EXISTS (
    SELECT 1 FROM public.membership_applications
    WHERE auth_user_id = auth.uid()
      AND status = 'rejected'
      AND rejected_until IS NOT NULL
      AND rejected_until > now()
  ) THEN
    RAISE EXCEPTION 'you cannot reapply yet' USING ERRCODE = '22023';
  END IF;

  -- ─── NEW IN 083 ───────────────────────────────────────────────────────────
  -- Everything below this function depends on this row existing: the vetting
  -- UPDATE at the end, is_approved_member(), and the community join that
  -- _apply_decision performs on approval. See the header.
  INSERT INTO public.profiles (id, username, display_name, is_active)
  VALUES (
    auth.uid(),
    'applicant_' || replace(auth.uid()::text, '-', ''),
    'Applicant',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  -- ─── END NEW ──────────────────────────────────────────────────────────────

  INSERT INTO public.membership_applications (auth_user_id, code_id, community_id)
  VALUES (auth.uid(), v_code.id, v_code.community_id)
  ON CONFLICT (auth_user_id) DO UPDATE
    SET code_id      = EXCLUDED.code_id,
        community_id = EXCLUDED.community_id,
        status       = 'pending',
        submitted_at = now(),
        decided_at   = NULL,
        -- Both must clear, or the reapplication inherits the previous
        -- rejection's 90-day purge and gets deleted while still pending.
        rejected_until = NULL,
        purge_after    = NULL
  RETURNING id INTO v_app;

  UPDATE public.invite_codes SET uses_count = uses_count + 1 WHERE id = v_code.id;

  UPDATE public.profiles
  SET vetting_status = 'pending', admitted_via_code_id = v_code.id
  WHERE id = auth.uid();

  -- A review code exists so store reviewers can get in. It admits immediately
  -- and is excluded from acquisition analytics by is_review_code.
  IF v_code.is_review_code THEN
    PERFORM public._apply_decision(v_app, 'approved', 'Automatic: store review code.', NULL);
  END IF;

  RETURN v_app;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_membership_application(text) TO authenticated;

-- ── 2. Admission has to lift the placeholder ────────────────────────────────
--
-- Replaces 071:455. Identical except for the is_active clause marked below.
--
-- Section 1 creates the applicant dormant, so something has to wake her up, and
-- approval is the only correct moment: it is where "she is a member now" is
-- decided, next to the community join that already says so.
--
-- The clause is scoped to the exact placeholder this migration writes rather
-- than assigning true unconditionally. An account deactivated for any other
-- reason -- a ban, a deletion in progress -- must not be quietly reactivated by
-- an unrelated approval, and `is_active = true` on its own would do precisely
-- that. Matching on the derived username means only a row that has never been
-- through onboarding can be lifted here.
CREATE OR REPLACE FUNCTION public._apply_decision(
  p_application_id uuid,
  p_decision       text,
  p_note           text,
  p_decided_by     uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_app  public.membership_applications%ROWTYPE;
  v_cool integer;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_app FROM public.membership_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN
    RAISE EXCEPTION 'application not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_app.status <> 'pending' THEN
    RAISE EXCEPTION 'application already decided' USING ERRCODE = '22023';
  END IF;

  SELECT reject_cooldown_days INTO v_cool FROM public.gate_settings WHERE id;

  UPDATE public.membership_applications
  SET status         = p_decision,
      decided_at     = now(),
      rejected_until = CASE WHEN p_decision = 'rejected'
                            THEN now() + make_interval(days => v_cool) END,
      -- Rejected applications are purged wholesale; approved ones keep the row
      -- for attribution but shed the legal name (see 072).
      purge_after    = CASE WHEN p_decision = 'rejected'
                            THEN now() + interval '90 days' END
  WHERE id = p_application_id;

  INSERT INTO public.application_reviews (application_id, decision_note, decided_by, updated_at)
  VALUES (p_application_id, p_note, p_decided_by, now())
  ON CONFLICT (application_id) DO UPDATE
    SET decision_note = COALESCE(EXCLUDED.decision_note, public.application_reviews.decision_note),
        decided_by    = EXCLUDED.decided_by,
        updated_at    = now();

  -- The legal name has served its purpose the moment a human has decided.
  UPDATE public.applicant_identity
  SET purge_after = now() + interval '30 days'
  WHERE application_id = p_application_id;

  IF p_decision = 'approved' THEN
    UPDATE public.profiles
    SET vetting_status = 'approved',
        admitted_at    = now(),
        -- ─── NEW IN 083 ─────────────────────────────────────────────────────
        is_active      = CASE
                           WHEN username =
                                'applicant_' || replace(v_app.auth_user_id::text, '-', '')
                             THEN true
                           ELSE is_active
                         END
        -- ─── END NEW ────────────────────────────────────────────────────────
    WHERE id = v_app.auth_user_id;

    -- Admission joins you to the community that vouched for you. That is what
    -- the code meant.
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (v_app.community_id, v_app.auth_user_id, 'member')
    ON CONFLICT (community_id, user_id) DO NOTHING;
  ELSE
    UPDATE public.profiles SET vetting_status = 'rejected' WHERE id = v_app.auth_user_id;
  END IF;
END;
$$;

-- Unreachable from any client role, exactly as 071:526 left it. Restated
-- because CREATE OR REPLACE preserves the ACL and a future reader should not
-- have to go and check that.
REVOKE ALL ON FUNCTION public._apply_decision(uuid, text, text, uuid)
  FROM public, anon, authenticated;

-- ── 3. The legal name is evidence, not a check we assert passed ─────────────
--
-- 081:114 added self_attestable defaulting to false and set it true for exactly
-- one seed row, social_account, on the reasoning at 081:120: "the one attribute
-- the applicant supplies herself: it is evidence a reviewer reads and judges,
-- not a check we are asserting passed."
--
-- legal_name is the same class and was missed. She types it; a reviewer reads it
-- and judges it against the ID check. Nothing about it is an assertion by us --
-- that is what gov_id and kyc_liveness are, and those stay false forever because
-- only the KYC webhook may award them on the service role.
--
-- Without this the RPC in section 4 refuses the only call the client makes to it
-- (gateStore.saveLegalName), and the legal-name point can never be scored by any
-- path at all. It is also the more strongly evidenced of the two: the name lands
-- in applicant_identity, which has an INSERT-only policy over her own pending
-- application (070:393) and a primary key that permits exactly one row, so it
-- can be given once and never rewritten. Section 4 additionally refuses to award
-- the point unless that row is actually there.
--
-- Scoped to the global seed row, as 081:124 was: a community minting its own
-- criterion with this key gets the default and has to opt in deliberately.
UPDATE public.verification_criteria
SET self_attestable = true
WHERE key = 'legal_name' AND community_id IS NULL AND self_attestable = false;

-- ── 4. mark_criterion_met ───────────────────────────────────────────────────
--
-- The write path application_criteria_met has never had. 071:124-139 gives that
-- table two policies and both are FOR SELECT, so every client write to it has
-- always been refused -- which is correct and stays correct. An INSERT policy
-- would reopen H1 (081:94): ans_own once let an applicant name any criterion she
-- liked and the sync trigger marked it met, so two calls naming gov_id and
-- kyc_liveness scored her as identity-verified with no vendor session in
-- existence. The table keeps zero write policies; this function is SECURITY
-- DEFINER and is the only door.
--
-- can_self_attest_criterion (081:131) is the whole authorisation check and is
-- called rather than reimplemented -- deliberately, because 081:158 requires it
-- of "any future write path onto application_criteria_met", and a second copy of
-- that predicate is how the two drift. It already asserts every condition this
-- function needs: the caller owns the application, its status is 'pending', the
-- criterion is active, it is global or her own community's, and it is a question
-- or explicitly self-attestable. gov_id and kyc_liveness fail the last test, so
-- this RPC cannot award them however it is called.
--
-- The client (apps/mobile/store/gateStore.ts:342) has been calling this name
-- since before it existed and treats PGRST202/42883 as the expected
-- not-deployed-yet state, so it starts returning 'saved' instead of
-- 'saved_unscored' the moment this lands, with no client change required.
CREATE OR REPLACE FUNCTION public.mark_criterion_met(
  p_application_id uuid,
  p_criterion_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_self_attest_criterion(p_application_id, p_criterion_id) THEN
    RAISE EXCEPTION 'not permitted to satisfy this criterion'
      USING ERRCODE = '42501';
  END IF;

  SELECT key INTO v_key
  FROM public.verification_criteria
  WHERE id = p_criterion_id;

  -- The legal-name point scores a name being on file, so it may not be awarded
  -- while no name is on file. applicant_identity has no SELECT policy (070:376),
  -- which is why this test lives in a SECURITY DEFINER function and not in the
  -- client that would otherwise have to guess.
  IF v_key = 'legal_name'
     AND NOT EXISTS (
       SELECT 1 FROM public.applicant_identity
       WHERE application_id = p_application_id
     ) THEN
    RAISE EXCEPTION 'no legal name is on file for this application'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.application_criteria_met (application_id, criterion_id)
  VALUES (p_application_id, p_criterion_id)
  ON CONFLICT (application_id, criterion_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.mark_criterion_met(uuid, uuid) IS
  'The only client write path onto application_criteria_met. Authorisation is can_self_attest_criterion (081) in full -- never reimplement it here -- so gov_id and kyc_liveness cannot be self-awarded. The table itself keeps no write policy.';

REVOKE ALL ON FUNCTION public.mark_criterion_met(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_criterion_met(uuid, uuid) TO authenticated;
