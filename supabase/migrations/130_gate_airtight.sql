-- 130 — The gate, airtight
--
-- What was broken (audit-gate.md G-01..G-25, PRO-01; prod snapshot 2026-10-10):
--   * New profiles defaulted to vetting_status='unvetted', which counted as a
--     member, so a raw GoTrue signup with no code was in (G-02, SB-02).
--   * Every signed-in account — pending, rejected, no-code — could read every
--     column of every member profile: city, dating mode, vetting status, invite
--     code, consent flags, Stripe id, shipping address (G-06, PRO-01).
--   * Any approved member could make herself a gatekeeper: create a community,
--     sign the reviewer agreement herself, mint unlimited codes, approve anyone,
--     and overflow-review strangers' applications incl. legal names (G-07).
--   * Code redemption raced (no row lock), skipped the rate limit, and reset an
--     approved member to pending (G-08). Decisions were overwritable (G-09).
--   * Applicants who onboarded while pending were approved into is_active=false
--     — invisible to everyone (G-04). "Send for review" did nothing (G-14).
--   * Decision emails were dead-lettered; nobody was told anything (G-01, G-10).
--
-- The model after this migration:
--   vetting_status is pending | approved | rejected. 'unvetted' is gone: the 6
--   pre-gate accounts are grandfathered to approved here, with a decision-log
--   row each, and listed in Studio as "grandfathered, review optional" (G-23).
--   A BEFORE INSERT trigger forces 'pending' for every client insert, so the
--   column default is never the control again.
--
--   is_approved_member() = approved AND not deleted. Pending and rejected
--   accounts get the waiting room only: the Archive, their own row, their own
--   application. Other members' profiles are invisible to them.
--
--   Other members' profiles expose a fixed list of public columns (column
--   grants). Her own private columns come from the my_profile view; staff read
--   theirs from staff_profiles. "Online now" comes from member_presence(),
--   which returns a boolean, never a timestamp.
--
--   Reviewing is a role staff grant: Roxy staff, or a community admin /
--   border-patrol whom staff granted reviewer AND who signed the agreement.
--   Overflow is staff-only. Legal names are staff-only, still logged.
--
--   An application is a draft until she sends it (submit_application). Only
--   sent applications are in the queue. Every decision, appeal outcome and
--   grandfathering is an append-only row in application_decisions.
--
-- Cron (G-16): purge_expired_applicant_data() is scheduled by the ops lane in
-- scripts/setup-cron.sql. Nothing here depends on it having run.

-- ── 0. Decision log (append-only) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.application_decisions (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  application_id   uuid REFERENCES public.membership_applications(id) ON DELETE SET NULL,
  decision         text NOT NULL CHECK (decision IN (
                     'approved', 'rejected', 'appeal_overturned', 'appeal_upheld',
                     'grandfathered', 'grandfather_kept', 'grandfather_revoked',
                     'reviewer_granted', 'reviewer_revoked')),
  reason_category  text,
  note             text CHECK (note IS NULL OR char_length(note) <= 2000),
  decided_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_decisions_subject_idx
  ON public.application_decisions (subject_user_id, decided_at DESC);
ALTER TABLE public.application_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.application_decisions TO authenticated;

DROP POLICY IF EXISTS ad_staff_read ON public.application_decisions;
CREATE POLICY ad_staff_read ON public.application_decisions
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());

-- Append-only even for SECURITY DEFINER code and the table owner: the record of
-- who let her in is only worth having if nobody can rewrite it afterwards. Rows
-- leave only by cascade, when the person herself is hard-deleted.
CREATE OR REPLACE FUNCTION public.application_decisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'application_decisions is append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.application_decisions_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_application_decisions_append_only ON public.application_decisions;
CREATE TRIGGER trg_application_decisions_append_only
  BEFORE UPDATE ON public.application_decisions
  FOR EACH ROW EXECUTE FUNCTION public.application_decisions_append_only();

-- ── 1. Vetting state: grandfather, strict default, force-pending (G-02, G-23) ─
INSERT INTO public.application_decisions (subject_user_id, decision, reason_category, note)
SELECT p.id, 'grandfathered', 'grandfathered', 'grandfathered pre-gate member'
FROM public.profiles p
WHERE p.vetting_status = 'unvetted';

UPDATE public.profiles
SET vetting_status = 'approved',
    admitted_at    = COALESCE(admitted_at, now())
WHERE vetting_status = 'unvetted';

ALTER TABLE public.profiles ALTER COLUMN vetting_status SET DEFAULT 'pending';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_vetting_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_vetting_status_check
  CHECK (vetting_status IN ('pending', 'approved', 'rejected'));

-- A default is policy; this is the control. Any insert made with a client JWT
-- (authenticated or anon) is pending with no admission record, whatever the
-- payload says. Service-role and migration inserts (auth.role() 'service_role'
-- or NULL) keep what they set — seeds and staff tooling need that.
CREATE OR REPLACE FUNCTION public.profiles_force_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
    NEW.vetting_status       := 'pending';
    NEW.admitted_at          := NULL;
    NEW.admitted_via_code_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.profiles_force_pending() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_force_pending ON public.profiles;
CREATE TRIGGER trg_profiles_force_pending
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_force_pending();

-- Granting staff to an account that has not been through the gate admits it
-- (staff are vetted by the team that hires them). 'unvetted' no longer exists.
CREATE OR REPLACE FUNCTION public.approve_on_staff_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_staff = true AND COALESCE(OLD.is_staff, false) = false
     AND NEW.vetting_status IS DISTINCT FROM 'approved' THEN
    NEW.vetting_status := 'approved';
    NEW.admitted_at    := COALESCE(NEW.admitted_at, now());
    NEW.is_active      := true;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Membership = approved and not deleted ───────────────────────────────
CREATE OR REPLACE FUNCTION public.is_approved_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND vetting_status = 'approved'
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved_member_id(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id
      AND vetting_status = 'approved'
      AND deleted_at IS NULL
  );
$$;

-- ── 3. Profiles: column-safe exposure (PRO-01, G-06, G-25) ─────────────────
-- RLS decides which ROWS; only grants decide which COLUMNS. Before this, every
-- signed-in account could select every column of every visible row.
REVOKE ALL ON public.profiles FROM anon;
REVOKE SELECT, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.profiles FROM authenticated;

-- The public profile. Anything not listed is private to its owner (my_profile)
-- and to staff (staff_profiles): last_seen_at, updated_at (bumped by the
-- presence heartbeat), location_*, age prefs, notification_preferences,
-- stripe_customer_id, last_shipping_address, behavioural_consent,
-- theme_preference, streaks, capability flags, onboarding_completed,
-- vetting_status, admitted_*, access_tier, deleted_at, staff_tag_set_by,
-- dm_permission.
GRANT SELECT (
  id, username, display_name, bio, avatar_url, pronouns, identity_labels,
  interests, is_dating_mode, dating_looking_for, is_verified, gov_verified,
  is_active, is_ghost, gamification_points, badge_ids, custom_tags,
  staff_tag, staff_tag_set_at, is_staff, staff_role, is_community_owner,
  official_community_id, created_at
) ON public.profiles TO authenticated;

-- Other members are visible only to approved members, and only once they are
-- approved, active, not hidden, not deleted, not blocked. profiles_select_own
-- and profiles_select_staff are unchanged.
DROP POLICY IF EXISTS profiles_select_public ON public.profiles;
CREATE POLICY profiles_select_public ON public.profiles
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND is_ghost = false
    AND vetting_status = 'approved'
    AND deleted_at IS NULL
    AND (SELECT public.is_approved_member())
    AND NOT public.blocked_pair(auth.uid(), id)
  );

