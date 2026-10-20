-- Down for 130_gate_airtight.sql. Returns the gate to its 129 shape.
-- destructive-ok: drops only objects 130 created (application_decisions, member_invite_grants, views, columns ready_at/decision_reason/is_member_code/reviewer_granted_*); the decision log is lost by design of a down
--
-- NOT reversed, on purpose:
--   * the 6 grandfathered accounts stay 'approved' (they were already treated
--     as members under 129's is_approved_member; flipping them back to
--     'unvetted' would change nothing for them and lose the admitted_at);
--   * is_active=true on approved accounts (129 left them invisible by a bug);
--   * applicants removed from Roxy Official (129 put them there by a bug).
-- Re-adding 'unvetted' to the CHECK lets 129's code paths run unchanged.

DROP TRIGGER IF EXISTS trg_alert_staff_on_appeal ON public.application_appeals;
DROP FUNCTION IF EXISTS public.alert_staff_on_appeal();
DROP FUNCTION IF EXISTS public.resolve_appeal(uuid, text, text);
DROP FUNCTION IF EXISTS public.grandfathered_members();
DROP FUNCTION IF EXISTS public.review_grandfathered_member(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.review_queue_stats();
DROP FUNCTION IF EXISTS public.application_review_context(uuid);
DROP FUNCTION IF EXISTS public.submit_application();
DROP FUNCTION IF EXISTS public.save_applicant_legal_name(text);
DROP FUNCTION IF EXISTS public.redeem_invite_code(text);
DROP FUNCTION IF EXISTS public.my_member_invites();
DROP FUNCTION IF EXISTS public.mint_review_code(text, integer);
DROP FUNCTION IF EXISTS public.grant_reviewer(uuid, boolean);
DROP FUNCTION IF EXISTS public.sign_reviewer_agreement();
DROP FUNCTION IF EXISTS public.reviewer_candidates();
DROP FUNCTION IF EXISTS public.member_presence(uuid[]);
DROP FUNCTION IF EXISTS public.is_username_available(text);
DROP FUNCTION IF EXISTS public.enqueue_staff_alert(text);
DROP FUNCTION IF EXISTS public.decide_application(uuid, text, text, text);
DROP FUNCTION IF EXISTS public._apply_decision(uuid, text, text, uuid, text);
DROP VIEW IF EXISTS public.my_profile;
DROP VIEW IF EXISTS public.staff_profiles;
DROP TABLE IF EXISTS public.member_invite_grants;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public' AND tablename = 'membership_applications') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.membership_applications;
  END IF;
END $$;

-- ── profiles back to 129 ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_profiles_force_pending ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_force_pending();
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_vetting_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_vetting_status_check
  CHECK (vetting_status IN ('unvetted', 'pending', 'approved', 'rejected'));
ALTER TABLE public.profiles ALTER COLUMN vetting_status SET DEFAULT 'unvetted';

GRANT SELECT, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.profiles TO authenticated;
GRANT SELECT, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.profiles TO anon;

DROP POLICY IF EXISTS profiles_select_public ON public.profiles;
CREATE POLICY profiles_select_public ON public.profiles
  FOR SELECT TO authenticated
  USING (is_active = true AND is_ghost = false AND NOT public.blocked_pair(auth.uid(), id));

CREATE OR REPLACE FUNCTION public.approve_on_staff_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_staff = true AND COALESCE(OLD.is_staff, false) = false
     AND NEW.vetting_status = 'unvetted' THEN
    NEW.vetting_status := 'approved';
    NEW.admitted_at    := COALESCE(NEW.admitted_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_approved_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND vetting_status IN ('approved', 'unvetted'));
$$;

CREATE OR REPLACE FUNCTION public.is_approved_member_id(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = p_user_id AND vetting_status IN ('approved', 'unvetted'));
$$;

CREATE OR REPLACE FUNCTION public.join_official_community()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM public.communities WHERE slug = 'roxy-official';
  IF cid IS NOT NULL THEN
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (cid, NEW.id, 'member') ON CONFLICT (community_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ── reviewers back to 129 (self-service, as it was) ─────────────────────────
DROP POLICY IF EXISTS ms_own_community ON public.member_safety;
CREATE POLICY ms_own_community ON public.member_safety
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.community_members m
    JOIN public.profiles p ON p.id = auth.uid()
    LEFT JOIN public.reviewer_settings rs ON rs.user_id = auth.uid()
    WHERE m.community_id = member_safety.community_id AND m.user_id = auth.uid()
      AND m.role IN ('admin', 'border_patrol') AND p.vetting_status = 'approved'
      AND rs.reviewer_agreement_at IS NOT NULL))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.community_members m
      JOIN public.profiles p ON p.id = auth.uid()
      LEFT JOIN public.reviewer_settings rs ON rs.user_id = auth.uid()
      WHERE m.community_id = member_safety.community_id AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'border_patrol') AND p.vetting_status = 'approved'
        AND rs.reviewer_agreement_at IS NOT NULL)
    AND EXISTS (SELECT 1 FROM public.community_members subject
                WHERE subject.community_id = member_safety.community_id
                  AND subject.user_id = member_safety.user_id));