-- Her own row, every column. A security-definer view (owner postgres) pinned to
-- auth.uid(): it can only ever return one row, hers.
CREATE OR REPLACE VIEW public.my_profile AS
  SELECT p.* FROM public.profiles p WHERE p.id = auth.uid();
REVOKE ALL ON public.my_profile FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.my_profile TO authenticated;
COMMENT ON VIEW public.my_profile IS
  'The signed-in user''s own profile row with every column. Read this, never profiles.*, for her own private fields (130).';

-- Staff tooling (Studio rosters, team, launch tier). No payment, address,
-- consent or notification columns: staff never needed them.
CREATE OR REPLACE VIEW public.staff_profiles AS
  SELECT p.id, p.username, p.display_name, p.avatar_url, p.is_active, p.is_ghost,
         p.is_staff, p.staff_role, p.is_community_owner, p.official_community_id,
         p.vetting_status, p.admitted_at, p.admitted_via_code_id, p.access_tier,
         p.gamification_points, p.staff_tag, p.staff_tag_set_at, p.staff_tag_set_by,
         p.onboarding_completed, p.last_seen_at, p.deleted_at, p.created_at
  FROM public.profiles p
  WHERE public.is_roxy_staff();
REVOKE ALL ON public.staff_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_profiles TO authenticated;

-- "Online now" without a timestamp anyone can mine for her routine. Approved
-- callers only; hidden, blocked, deleted and non-approved people are never
-- reported online.
CREATE OR REPLACE FUNCTION public.member_presence(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, online boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         (p.last_seen_at IS NOT NULL AND p.last_seen_at > now() - interval '10 minutes')
  FROM public.profiles p
  WHERE public.is_approved_member()
    AND p.id = ANY (p_user_ids[1:200])
    AND p.id <> auth.uid()
    AND p.is_active AND NOT p.is_ghost
    AND p.vetting_status = 'approved'
    AND p.deleted_at IS NULL
    AND NOT public.blocked_pair(auth.uid(), p.id);
$$;
REVOKE ALL ON FUNCTION public.member_presence(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_presence(uuid[]) TO authenticated;

-- Username availability during onboarding: a pending applicant can no longer
-- read other rows, so "is this name taken" needs its own narrow answer.
CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles
       WHERE lower(username) = lower(btrim(p_username))
         AND id <> auth.uid()
     );
$$;
REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO authenticated;

-- member_safety's policy read p.vetting_status straight off profiles, which the
-- column grant above now refuses. Same rule, through the reviewer helper.
-- (is_granted_reviewer_for is defined in section 5; policies bind at run time.)

-- ── 4. Applications: draft → sent → decided (G-14, G-12) ───────────────────
ALTER TABLE public.membership_applications
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text;
ALTER TABLE public.membership_applications DROP CONSTRAINT IF EXISTS membership_applications_decision_reason_check;
ALTER TABLE public.membership_applications ADD CONSTRAINT membership_applications_decision_reason_check
  CHECK (decision_reason IS NULL OR decision_reason IN (
    'not_verified', 'not_known', 'incomplete', 'safety', 'other'));

-- Applications already in the queue were "submitted" at redemption under the
-- old model; they stay in the queue rather than vanish into draft.
UPDATE public.membership_applications
SET ready_at = submitted_at
WHERE status = 'pending' AND ready_at IS NULL;

CREATE INDEX IF NOT EXISTS membership_applications_queue_idx
  ON public.membership_applications (ready_at)
  WHERE status = 'pending' AND ready_at IS NOT NULL;

-- The join reason is the one thing a reviewer always needs (G-13).
UPDATE public.verification_criteria
SET is_required = true
WHERE key = 'join_reason' AND community_id IS NULL;

-- Applicants could withdraw by a direct UPDATE; nothing in the app uses it and
-- every status change now goes through a function that logs it.
DROP POLICY IF EXISTS ma_withdraw_own ON public.membership_applications;
REVOKE ALL ON public.membership_applications FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.membership_applications FROM authenticated;
GRANT SELECT ON public.membership_applications TO authenticated;

-- ── 5. Reviewers are granted by staff, never self-made (G-07) ──────────────
ALTER TABLE public.reviewer_settings
  ADD COLUMN IF NOT EXISTS reviewer_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewer_granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS rs_own ON public.reviewer_settings;
DROP POLICY IF EXISTS rs_read_own ON public.reviewer_settings;
CREATE POLICY rs_read_own ON public.reviewer_settings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE ALL ON public.reviewer_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.reviewer_settings FROM authenticated;
GRANT SELECT ON public.reviewer_settings TO authenticated;

-- A community reviewer: approved, not deleted, admin or border patrol of THIS
-- community, granted by staff, agreement signed. All five, every time.
CREATE OR REPLACE FUNCTION public.is_granted_reviewer_for(p_community_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_approved_member()
     AND EXISTS (
       SELECT 1 FROM public.reviewer_settings rs
       WHERE rs.user_id = auth.uid()
         AND rs.reviewer_granted_at IS NOT NULL
         AND rs.reviewer_agreement_at IS NOT NULL
     )
     AND EXISTS (
       SELECT 1 FROM public.community_members m
       WHERE m.community_id = p_community_id
         AND m.user_id = auth.uid()
         AND m.role IN ('admin', 'border_patrol')
     );
$$;
REVOKE ALL ON FUNCTION public.is_granted_reviewer_for(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_granted_reviewer_for(uuid) TO authenticated;

-- Staff who decide must be through the gate themselves and have signed. Core
-- keeps its standing bypass (it is the team that runs the gate).
CREATE OR REPLACE FUNCTION public.is_staff_reviewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles me
    LEFT JOIN public.reviewer_settings rs ON rs.user_id = me.id
    WHERE me.id = auth.uid()
      AND me.deleted_at IS NULL
      AND (
        me.staff_role = 'core'
        OR (me.is_staff AND me.vetting_status = 'approved' AND rs.reviewer_agreement_at IS NOT NULL)
      )
  );
$$;
REVOKE ALL ON FUNCTION public.is_staff_reviewer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_reviewer() TO authenticated;

-- Community reviewers see sent applications to their own community. Staff see
-- everything, which is the overflow queue. No "any admin of any community".
CREATE OR REPLACE FUNCTION public.can_review_application(app_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membership_applications a
    WHERE a.id = app_id
      AND (
        public.is_staff_reviewer()
        OR (a.ready_at IS NOT NULL AND public.is_granted_reviewer_for(a.community_id))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.grant_reviewer(p_user_id uuid, p_grant boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_roxy_staff() THEN
    RAISE EXCEPTION 'only Roxy staff can grant reviewers' USING ERRCODE = '42501';
  END IF;
  IF p_grant AND NOT public.is_approved_member_id(p_user_id) THEN
    RAISE EXCEPTION 'only approved members can review' USING ERRCODE = '22023';
  END IF;
  IF p_grant AND NOT EXISTS (
    SELECT 1 FROM public.community_members
    WHERE user_id = p_user_id AND role IN ('admin', 'border_patrol')
  ) THEN
    RAISE EXCEPTION 'reviewers must be a community admin or border patrol' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.reviewer_settings (user_id, reviewer_granted_at, reviewer_granted_by, updated_at)
  VALUES (p_user_id, CASE WHEN p_grant THEN now() END, CASE WHEN p_grant THEN auth.uid() END, now())
  ON CONFLICT (user_id) DO UPDATE
    SET reviewer_granted_at = EXCLUDED.reviewer_granted_at,
        reviewer_granted_by = EXCLUDED.reviewer_granted_by,
        -- Revoking clears the signature too: a re-grant means re-reading it.
        reviewer_agreement_at = CASE WHEN p_grant THEN public.reviewer_settings.reviewer_agreement_at END,
        updated_at = now();

  -- Who made whom a gatekeeper is part of "who let her in".
  INSERT INTO public.application_decisions (subject_user_id, decision, decided_by)
  VALUES (p_user_id, CASE WHEN p_grant THEN 'reviewer_granted' ELSE 'reviewer_revoked' END, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.grant_reviewer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_reviewer(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.sign_reviewer_agreement()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_me FROM public.profiles WHERE id = auth.uid();
  IF v_me.id IS NULL OR v_me.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  -- COALESCE: staff_role is NULL for members, and NOT (NULL OR false) is NULL,
  -- which an IF treats as "not raised".
  IF NOT COALESCE(
    v_me.staff_role = 'core'
    OR (COALESCE(v_me.is_staff, false) AND v_me.vetting_status = 'approved')
    OR (v_me.vetting_status = 'approved' AND EXISTS (
          SELECT 1 FROM public.reviewer_settings
          WHERE user_id = auth.uid() AND reviewer_granted_at IS NOT NULL)),
    false
  ) THEN
    RAISE EXCEPTION 'Roxy staff have not made you a reviewer' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.reviewer_settings (user_id, reviewer_agreement_at, updated_at)
  VALUES (auth.uid(), now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET reviewer_agreement_at = now(), updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.sign_reviewer_agreement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sign_reviewer_agreement() TO authenticated;

-- Staff picks reviewers from the people who already run a community.
CREATE OR REPLACE FUNCTION public.reviewer_candidates()
RETURNS TABLE (user_id uuid, display_name text, username text, community_names text[],
               granted_at timestamptz, agreement_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.username,
         array_agg(DISTINCT c.name ORDER BY c.name),
         rs.reviewer_granted_at, rs.reviewer_agreement_at
  FROM public.community_members m
  JOIN public.profiles p ON p.id = m.user_id
  JOIN public.communities c ON c.id = m.community_id
  LEFT JOIN public.reviewer_settings rs ON rs.user_id = p.id
  WHERE public.is_roxy_staff()
    AND m.role IN ('admin', 'border_patrol')
    AND p.vetting_status = 'approved'
    AND p.deleted_at IS NULL
    AND COALESCE(p.is_staff, false) = false
  GROUP BY p.id, p.display_name, p.username, rs.reviewer_granted_at, rs.reviewer_agreement_at
  ORDER BY rs.reviewer_granted_at IS NULL, p.display_name;
$$;
REVOKE ALL ON FUNCTION public.reviewer_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reviewer_candidates() TO authenticated;

-- Legal names: staff only, still logged (G-07).
CREATE OR REPLACE FUNCTION public.reveal_applicant_legal_name(app_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT public.is_staff_reviewer() OR NOT public.can_review_application(app_id) THEN
    RAISE EXCEPTION 'only Roxy staff reviewers can reveal a legal name'
      USING ERRCODE = '42501';
  END IF;

  SELECT legal_name INTO v_name
  FROM public.applicant_identity
  WHERE application_id = app_id;

  IF v_name IS NULL THEN
    RETURN NULL;                          -- not supplied, or already purged
  END IF;

  INSERT INTO public.application_access_log (application_id, viewer_id, field)
  VALUES (app_id, auth.uid(), 'legal_name');

  RETURN v_name;
END;
$$;
REVOKE ALL ON FUNCTION public.reveal_applicant_legal_name(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_applicant_legal_name(uuid) TO authenticated;

DROP POLICY IF EXISTS ms_own_community ON public.member_safety;
CREATE POLICY ms_own_community ON public.member_safety
  FOR ALL TO authenticated
  USING (public.is_granted_reviewer_for(community_id))
  WITH CHECK (
    public.is_granted_reviewer_for(community_id)
    AND EXISTS (
      SELECT 1 FROM public.community_members subject
      WHERE subject.community_id = member_safety.community_id
        AND subject.user_id = member_safety.user_id
    )
  );

-- ── 6. Invite codes: capped, attributed, staff-or-reviewer (G-07, G-18) ────
ALTER TABLE public.invite_codes
  ADD COLUMN IF NOT EXISTS is_member_code boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.invite_code_quota_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) < 10
  FROM public.invite_codes
  WHERE created_by = auth.uid()
    AND NOT is_member_code
    AND revoked_at IS NULL
    AND locked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND (max_uses IS NULL OR uses_count < max_uses);
$$;
REVOKE ALL ON FUNCTION public.invite_code_quota_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_code_quota_ok() TO authenticated;

REVOKE ALL ON public.invite_codes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.invite_codes FROM authenticated;
GRANT SELECT ON public.invite_codes TO authenticated;
GRANT INSERT (community_id, created_by, label, max_uses, expires_at) ON public.invite_codes TO authenticated;
GRANT UPDATE (label, max_uses, revoked_at, expires_at) ON public.invite_codes TO authenticated;

DROP POLICY IF EXISTS ic_insert_admin ON public.invite_codes;
DROP POLICY IF EXISTS ic_insert_reviewer ON public.invite_codes;
CREATE POLICY ic_insert_reviewer ON public.invite_codes
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND is_review_code = false
    AND is_member_code = false
    AND (
      public.is_roxy_staff()
      OR (
        public.is_granted_reviewer_for(community_id)
        AND max_uses BETWEEN 1 AND 25
        AND expires_at IS NOT NULL
        AND expires_at <= now() + interval '30 days'
        AND public.invite_code_quota_ok()
      )
    )
  );

DROP POLICY IF EXISTS ic_update_admin ON public.invite_codes;
DROP POLICY IF EXISTS ic_update_reviewer ON public.invite_codes;
CREATE POLICY ic_update_reviewer ON public.invite_codes
  FOR UPDATE TO authenticated
  USING (
    is_review_code = false AND is_member_code = false
    AND (public.is_roxy_staff() OR public.is_granted_reviewer_for(community_id))
  )
  WITH CHECK (
    is_review_code = false AND is_member_code = false
    AND (
      public.is_roxy_staff()
      OR (
        public.is_granted_reviewer_for(community_id)
        AND (
          revoked_at IS NOT NULL
          OR (max_uses BETWEEN 1 AND 25
              AND expires_at IS NOT NULL
              AND expires_at <= created_at + interval '30 days')
        )
      )
    )
  );

DROP POLICY IF EXISTS ic_read_own_community ON public.invite_codes;
DROP POLICY IF EXISTS ic_read_reviewer ON public.invite_codes;
CREATE POLICY ic_read_reviewer ON public.invite_codes
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_granted_reviewer_for(community_id));

CREATE OR REPLACE FUNCTION public.invite_code_redeemers()
RETURNS TABLE(code_id uuid, user_id uuid, display_name text, username text, vetting_status text,
              access_tier text, staff_role text, is_staff boolean, is_community_owner boolean,
              used_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), 'Applicant'),
    p.username,
    p.vetting_status,
    p.access_tier::text,
    p.staff_role,
    coalesce(p.is_staff, false),
    coalesce(p.is_community_owner, false),
    coalesce(a.submitted_at, p.created_at)
  FROM public.invite_codes c
  JOIN public.profiles p ON p.admitted_via_code_id = c.id
  LEFT JOIN public.membership_applications a
    ON a.auth_user_id = p.id
   AND a.code_id = c.id
  WHERE public.is_roxy_staff()
     OR c.created_by = auth.uid()
     OR public.is_granted_reviewer_for(c.community_id);
$$;

-- Members vouch for people they know: 2 single-use codes after 7 days in good
-- standing, attributed to her, for her inviting community (G-18).
CREATE TABLE IF NOT EXISTS public.member_invite_grants (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  codes       integer NOT NULL DEFAULT 2 CHECK (codes BETWEEN 0 AND 10)
);
ALTER TABLE public.member_invite_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_invite_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.member_invite_grants TO authenticated;
DROP POLICY IF EXISTS mig_read_own ON public.member_invite_grants;
CREATE POLICY mig_read_own ON public.member_invite_grants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_roxy_staff());

CREATE OR REPLACE FUNCTION public.my_member_invites()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        public.profiles%ROWTYPE;
  v_community uuid;
  v_eligible  timestamptz;
  i           integer;
BEGIN
  SELECT * INTO v_me FROM public.profiles WHERE id = auth.uid();
  IF v_me.id IS NULL OR v_me.vetting_status <> 'approved' OR v_me.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'not_member', 'codes', '[]'::jsonb);
  END IF;

  v_eligible := COALESCE(v_me.admitted_at, v_me.created_at) + interval '7 days';

  -- Good standing = active, and no live watchlist flag in any community.
  IF NOT COALESCE(v_me.is_active, false) OR EXISTS (
       SELECT 1 FROM public.member_safety ms WHERE ms.user_id = v_me.id AND ms.watchlist
     ) THEN
    RETURN jsonb_build_object('status', 'not_eligible', 'codes', '[]'::jsonb);
  END IF;

  IF now() < v_eligible THEN
    RETURN jsonb_build_object('status', 'waiting', 'eligible_at', v_eligible, 'codes', '[]'::jsonb);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.member_invite_grants WHERE user_id = v_me.id) THEN
    -- The community that vouched for her, else the oldest one she is in, else
    -- Roxy Official.
    SELECT community_id INTO v_community
    FROM public.membership_applications
    WHERE auth_user_id = v_me.id AND status = 'approved';
    IF v_community IS NULL THEN
      SELECT community_id INTO v_community FROM public.community_members
      WHERE user_id = v_me.id ORDER BY joined_at NULLS LAST LIMIT 1;
    END IF;
    IF v_community IS NULL THEN
      SELECT id INTO v_community FROM public.communities WHERE slug = 'roxy-official';
    END IF;
    IF v_community IS NULL THEN
      RETURN jsonb_build_object('status', 'unavailable', 'codes', '[]'::jsonb);
    END IF;

    INSERT INTO public.member_invite_grants (user_id) VALUES (v_me.id)
    ON CONFLICT (user_id) DO NOTHING;
    IF FOUND THEN
      FOR i IN 1..2 LOOP
        INSERT INTO public.invite_codes (community_id, created_by, label, max_uses, expires_at, is_member_code)
        VALUES (v_community, v_me.id, 'Member invite', 1, NULL, true);
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ready',
    'codes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'code', c.code,
               'used', c.uses_count >= COALESCE(c.max_uses, 1),
               'revoked', c.revoked_at IS NOT NULL)
             ORDER BY c.created_at)
      FROM public.invite_codes c
      WHERE c.created_by = v_me.id AND c.is_member_code
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.my_member_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_member_invites() TO authenticated;

-- Store review accounts (G-22): one labelled, single-purpose code per store,
-- minted by core in Studio, expiring on its own.
CREATE OR REPLACE FUNCTION public.mint_review_code(p_label text, p_days integer DEFAULT 30)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community uuid;
  v_code      text;
BEGIN
  IF NOT public.is_roxy_core() THEN
    RAISE EXCEPTION 'only Roxy core can mint a store review code' USING ERRCODE = '42501';
  END IF;
  IF p_label IS NULL OR char_length(btrim(p_label)) < 3 THEN
    RAISE EXCEPTION 'label the code (e.g. "App Store review")' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_community FROM public.communities WHERE slug = 'roxy-official';
  IF v_community IS NULL THEN
    RAISE EXCEPTION 'Roxy Official community not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.invite_codes (community_id, created_by, label, max_uses, expires_at, is_review_code)
  VALUES (v_community, auth.uid(), left(btrim(p_label), 80), 3,
          now() + make_interval(days => LEAST(GREATEST(p_days, 1), 90)), true)
  RETURNING code INTO v_code;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.mint_review_code(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mint_review_code(text, integer) TO authenticated;

-- ── 7. Emails: templates exist for every type queued (G-01, G-10) ──────────
ALTER TABLE public.email_queue DROP CONSTRAINT IF EXISTS email_queue_email_type_check;
ALTER TABLE public.email_queue ADD CONSTRAINT email_queue_email_type_check
  CHECK (email_type IN (
    'order_shipped_buyer', 'product_approved', 'product_rejected',
    'refund_notification_buyer', 'dispute_alert_business',
    'business_approved', 'business_rejected',
    'application_approved', 'application_rejected', 'application_received',
    'application_appeal_upheld', 'staff_application_alert', 'staff_appeal_alert'));
ALTER TABLE public.email_queue DROP CONSTRAINT IF EXISTS email_queue_recipient_type_check;
ALTER TABLE public.email_queue ADD CONSTRAINT email_queue_recipient_type_check
  CHECK (recipient_type IN ('buyer', 'business', 'applicant', 'staff'));

-- email_queue's unique keys are (order_id|product_id, email_type, recipient)
-- NULLS NOT DISTINCT, so for any non-order email one row per type per person
-- exists, ever: a second "received" for a re-applicant, or a second staff
-- alert, used to raise. This re-arms that row instead — a pending staff alert
-- just gets fresher counts (a natural digest). A row mid-send is left alone.
-- Never raises: an email must not cost anyone her decision or submission.
CREATE OR REPLACE FUNCTION public.enqueue_gate_email(p_type text, p_recipient_type text,
                                                     p_user_id uuid, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.email_queue (email_type, recipient_type, recipient_user_id, payload)
  VALUES (p_type, p_recipient_type, p_user_id, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (order_id, email_type, recipient_user_id) DO UPDATE
    SET payload = EXCLUDED.payload,
        recipient_type = EXCLUDED.recipient_type,
        status = 'pending',
        retry_count = 0,
        next_retry_at = now(),
        processing_since = NULL,
        last_error = NULL,
        sent_at = NULL,
        resend_message_id = NULL,
        created_at = now()
    WHERE public.email_queue.status <> 'processing';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_gate_email(%) failed: %', p_type, SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_gate_email(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- One email per active staff account. The payload carries counts only — no
-- names, no community: an inbox preview is a lock screen too.
CREATE OR REPLACE FUNCTION public.enqueue_staff_alert(p_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_waiting integer;
  v_oldest  numeric;
  v_appeals integer;
BEGIN
  SELECT count(*), COALESCE(max(EXTRACT(EPOCH FROM now() - ready_at) / 3600.0), 0)
    INTO v_waiting, v_oldest
  FROM public.membership_applications
  WHERE status = 'pending' AND ready_at IS NOT NULL;

  SELECT count(*) INTO v_appeals FROM public.application_appeals WHERE resolved_at IS NULL;

  PERFORM public.enqueue_gate_email(
            p_type, 'staff', p.id,
            jsonb_build_object('waiting', v_waiting, 'oldest_hours', round(v_oldest),
                               'open_appeals', v_appeals))
  FROM public.profiles p
  WHERE p.is_staff AND p.vetting_status = 'approved' AND p.deleted_at IS NULL;
EXCEPTION WHEN OTHERS THEN
  -- An alert must never cost an applicant her submission.
  RAISE WARNING 'enqueue_staff_alert(%) failed: %', p_type, SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_staff_alert(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_application_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  -- community_name is deliberately absent: which community vouched for her
  -- is exactly what a subject line or preview must never say.
  PERFORM public.enqueue_gate_email(
    CASE NEW.status WHEN 'approved' THEN 'application_approved' ELSE 'application_rejected' END,
    'applicant',
    NEW.auth_user_id,
    jsonb_build_object(
      'application_id', NEW.id,
      'reason', NEW.decision_reason,
      'can_reapply_at', NEW.rejected_until
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_application_email failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ── 8. Redemption: locked, rate-limited, never demotes a member (G-08, G-15) ─
CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_norm     text := upper(btrim(COALESCE(p_code, '')));
  v_me       public.profiles%ROWTYPE;
  v_existing public.membership_applications%ROWTYPE;
  v_code     public.invite_codes%ROWTYPE;
  v_settings public.gate_settings%ROWTYPE;
  v_bucket   text;
  v_recent   integer;
  v_global   integer;
  v_failures integer;
  v_reason   text;
  v_app      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_me FROM public.profiles WHERE id = v_uid;
  IF v_me.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deleted');
  END IF;
  -- An approved member redeeming a code used to be reset to pending.
  IF v_me.vetting_status = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_member');
  END IF;

  SELECT * INTO v_existing FROM public.membership_applications WHERE auth_user_id = v_uid;
  -- Idempotent: a retry after a dropped response must not burn a second use.
  IF v_existing.id IS NOT NULL AND v_existing.status = 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'application_id', v_existing.id,
                              'community_id', v_existing.community_id, 'existing', true);
  END IF;
  IF v_existing.status = 'rejected' AND v_existing.rejected_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cooldown',
                              'can_reapply_at', v_existing.rejected_until);
  END IF;

  SELECT * INTO v_settings FROM public.gate_settings WHERE id;
  v_bucket := 'uid:' || v_uid::text;

  SELECT count(*) INTO v_global FROM public.code_attempts
  WHERE attempted_at > now() - interval '1 minute';
  SELECT count(*) INTO v_recent FROM public.code_attempts
  WHERE ip_hash = v_bucket AND succeeded = false AND attempted_at > now() - interval '1 hour';
  IF v_global >= v_settings.global_attempts_per_min OR v_recent >= v_settings.code_attempt_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  -- The row lock is the fix for the race: a second redemption of a single-use
  -- code waits here, then sees uses_count already at max_uses.
  SELECT * INTO v_code FROM public.invite_codes WHERE code = v_norm FOR UPDATE;

  v_reason := CASE
    WHEN v_code.id IS NULL                                        THEN 'invalid'
    WHEN v_code.revoked_at IS NOT NULL                            THEN 'revoked'
    WHEN v_code.locked_at IS NOT NULL                             THEN 'locked'
    WHEN v_code.expires_at IS NOT NULL AND v_code.expires_at < now() THEN 'expired'
    WHEN v_code.max_uses IS NOT NULL AND v_code.uses_count >= v_code.max_uses THEN 'exhausted'
    ELSE NULL
  END;

  INSERT INTO public.code_attempts (code_text, ip_hash, succeeded)
  VALUES (left(v_norm, 64), v_bucket, v_reason IS NULL);

  IF v_reason IS NOT NULL THEN
    IF v_code.id IS NOT NULL THEN
      SELECT count(*) INTO v_failures FROM public.code_attempts
      WHERE code_text = v_norm AND succeeded = false
        AND attempted_at > now() - interval '24 hours';
      IF v_failures >= v_settings.code_lock_threshold THEN
        UPDATE public.invite_codes SET locked_at = now() WHERE id = v_code.id AND locked_at IS NULL;
      END IF;
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  INSERT INTO public.profiles (id, username, display_name, is_active)
  VALUES (v_uid, 'applicant_' || replace(v_uid::text, '-', ''), 'Applicant', false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.membership_applications (auth_user_id, code_id, community_id)
  VALUES (v_uid, v_code.id, v_code.community_id)
  ON CONFLICT (auth_user_id) DO UPDATE
    SET code_id         = EXCLUDED.code_id,
        community_id    = EXCLUDED.community_id,
        status          = 'pending',
        submitted_at    = now(),
        ready_at        = NULL,
        decided_at      = NULL,
        decision_reason = NULL,
        rejected_until  = NULL,
        purge_after     = NULL
  RETURNING id INTO v_app;

  UPDATE public.invite_codes SET uses_count = uses_count + 1 WHERE id = v_code.id;

  UPDATE public.profiles
  SET vetting_status = 'pending', admitted_via_code_id = v_code.id
  WHERE id = v_uid;

  -- A store review code admits at once and skips acquisition analytics.
  IF v_code.is_review_code THEN
    UPDATE public.membership_applications SET ready_at = now() WHERE id = v_app;
    PERFORM public._apply_decision(v_app, 'approved', 'Automatic: store review code.', NULL);
  END IF;

  RETURN jsonb_build_object('ok', true, 'application_id', v_app,
                            'community_id', v_code.community_id,
                            'approved', v_code.is_review_code);
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;

-- Older installed builds call this. Same rules; failures return NULL (the old
-- client already treats NULL as "try again") so the attempt log survives.
CREATE OR REPLACE FUNCTION public.create_membership_application(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  v := public.redeem_invite_code(p_code);
  IF (v->>'ok')::boolean THEN
    -- Old builds had no "Send for review" step; their applicants are sent as
    -- soon as they exist, which is the behaviour those builds promise.
    UPDATE public.membership_applications
    SET ready_at = COALESCE(ready_at, now())
    WHERE id = (v->>'application_id')::uuid AND status = 'pending';
    RETURN (v->>'application_id')::uuid;
  END IF;
  IF v->>'reason' = 'cooldown' THEN
    RAISE EXCEPTION 'you cannot reapply yet' USING ERRCODE = '22023';
  END IF;
  IF v->>'reason' = 'already_member' THEN
    RAISE EXCEPTION 'already a member' USING ERRCODE = '22023';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.create_membership_application(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_membership_application(text) TO authenticated;

-- ── 9. Send for review (G-14) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_application()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app     public.membership_applications%ROWTYPE;
  v_reason  text;
  v_missing text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_app FROM public.membership_applications
  WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF v_app.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_application');
  END IF;
  IF v_app.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_decided');
  END IF;
  IF v_app.ready_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ready_at', v_app.ready_at, 'already', true);
  END IF;

  SELECT ans.answer INTO v_reason
  FROM public.application_answers ans
  JOIN public.verification_criteria c ON c.id = ans.criterion_id
  WHERE ans.application_id = v_app.id AND c.key = 'join_reason';
  IF v_reason IS NULL OR char_length(btrim(v_reason)) < 40 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'join_reason_too_short');
  END IF;

  v_missing := public.application_missing_required(v_app.id);
  IF cardinality(v_missing) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_required', 'missing', to_jsonb(v_missing));
  END IF;

  UPDATE public.membership_applications
  SET ready_at = now(), submitted_at = now()
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  -- Tell her we have it, and tell the people who can act on it.
  PERFORM public.enqueue_gate_email('application_received', 'applicant', auth.uid(),
                                    jsonb_build_object('application_id', v_app.id));
  PERFORM public.enqueue_staff_alert('staff_application_alert');

  RETURN jsonb_build_object('ok', true, 'ready_at', v_app.ready_at);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_application() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_application() TO authenticated;

-- A substantive answer earns the join_reason point; "asdf" does not (G-24).
CREATE OR REPLACE FUNCTION public.sync_answer_criterion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT key INTO v_key FROM public.verification_criteria WHERE id = NEW.criterion_id;
  IF v_key = 'join_reason' AND char_length(btrim(NEW.answer)) < 40 THEN
    DELETE FROM public.application_criteria_met
    WHERE application_id = NEW.application_id AND criterion_id = NEW.criterion_id;
    RETURN NEW;
  END IF;
  INSERT INTO public.application_criteria_met (application_id, criterion_id)
  VALUES (NEW.application_id, NEW.criterion_id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- Answers: hers to write while pending; frozen once a decision exists (G-24).
-- can_self_attest_criterion already requires status='pending'; USING now does
-- too, so a decided application's answers cannot be edited or deleted.
DROP POLICY IF EXISTS ans_own ON public.application_answers;
CREATE POLICY ans_own_read ON public.application_answers
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.membership_applications a
    WHERE a.id = application_answers.application_id AND a.auth_user_id = auth.uid()
  ));
CREATE POLICY ans_own_write ON public.application_answers
  FOR INSERT TO authenticated
  WITH CHECK (public.can_self_attest_criterion(application_id, criterion_id));
CREATE POLICY ans_own_update ON public.application_answers
  FOR UPDATE TO authenticated
  USING (public.can_self_attest_criterion(application_id, criterion_id))
  WITH CHECK (public.can_self_attest_criterion(application_id, criterion_id));
REVOKE ALL ON public.application_answers FROM anon;
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.application_answers FROM authenticated;

-- A legal name typed wrong could never be corrected (G-19). While pending she
-- may replace it; once decided it is frozen until the purge takes it.
CREATE OR REPLACE FUNCTION public.save_applicant_legal_name(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app uuid;
  v_crit uuid;
BEGIN
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'enter your full legal name' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_app FROM public.membership_applications
  WHERE auth_user_id = auth.uid() AND status = 'pending';
  IF v_app IS NULL THEN
    RAISE EXCEPTION 'no open application' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.applicant_identity (application_id, legal_name)
  VALUES (v_app, btrim(p_name))
  ON CONFLICT (application_id) DO UPDATE SET legal_name = EXCLUDED.legal_name;

  SELECT id INTO v_crit FROM public.verification_criteria
  WHERE key = 'legal_name' AND is_active AND community_id IS NULL;
  IF v_crit IS NOT NULL THEN
    INSERT INTO public.application_criteria_met (application_id, criterion_id)
    VALUES (v_app, v_crit) ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.save_applicant_legal_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_applicant_legal_name(text) TO authenticated;

-- ── 10. Decisions: logged, final, explained (G-04, G-09, G-12, G-25) ───────
CREATE OR REPLACE FUNCTION public._apply_decision(p_application_id uuid, p_decision text,
                                                  p_note text, p_decided_by uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._apply_decision(p_application_id, p_decision, p_note, p_decided_by, NULL);
END;
$$;
REVOKE ALL ON FUNCTION public._apply_decision(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._apply_decision(p_application_id uuid, p_decision text,
                                                  p_note text, p_decided_by uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app      public.membership_applications%ROWTYPE;
  v_cool     integer;
  v_official uuid;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_app FROM public.membership_applications WHERE id = p_application_id FOR UPDATE;
  IF v_app.id IS NULL THEN
    RAISE EXCEPTION 'application not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_app.status <> 'pending' THEN
    RAISE EXCEPTION 'application already decided' USING ERRCODE = '22023';
  END IF;

  SELECT reject_cooldown_days INTO v_cool FROM public.gate_settings WHERE id;

  UPDATE public.membership_applications
  SET status          = p_decision,
      decided_at      = now(),
      ready_at        = COALESCE(ready_at, now()),
      decision_reason = CASE WHEN p_decision = 'rejected' THEN COALESCE(p_reason, 'other') END,
      rejected_until  = CASE WHEN p_decision = 'rejected'
                             THEN now() + make_interval(days => v_cool) END,
      purge_after     = CASE WHEN p_decision = 'rejected'
                             THEN now() + interval '90 days' END
  WHERE id = p_application_id;

  INSERT INTO public.application_reviews (application_id, decision_note, decided_by, updated_at)
  VALUES (p_application_id, p_note, p_decided_by, now())
  ON CONFLICT (application_id) DO UPDATE
    SET decision_note = COALESCE(EXCLUDED.decision_note, public.application_reviews.decision_note),
        decided_by    = EXCLUDED.decided_by,
        updated_at    = now();

  INSERT INTO public.application_decisions
    (subject_user_id, application_id, decision, reason_category, note, decided_by)
  VALUES (v_app.auth_user_id, p_application_id, p_decision,
          CASE WHEN p_decision = 'rejected' THEN COALESCE(p_reason, 'other') END,
          p_note, p_decided_by);

  -- The legal name has served its purpose the moment a human has decided.
  UPDATE public.applicant_identity
  SET purge_after = now() + interval '30 days'
  WHERE application_id = p_application_id;

  IF p_decision = 'approved' THEN
    -- Visible from the first second: is_active no longer depends on whether
    -- she happened to keep the placeholder username (G-04).
    UPDATE public.profiles
    SET vetting_status = 'approved',
        admitted_at    = now(),
        is_active      = true
    WHERE id = v_app.auth_user_id AND deleted_at IS NULL;

    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (v_app.community_id, v_app.auth_user_id, 'member')
    ON CONFLICT (community_id, user_id) DO NOTHING;

    -- Roxy Official on admission, not on signup (G-25).
    SELECT id INTO v_official FROM public.communities WHERE slug = 'roxy-official';
    IF v_official IS NOT NULL THEN
      INSERT INTO public.community_members (community_id, user_id, role)
      VALUES (v_official, v_app.auth_user_id, 'member')
      ON CONFLICT (community_id, user_id) DO NOTHING;
    END IF;
  ELSE
    UPDATE public.profiles SET vetting_status = 'rejected' WHERE id = v_app.auth_user_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._apply_decision(uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- Older Studio builds call the 3-argument form; it now routes through the
-- same rules with no reason category.
DROP FUNCTION IF EXISTS public.decide_application(uuid, text, text);
CREATE OR REPLACE FUNCTION public.decide_application(p_application_id uuid, p_decision text,
                                                     p_note text DEFAULT NULL,
                                                     p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_review_application(p_application_id) THEN
    RAISE EXCEPTION 'not authorised to decide this application' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membership_applications
                 WHERE id = p_application_id AND ready_at IS NOT NULL) THEN
    RAISE EXCEPTION 'this application has not been sent for review yet' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'rejected'
     AND (p_note IS NULL OR char_length(btrim(p_note)) < 10) THEN
    RAISE EXCEPTION 'a rejection requires a note of at least 10 characters' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NOT NULL AND p_reason NOT IN ('not_verified', 'not_known', 'incomplete', 'safety', 'other') THEN
    RAISE EXCEPTION 'unknown reason category' USING ERRCODE = '22023';
  END IF;

  PERFORM public._apply_decision(p_application_id, p_decision, p_note, auth.uid(), p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.decide_application(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_application(uuid, text, text, text) TO authenticated;

-- Reviewer notes: drafts while pending, frozen once decided (G-09). Only the
-- decision function writes after that, and it writes the log as well.
DROP POLICY IF EXISTS ar_reviewer ON public.application_reviews;
CREATE POLICY ar_reviewer_read ON public.application_reviews
  FOR SELECT TO authenticated
  USING (public.can_review_application(application_id));
CREATE POLICY ar_reviewer_insert ON public.application_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_review_application(application_id)
    AND EXISTS (SELECT 1 FROM public.membership_applications a
                WHERE a.id = application_id AND a.status = 'pending')
  );
CREATE POLICY ar_reviewer_update ON public.application_reviews
  FOR UPDATE TO authenticated
  USING (
    public.can_review_application(application_id)
    AND EXISTS (SELECT 1 FROM public.membership_applications a
                WHERE a.id = application_id AND a.status = 'pending')
  )
  WITH CHECK (
    public.can_review_application(application_id)
    AND EXISTS (SELECT 1 FROM public.membership_applications a
                WHERE a.id = application_id AND a.status = 'pending')
  );
REVOKE ALL ON public.application_reviews FROM anon;
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.application_reviews FROM authenticated;
REVOKE UPDATE ON public.application_reviews FROM authenticated;
-- application_id is in the list because PostgREST's upsert names every
-- payload column in DO UPDATE SET; the conflict key makes it a no-op.
GRANT UPDATE (application_id, safety_rating, watchlist, watchlist_reason, updated_at) ON public.application_reviews TO authenticated;
REVOKE INSERT ON public.application_reviews FROM authenticated;
GRANT INSERT (application_id, safety_rating, watchlist, watchlist_reason, updated_at) ON public.application_reviews TO authenticated;

-- ── 11. Appeals: append-only, resolved by staff, applicant told (G-12) ─────
REVOKE ALL ON public.application_appeals FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.application_appeals FROM authenticated;
GRANT SELECT ON public.application_appeals TO authenticated;
GRANT INSERT (application_id, reason) ON public.application_appeals TO authenticated;
DROP POLICY IF EXISTS aa_staff ON public.application_appeals;
CREATE POLICY aa_staff_read ON public.application_appeals
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());

CREATE OR REPLACE FUNCTION public.alert_staff_on_appeal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_staff_alert('staff_appeal_alert');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'alert_staff_on_appeal failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.alert_staff_on_appeal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_alert_staff_on_appeal ON public.application_appeals;
CREATE TRIGGER trg_alert_staff_on_appeal
  AFTER INSERT ON public.application_appeals
  FOR EACH ROW EXECUTE FUNCTION public.alert_staff_on_appeal();

CREATE OR REPLACE FUNCTION public.resolve_appeal(p_appeal_id uuid, p_outcome text, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appeal public.application_appeals%ROWTYPE;
  v_app    public.membership_applications%ROWTYPE;
  v_official uuid;
BEGIN
  IF NOT public.is_staff_reviewer() THEN
    RAISE EXCEPTION 'only Roxy staff reviewers resolve appeals' USING ERRCODE = '42501';
  END IF;
  IF p_outcome NOT IN ('upheld', 'overturned') THEN
    RAISE EXCEPTION 'outcome must be upheld or overturned' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) < 10 THEN
    RAISE EXCEPTION 'an appeal outcome needs a note of at least 10 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_appeal FROM public.application_appeals WHERE id = p_appeal_id FOR UPDATE;
  IF v_appeal.id IS NULL THEN
    RAISE EXCEPTION 'appeal not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_appeal.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'appeal already resolved' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_app FROM public.membership_applications WHERE id = v_appeal.application_id FOR UPDATE;

  UPDATE public.application_appeals
  SET resolved_at = now(), resolved_by = auth.uid(), outcome = p_outcome
  WHERE id = p_appeal_id;

  INSERT INTO public.application_decisions
    (subject_user_id, application_id, decision, note, decided_by)
  VALUES (v_app.auth_user_id, v_app.id,
          CASE p_outcome WHEN 'overturned' THEN 'appeal_overturned' ELSE 'appeal_upheld' END,
          p_note, auth.uid());

  IF p_outcome = 'overturned' THEN
    -- A rejection overturned is an approval. The approval email fires from
    -- the status trigger, exactly as for a first-time approval.
    UPDATE public.membership_applications
    SET status = 'approved', decided_at = now(), decision_reason = NULL,
        rejected_until = NULL, purge_after = NULL
    WHERE id = v_app.id;
    UPDATE public.profiles
    SET vetting_status = 'approved', admitted_at = now(), is_active = true
    WHERE id = v_app.auth_user_id AND deleted_at IS NULL;
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (v_app.community_id, v_app.auth_user_id, 'member')
    ON CONFLICT (community_id, user_id) DO NOTHING;
    SELECT id INTO v_official FROM public.communities WHERE slug = 'roxy-official';
    IF v_official IS NOT NULL THEN
      INSERT INTO public.community_members (community_id, user_id, role)
      VALUES (v_official, v_app.auth_user_id, 'member')
      ON CONFLICT (community_id, user_id) DO NOTHING;
    END IF;
  ELSE
    PERFORM public.enqueue_gate_email('application_appeal_upheld', 'applicant', v_app.auth_user_id,
              jsonb_build_object('application_id', v_app.id, 'can_reapply_at', v_app.rejected_until));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_appeal(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_appeal(uuid, text, text) TO authenticated;

-- ── 12. Grandfathered members: listed, review optional (G-23) ──────────────
CREATE OR REPLACE FUNCTION public.grandfathered_members()
RETURNS TABLE (user_id uuid, display_name text, username text, joined_at timestamptz,
               grandfathered_at timestamptz, reviewed boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.username, p.created_at, d.decided_at,
         EXISTS (SELECT 1 FROM public.application_decisions r
                 WHERE r.subject_user_id = p.id
                   AND r.decision IN ('grandfather_kept', 'grandfather_revoked'))
  FROM public.application_decisions d
  JOIN public.profiles p ON p.id = d.subject_user_id
  WHERE public.is_roxy_staff()
    AND d.decision = 'grandfathered'
  ORDER BY d.decided_at, p.created_at;
$$;
REVOKE ALL ON FUNCTION public.grandfathered_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grandfathered_members() TO authenticated;

CREATE OR REPLACE FUNCTION public.review_grandfathered_member(p_user_id uuid, p_keep boolean, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff_reviewer() THEN
    RAISE EXCEPTION 'only Roxy staff reviewers can do this' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.application_decisions
                 WHERE subject_user_id = p_user_id AND decision = 'grandfathered') THEN
    RAISE EXCEPTION 'not a grandfathered member' USING ERRCODE = '22023';
  END IF;
  IF NOT p_keep AND (p_note IS NULL OR char_length(btrim(p_note)) < 10) THEN
    RAISE EXCEPTION 'removing access needs a note of at least 10 characters' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.application_decisions (subject_user_id, decision, note, decided_by)
  VALUES (p_user_id, CASE WHEN p_keep THEN 'grandfather_kept' ELSE 'grandfather_revoked' END,
          NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid());

  IF NOT p_keep THEN
    -- Back to the waiting room: she can apply with a code like anyone else.
    UPDATE public.profiles SET vetting_status = 'pending' WHERE id = p_user_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.review_grandfathered_member(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_grandfathered_member(uuid, boolean, text) TO authenticated;

-- ── 13. Reviewer context and staff dashboard (G-10, G-13) ──────────────────
CREATE OR REPLACE FUNCTION public.review_queue_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN NOT public.is_roxy_staff() THEN NULL ELSE jsonb_build_object(
    'waiting', (SELECT count(*) FROM public.membership_applications
                WHERE status = 'pending' AND ready_at IS NOT NULL),
    'overdue', (SELECT count(*) FROM public.membership_applications
                WHERE status = 'pending' AND ready_at < now() - interval '48 hours'),
    'drafts',  (SELECT count(*) FROM public.membership_applications
                WHERE status = 'pending' AND ready_at IS NULL),
    'oldest_hours', (SELECT round(COALESCE(max(EXTRACT(EPOCH FROM now() - ready_at) / 3600.0), 0))
                     FROM public.membership_applications
                     WHERE status = 'pending' AND ready_at IS NOT NULL),
    'open_appeals', (SELECT count(*) FROM public.application_appeals WHERE resolved_at IS NULL),
    'grandfathered_unreviewed', (
      SELECT count(*) FROM public.application_decisions d
      WHERE d.decision = 'grandfathered'
        AND NOT EXISTS (SELECT 1 FROM public.application_decisions r
                        WHERE r.subject_user_id = d.subject_user_id
                          AND r.decision IN ('grandfather_kept', 'grandfather_revoked')))
  ) END;
$$;
REVOKE ALL ON FUNCTION public.review_queue_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_queue_stats() TO authenticated;

-- Everything a reviewer needs on one card, nothing she does not: profile basics,
-- every answer, criteria met, ID-check status, who minted the code. No legal
-- name (that stays behind the logged reveal), no contact details.
CREATE OR REPLACE FUNCTION public.application_review_context(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.membership_applications%ROWTYPE;
BEGIN
  IF NOT public.can_review_application(p_application_id) THEN
    RAISE EXCEPTION 'not authorised to review this application' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_app FROM public.membership_applications WHERE id = p_application_id;

  RETURN jsonb_build_object(
    'application', jsonb_build_object(
      'id', v_app.id, 'status', v_app.status, 'submitted_at', v_app.submitted_at,
      'ready_at', v_app.ready_at, 'decided_at', v_app.decided_at,
      'decision_reason', v_app.decision_reason,
      'community_name', (SELECT name FROM public.communities WHERE id = v_app.community_id)),
    'applicant', (
      SELECT jsonb_build_object(
        'display_name', NULLIF(p.display_name, 'Applicant'),
        'username', CASE WHEN p.username LIKE 'applicant\_%' THEN NULL ELSE p.username END,
        'avatar_url', p.avatar_url, 'pronouns', p.pronouns,
        'identity_labels', p.identity_labels, 'bio', p.bio,
        'onboarding_completed', p.onboarding_completed, 'account_created_at', p.created_at)
      FROM public.profiles p WHERE p.id = v_app.auth_user_id),
    'answers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'prompt', c.prompt,
                                          'answer', ans.answer, 'answered_at', ans.answered_at)
                       ORDER BY c.sort_order)
      FROM public.application_answers ans
      JOIN public.verification_criteria c ON c.id = ans.criterion_id
      WHERE ans.application_id = v_app.id), '[]'::jsonb),
    'criteria_met', COALESCE((
      SELECT jsonb_agg(c.label ORDER BY c.sort_order)
      FROM public.application_criteria_met m
      JOIN public.verification_criteria c ON c.id = m.criterion_id
      WHERE m.application_id = v_app.id AND c.is_active), '[]'::jsonb),
    'missing_required', to_jsonb(public.application_missing_required(v_app.id)),
    'legal_name_on_file', EXISTS (SELECT 1 FROM public.applicant_identity WHERE application_id = v_app.id),
    'id_check', (
      SELECT jsonb_build_object('status', iv.status, 'decided_at', iv.decided_at,
                                'duplicate_signal', iv.duplicate_signal IS NOT NULL)
      FROM public.identity_verifications iv
      WHERE iv.auth_user_id = v_app.auth_user_id
      ORDER BY iv.created_at DESC LIMIT 1),
    'code', (
      SELECT jsonb_build_object(
        'label', ic.label, 'is_member_code', ic.is_member_code,
        'minted_by', (SELECT COALESCE(NULLIF(btrim(cp.display_name), ''), cp.username)
                      FROM public.profiles cp WHERE cp.id = ic.created_by))
      FROM public.invite_codes ic WHERE ic.id = v_app.code_id),
    'appeal', (
      SELECT jsonb_build_object('id', ap.id, 'reason', ap.reason, 'requested_at', ap.requested_at,
                                'resolved_at', ap.resolved_at, 'outcome', ap.outcome)
      FROM public.application_appeals ap WHERE ap.application_id = v_app.id),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('decision', d.decision, 'reason', d.reason_category,
                                          'at', d.decided_at) ORDER BY d.decided_at)
      FROM public.application_decisions d WHERE d.subject_user_id = v_app.auth_user_id), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.application_review_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.application_review_context(uuid) TO authenticated;

-- ── 14. Roxy Official on admission, not signup (G-25) ──────────────────────
CREATE OR REPLACE FUNCTION public.join_official_community()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid;
BEGIN
  -- Applicants are not members; counting them in Official's member list told
  -- every member there that an unvetted account had joined.
  IF NEW.vetting_status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  SELECT id INTO cid FROM public.communities WHERE slug = 'roxy-official';
  IF cid IS NOT NULL THEN
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (cid, NEW.id, 'member')
    ON CONFLICT (community_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'join_official_community failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DELETE FROM public.community_members cm
USING public.profiles p, public.communities c
WHERE cm.user_id = p.id
  AND cm.community_id = c.id
  AND c.slug = 'roxy-official'
  AND cm.role = 'member'
  AND p.vetting_status <> 'approved';

-- Approved members who onboarded while pending were approved into an
-- invisible account. Make them visible (G-04).
UPDATE public.profiles
SET is_active = true
WHERE vetting_status = 'approved' AND is_active = false AND deleted_at IS NULL;

-- ── 15. Purge: deleted accounts' gate data too (G-16) ──────────────────────
CREATE OR REPLACE FUNCTION public.purge_expired_applicant_data()
RETURNS TABLE(names_purged integer, applications_purged integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_names integer;
  v_apps  integer;
  v_more  integer;
BEGIN
  WITH gone AS (
    DELETE FROM public.applicant_identity
    WHERE purge_after IS NOT NULL AND purge_after < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_names FROM gone;

  WITH gone AS (
    DELETE FROM public.membership_applications
    WHERE purge_after IS NOT NULL AND purge_after < now() AND status = 'rejected'
    RETURNING 1
  )
  SELECT count(*) INTO v_apps FROM gone;

  -- Accounts deleted more than 30 days ago keep no application, no legal name,
  -- no answers. The decision log stays until the auth user itself is deleted:
  -- it is the record of who let whom in.
  WITH gone AS (
    DELETE FROM public.membership_applications a
    USING public.profiles p
    WHERE p.id = a.auth_user_id
      AND p.deleted_at IS NOT NULL
      AND p.deleted_at < now() - interval '30 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_more FROM gone;
  v_apps := v_apps + v_more;

  DELETE FROM public.code_attempts WHERE attempted_at < now() - interval '30 days';

  RETURN QUERY SELECT v_names, v_apps;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_expired_applicant_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_applicant_data() TO service_role;

-- ── 16. Remaining anon grants on gate tables (G-25) ────────────────────────
REVOKE ALL ON public.applicant_identity, public.application_access_log,
              public.application_criteria_met, public.code_attempts,
              public.gate_settings, public.identity_verifications,
              public.verification_criteria
  FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.applicant_identity, public.application_access_log,
              public.application_criteria_met, public.code_attempts,
              public.gate_settings, public.identity_verifications
  FROM authenticated;

-- ── 17. Realtime: her own approval reaches the waiting room (G-11) ─────────
-- Realtime applies RLS and column grants per subscriber, so she receives only
-- her own rows, and only the columns she may read.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename = 'membership_applications') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.membership_applications;
    END IF;
  END IF;
END $$;