DROP POLICY IF EXISTS rs_read_own ON public.reviewer_settings;
DROP POLICY IF EXISTS rs_own ON public.reviewer_settings;
CREATE POLICY rs_own ON public.reviewer_settings
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT INSERT, UPDATE, DELETE ON public.reviewer_settings TO authenticated;
ALTER TABLE public.reviewer_settings DROP COLUMN IF EXISTS reviewer_granted_at;
ALTER TABLE public.reviewer_settings DROP COLUMN IF EXISTS reviewer_granted_by;

CREATE OR REPLACE FUNCTION public.can_review_application(app_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists (
    select 1
    from public.membership_applications a
    cross join lateral (
      select p.is_staff, p.vetting_status, p.staff_role from public.profiles p where p.id = auth.uid()
    ) me
    left join public.reviewer_settings rs on rs.user_id = auth.uid()
    where a.id = app_id
      and (
        me.staff_role = 'core'
        or (
          me.vetting_status = 'approved'
          and rs.reviewer_agreement_at is not null
          and (
            me.is_staff
            or exists (select 1 from public.community_members m
                       where m.community_id = a.community_id and m.user_id = auth.uid()
                         and m.role in ('admin', 'border_patrol'))
            or (
              rs.accepts_overflow
              and a.status = 'pending'
              and a.submitted_at < now() - make_interval(days => (select overflow_after_days from public.gate_settings))
              and exists (select 1 from public.community_members m2
                          where m2.user_id = auth.uid() and m2.role in ('admin', 'border_patrol'))
            )
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.reveal_applicant_legal_name(app_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  IF NOT public.can_review_application(app_id) THEN
    RAISE EXCEPTION 'not authorised to review this application' USING ERRCODE = '42501';
  END IF;
  SELECT legal_name INTO v_name FROM public.applicant_identity WHERE application_id = app_id;
  IF v_name IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.application_access_log (application_id, viewer_id, field)
  VALUES (app_id, auth.uid(), 'legal_name');
  RETURN v_name;
END;
$$;

-- ── invite codes back to 129 ────────────────────────────────────────────────
DROP POLICY IF EXISTS ic_insert_reviewer ON public.invite_codes;
DROP POLICY IF EXISTS ic_update_reviewer ON public.invite_codes;
DROP POLICY IF EXISTS ic_read_reviewer ON public.invite_codes;
CREATE POLICY ic_insert_admin ON public.invite_codes
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND is_review_code = false AND (
    public.is_roxy_core() OR EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = invite_codes.community_id AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'border_patrol'))));
CREATE POLICY ic_update_admin ON public.invite_codes
  FOR UPDATE TO authenticated
  USING (is_review_code = false AND (public.is_roxy_core() OR EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = invite_codes.community_id AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'border_patrol'))))
  WITH CHECK (is_review_code = false AND (public.is_roxy_core() OR EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = invite_codes.community_id AND m.user_id = auth.uid()
        AND m.role IN ('admin', 'border_patrol'))));
CREATE POLICY ic_read_own_community ON public.invite_codes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.community_members m
                 WHERE m.community_id = invite_codes.community_id AND m.user_id = auth.uid()
                   AND m.role IN ('admin', 'border_patrol')));
GRANT INSERT ON public.invite_codes TO authenticated;
DROP FUNCTION IF EXISTS public.invite_code_quota_ok();
ALTER TABLE public.invite_codes DROP COLUMN IF EXISTS is_member_code;

CREATE OR REPLACE FUNCTION public.invite_code_redeemers()
RETURNS TABLE(code_id uuid, user_id uuid, display_name text, username text, vetting_status text,
              access_tier text, staff_role text, is_staff boolean, is_community_owner boolean,
              used_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select c.id, p.id, coalesce(nullif(btrim(p.display_name), ''), 'Applicant'), p.username,
         p.vetting_status, p.access_tier::text, p.staff_role, coalesce(p.is_staff, false),
         coalesce(p.is_community_owner, false), coalesce(a.submitted_at, p.created_at)
  from public.invite_codes c
  join public.profiles p on p.admitted_via_code_id = c.id
  left join public.membership_applications a on a.auth_user_id = p.id and a.code_id = c.id
  where public.is_roxy_staff()
     or exists (select 1 from public.community_members m
                where m.community_id = c.community_id and m.user_id = auth.uid()
                  and m.role in ('admin', 'border_patrol'));
$$;

-- ── applications, answers, reviews, appeals back to 129 ─────────────────────
DROP POLICY IF EXISTS ans_own_read ON public.application_answers;
DROP POLICY IF EXISTS ans_own_write ON public.application_answers;
DROP POLICY IF EXISTS ans_own_update ON public.application_answers;
CREATE POLICY ans_own ON public.application_answers
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.membership_applications a
                 WHERE a.id = application_answers.application_id AND a.auth_user_id = auth.uid()))
  WITH CHECK (public.can_self_attest_criterion(application_id, criterion_id));
GRANT DELETE ON public.application_answers TO authenticated;

DROP POLICY IF EXISTS ar_reviewer_read ON public.application_reviews;
DROP POLICY IF EXISTS ar_reviewer_insert ON public.application_reviews;
DROP POLICY IF EXISTS ar_reviewer_update ON public.application_reviews;
CREATE POLICY ar_reviewer ON public.application_reviews
  FOR ALL TO authenticated
  USING (public.can_review_application(application_id))
  WITH CHECK (public.can_review_application(application_id));
GRANT INSERT, UPDATE, DELETE ON public.application_reviews TO authenticated;

DROP POLICY IF EXISTS aa_staff_read ON public.application_appeals;
CREATE POLICY aa_staff ON public.application_appeals
  FOR ALL TO authenticated USING (public.is_roxy_staff()) WITH CHECK (public.is_roxy_staff());
GRANT INSERT, UPDATE, DELETE ON public.application_appeals TO authenticated;

CREATE POLICY ma_withdraw_own ON public.membership_applications
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid() AND status = 'pending')
  WITH CHECK (auth_user_id = auth.uid() AND status IN ('pending', 'withdrawn'));
GRANT UPDATE (status) ON public.membership_applications TO authenticated;
GRANT INSERT ON public.membership_applications TO authenticated;
DROP INDEX IF EXISTS public.membership_applications_queue_idx;

CREATE OR REPLACE FUNCTION public.sync_answer_criterion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.application_criteria_met (application_id, criterion_id)
  VALUES (NEW.application_id, NEW.criterion_id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

UPDATE public.verification_criteria SET is_required = false
WHERE key = 'join_reason' AND community_id IS NULL;

CREATE OR REPLACE FUNCTION public._apply_decision(p_application_id uuid, p_decision text, p_note text, p_decided_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app  public.membership_applications%ROWTYPE;
  v_cool integer;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_app FROM public.membership_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found' USING ERRCODE = 'P0002'; END IF;
  IF v_app.status <> 'pending' THEN RAISE EXCEPTION 'application already decided' USING ERRCODE = '22023'; END IF;
  SELECT reject_cooldown_days INTO v_cool FROM public.gate_settings WHERE id;
  UPDATE public.membership_applications
  SET status = p_decision, decided_at = now(),
      rejected_until = CASE WHEN p_decision = 'rejected' THEN now() + make_interval(days => v_cool) END,
      purge_after    = CASE WHEN p_decision = 'rejected' THEN now() + interval '90 days' END
  WHERE id = p_application_id;
  INSERT INTO public.application_reviews (application_id, decision_note, decided_by, updated_at)
  VALUES (p_application_id, p_note, p_decided_by, now())
  ON CONFLICT (application_id) DO UPDATE
    SET decision_note = COALESCE(EXCLUDED.decision_note, public.application_reviews.decision_note),
        decided_by = EXCLUDED.decided_by, updated_at = now();
  UPDATE public.applicant_identity SET purge_after = now() + interval '30 days' WHERE application_id = p_application_id;
  IF p_decision = 'approved' THEN
    UPDATE public.profiles
    SET vetting_status = 'approved', admitted_at = now(),
        is_active = CASE WHEN username = 'applicant_' || replace(v_app.auth_user_id::text, '-', '')
                         THEN true ELSE is_active END
    WHERE id = v_app.auth_user_id;
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (v_app.community_id, v_app.auth_user_id, 'member') ON CONFLICT (community_id, user_id) DO NOTHING;
  ELSE
    UPDATE public.profiles SET vetting_status = 'rejected' WHERE id = v_app.auth_user_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._apply_decision(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.decide_application(p_application_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_review_application(p_application_id) THEN
    RAISE EXCEPTION 'not authorised to decide this application' USING ERRCODE = '42501';
  END IF;
  IF p_decision = 'rejected' AND (p_note IS NULL OR char_length(btrim(p_note)) < 10) THEN
    RAISE EXCEPTION 'a rejection requires a note of at least 10 characters' USING ERRCODE = '22023';
  END IF;
  PERFORM public._apply_decision(p_application_id, p_decision, p_note, auth.uid());
END;
$$;
GRANT EXECUTE ON FUNCTION public.decide_application(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_membership_application(p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code public.invite_codes%ROWTYPE;
  v_app  uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_code FROM public.invite_codes WHERE code = upper(btrim(p_code));
  IF v_code.id IS NULL OR v_code.revoked_at IS NOT NULL OR v_code.locked_at IS NOT NULL
     OR (v_code.expires_at IS NOT NULL AND v_code.expires_at < now())
     OR (v_code.max_uses IS NOT NULL AND v_code.uses_count >= v_code.max_uses) THEN
    RAISE EXCEPTION 'invite code is not usable' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.membership_applications
             WHERE auth_user_id = auth.uid() AND status = 'rejected'
               AND rejected_until IS NOT NULL AND rejected_until > now()) THEN
    RAISE EXCEPTION 'you cannot reapply yet' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.profiles (id, username, display_name, is_active)
  VALUES (auth.uid(), 'applicant_' || replace(auth.uid()::text, '-', ''), 'Applicant', false)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.membership_applications (auth_user_id, code_id, community_id)
  VALUES (auth.uid(), v_code.id, v_code.community_id)
  ON CONFLICT (auth_user_id) DO UPDATE
    SET code_id = EXCLUDED.code_id, community_id = EXCLUDED.community_id, status = 'pending',
        submitted_at = now(), decided_at = NULL, rejected_until = NULL, purge_after = NULL
  RETURNING id INTO v_app;
  UPDATE public.invite_codes SET uses_count = uses_count + 1 WHERE id = v_code.id;
  UPDATE public.profiles SET vetting_status = 'pending', admitted_via_code_id = v_code.id WHERE id = auth.uid();
  IF v_code.is_review_code THEN
    PERFORM public._apply_decision(v_app, 'approved', 'Automatic: store review code.', NULL);
  END IF;
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_application_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = OLD.status OR NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;
  INSERT INTO public.email_queue (email_type, recipient_type, recipient_user_id, payload)
  VALUES (CASE NEW.status WHEN 'approved' THEN 'application_approved' ELSE 'application_rejected' END,
          'applicant', NEW.auth_user_id,
          jsonb_build_object('application_id', NEW.id,
                             'community_name', (SELECT name FROM public.communities WHERE id = NEW.community_id),
                             'can_reapply_at', NEW.rejected_until));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_applicant_data()
RETURNS TABLE(names_purged integer, applications_purged integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_names integer; v_apps integer;
BEGIN
  WITH gone AS (DELETE FROM public.applicant_identity WHERE purge_after IS NOT NULL AND purge_after < now() RETURNING 1)
  SELECT count(*) INTO v_names FROM gone;
  WITH gone AS (DELETE FROM public.membership_applications
                WHERE purge_after IS NOT NULL AND purge_after < now() AND status = 'rejected' RETURNING 1)
  SELECT count(*) INTO v_apps FROM gone;
  DELETE FROM public.code_attempts WHERE attempted_at < now() - interval '30 days';
  RETURN QUERY SELECT v_names, v_apps;
END;
$$;

DROP FUNCTION IF EXISTS public.enqueue_gate_email(text, text, uuid, jsonb);

-- Email types/recipients back to 129 (rows of the new types, if any, go first).
DELETE FROM public.email_queue
WHERE email_type IN ('application_appeal_upheld', 'staff_application_alert', 'staff_appeal_alert')
   OR recipient_type = 'staff';
ALTER TABLE public.email_queue DROP CONSTRAINT IF EXISTS email_queue_email_type_check;
ALTER TABLE public.email_queue ADD CONSTRAINT email_queue_email_type_check
  CHECK (email_type IN ('order_shipped_buyer', 'product_approved', 'product_rejected',
    'refund_notification_buyer', 'dispute_alert_business', 'application_approved',
    'application_rejected', 'application_received'));
ALTER TABLE public.email_queue DROP CONSTRAINT IF EXISTS email_queue_recipient_type_check;
ALTER TABLE public.email_queue ADD CONSTRAINT email_queue_recipient_type_check
  CHECK (recipient_type IN ('buyer', 'business', 'applicant'));

ALTER TABLE public.membership_applications DROP CONSTRAINT IF EXISTS membership_applications_decision_reason_check;
ALTER TABLE public.membership_applications DROP COLUMN IF EXISTS decision_reason;
ALTER TABLE public.membership_applications DROP COLUMN IF EXISTS ready_at;

DROP TRIGGER IF EXISTS trg_application_decisions_append_only ON public.application_decisions;
DROP TABLE IF EXISTS public.application_decisions;
DROP FUNCTION IF EXISTS public.application_decisions_append_only();

-- Last: policies above referenced these until they were replaced.
DROP FUNCTION IF EXISTS public.is_granted_reviewer_for(uuid);
DROP FUNCTION IF EXISTS public.is_staff_reviewer();
