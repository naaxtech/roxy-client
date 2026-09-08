-- ============================================================
-- 071_invite_gate_scoring.sql
--
-- The scoring system, the KYC record, and the four RPCs that own every write
-- the gate makes. Depends on 070.
--
-- Spec: docs/superpowers/specs/2026-08-01-invite-gate-vetting-design.md
--
-- The single most important decision in this file: the score is a FUNCTION,
-- never a stored column. Criteria are edited from the studio -- if the score
-- were materialised, changing "government ID" from 1 point to 2 would strand
-- every existing application at its old value, and the queue would sort on
-- stale numbers with nothing to indicate it. As a function, an edit reprices
-- the whole queue on next read and adding a criterion is one INSERT rather
-- than a migration. That is what "easy to change admin side" has to mean.
--
-- Retry-safe: idempotent throughout.
-- ============================================================

-- ── 1. Criteria ─────────────────────────────────────────────────────────────
-- kind='attribute' is something we can verify (legal name supplied, KYC passed).
-- kind='question' carries a prompt and is answered in free text. Both score.
-- community_id NULL means the criterion applies everywhere; set, it is that
-- community's own question.

CREATE TABLE IF NOT EXISTS public.verification_criteria (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text        NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{2,48}$'),
  kind          text        NOT NULL DEFAULT 'attribute' CHECK (kind IN ('attribute','question')),
  label         text        NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 120),
  description   text        CHECK (description IS NULL OR char_length(description) <= 500),
  prompt        text        CHECK (
                              (kind = 'attribute' AND prompt IS NULL)
                              OR (kind = 'question' AND prompt IS NOT NULL
                                  AND char_length(btrim(prompt)) BETWEEN 5 AND 500)
                            ),
  points        integer     NOT NULL DEFAULT 1 CHECK (points BETWEEN 0 AND 100),
  is_required   boolean     NOT NULL DEFAULT false,
  is_active     boolean     NOT NULL DEFAULT true,
  sort_order    integer     NOT NULL DEFAULT 100,
  community_id  uuid        REFERENCES public.communities(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A key is unique per scope: one global 'join_reason', plus one per community.
CREATE UNIQUE INDEX IF NOT EXISTS uq_criteria_key_global
  ON public.verification_criteria(key) WHERE community_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_criteria_key_community
  ON public.verification_criteria(community_id, key) WHERE community_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_criteria_active
  ON public.verification_criteria(is_active, sort_order) WHERE is_active = true;

ALTER TABLE public.verification_criteria ENABLE ROW LEVEL SECURITY;

-- Applicants must see the checklist they are being scored against. Showing
-- someone the bar they have to clear is not a leak -- hiding it would make the
-- process arbitrary.
DROP POLICY IF EXISTS "vc_read" ON public.verification_criteria;
CREATE POLICY "vc_read" ON public.verification_criteria
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "vc_staff" ON public.verification_criteria;
CREATE POLICY "vc_staff" ON public.verification_criteria
  FOR ALL TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff());

-- A community admin owns their community's own questions, nothing global.
DROP POLICY IF EXISTS "vc_community_admin" ON public.verification_criteria;
CREATE POLICY "vc_community_admin" ON public.verification_criteria
  FOR ALL TO authenticated
  USING (
    community_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = verification_criteria.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
    )
  )
  WITH CHECK (
    community_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = verification_criteria.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
    )
  );

-- Seed: the five criteria from the brief. Points are starting values and are
-- meant to be tuned from the studio -- that is the whole point of the design.
INSERT INTO public.verification_criteria (key, kind, label, description, prompt, points, sort_order)
VALUES
  ('legal_name',    'attribute', 'Real legal name',
   'Matches the name on your government ID. Only reviewers ever see it, and it is deleted 30 days after a decision.',
   NULL, 1, 10),
  ('gov_id',        'attribute', 'Government-issued ID',
   'Verified by our identity partner. Roxy never stores the image.',
   NULL, 1, 20),
  ('kyc_liveness',  'attribute', 'Live face check',
   'Confirms the ID belongs to you. Roxy never stores the scan.',
   NULL, 1, 30),
  ('social_account','attribute', 'Linked social account',
   'A public account that has existed for a while helps reviewers see you are real.',
   NULL, 1, 40),
  ('join_reason',   'question',  'Why Roxy?',
   NULL,
   'Tell us why you want to join Roxy, and what you are hoping to find here.', 1, 50)
ON CONFLICT DO NOTHING;

-- ── 2. Criteria met ─────────────────────────────────────────────────────────
-- evidence_ref holds a provider session id or a social handle -- never an
-- artifact, never a document number.

CREATE TABLE IF NOT EXISTS public.application_criteria_met (
  application_id uuid        NOT NULL REFERENCES public.membership_applications(id) ON DELETE CASCADE,
  criterion_id   uuid        NOT NULL REFERENCES public.verification_criteria(id)   ON DELETE CASCADE,
  evidence_ref   text        CHECK (evidence_ref IS NULL OR char_length(evidence_ref) <= 200),
  met_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, criterion_id)
);

ALTER TABLE public.application_criteria_met ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acm_own" ON public.application_criteria_met;
CREATE POLICY "acm_own" ON public.application_criteria_met
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.membership_applications a
      WHERE a.id = application_criteria_met.application_id AND a.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "acm_reviewer" ON public.application_criteria_met;
CREATE POLICY "acm_reviewer" ON public.application_criteria_met
  FOR SELECT TO authenticated
  USING (public.can_review_application(application_id));

-- Written only by the RPCs below and by the KYC webhook, under SECURITY DEFINER.

-- ── 3. Answers ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.application_answers (
  application_id uuid        NOT NULL REFERENCES public.membership_applications(id) ON DELETE CASCADE,
  criterion_id   uuid        NOT NULL REFERENCES public.verification_criteria(id)   ON DELETE CASCADE,
  answer         text        NOT NULL CHECK (char_length(btrim(answer)) BETWEEN 1 AND 4000),
  answered_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, criterion_id)
);

ALTER TABLE public.application_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ans_own" ON public.application_answers;
CREATE POLICY "ans_own" ON public.application_answers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.membership_applications a
      WHERE a.id = application_answers.application_id
        AND a.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.membership_applications a
      WHERE a.id = application_answers.application_id
        AND a.auth_user_id = auth.uid()
        AND a.status = 'pending'
    )
  );

DROP POLICY IF EXISTS "ans_reviewer" ON public.application_answers;
CREATE POLICY "ans_reviewer" ON public.application_answers
  FOR SELECT TO authenticated
  USING (public.can_review_application(application_id));

-- Answering a question is what satisfies that criterion. A trigger keeps the
-- two in step so the client cannot answer without scoring, or score without
-- answering.
CREATE OR REPLACE FUNCTION public.sync_answer_criterion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.application_criteria_met (application_id, criterion_id)
  VALUES (NEW.application_id, NEW.criterion_id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_answer_criterion ON public.application_answers;
CREATE TRIGGER trg_answer_criterion
  AFTER INSERT OR UPDATE ON public.application_answers
  FOR EACH ROW EXECUTE FUNCTION public.sync_answer_criterion();

-- ── 4. Identity verifications — deliberately artifact-free ──────────────────
-- Everything the vendor knows stays with the vendor. What we keep is a status,
-- a session id for support, and a duplicate signal so a rejected applicant
-- cannot come back through another community's code with the same face.

CREATE TABLE IF NOT EXISTS public.identity_verifications (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id      uuid        REFERENCES public.membership_applications(id) ON DELETE SET NULL,
  provider            text        NOT NULL DEFAULT 'didit',
  provider_session_id text        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','approved','declined','expired','abandoned')),
  -- Vendor-side identity hash used only for duplicate detection. Not a document
  -- number, not derived from one we hold, and useless outside the vendor.
  duplicate_signal    text,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_session_id)
);

CREATE INDEX IF NOT EXISTS idx_idv_user ON public.identity_verifications(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_idv_dupe
  ON public.identity_verifications(duplicate_signal) WHERE duplicate_signal IS NOT NULL;

ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "idv_own" ON public.identity_verifications;
CREATE POLICY "idv_own" ON public.identity_verifications
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "idv_reviewer" ON public.identity_verifications;
CREATE POLICY "idv_reviewer" ON public.identity_verifications
  FOR SELECT TO authenticated
  USING (application_id IS NOT NULL AND public.can_review_application(application_id));

-- Written only by the webhook edge function on the service role.

-- ── 5. The score ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.application_score(app_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(c.points), 0)::integer
  FROM public.application_criteria_met m
  JOIN public.verification_criteria c ON c.id = m.criterion_id
  WHERE m.application_id = app_id
    AND c.is_active = true;
$$;

COMMENT ON FUNCTION public.application_score(uuid) IS
  'Live sum of active criteria points. Never materialise this -- editing criteria must reprice existing applications.';

-- Required criteria that are still outstanding. Drives both the applicant
-- checklist and the reviewer''s "incomplete" badge.
CREATE OR REPLACE FUNCTION public.application_missing_required(app_id uuid)
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(c.key ORDER BY c.sort_order), '{}')
  FROM public.verification_criteria c
  WHERE c.is_active = true
    AND c.is_required = true
    AND (
      c.community_id IS NULL
      OR c.community_id = (SELECT community_id FROM public.membership_applications WHERE id = app_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.application_criteria_met m
      WHERE m.application_id = app_id AND m.criterion_id = c.id
    );
$$;

-- ── 6. Code validation (service-role only) ──────────────────────────────────
-- Postgres cannot see the caller's IP, so the edge function hashes it and
-- passes it in. Granting this to anon would let a client forge a fresh ip_hash
-- per request and defeat its own rate limit, so it is service_role only.

CREATE OR REPLACE FUNCTION public.validate_invite_code(p_code text, p_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_code       public.invite_codes%ROWTYPE;
  v_settings   public.gate_settings%ROWTYPE;
  v_recent     integer;
  v_global     integer;
  v_failures   integer;
  v_norm       text := upper(btrim(p_code));
  v_reason     text;
BEGIN
  SELECT * INTO v_settings FROM public.gate_settings WHERE id;

  -- Global floor first. The per-IP limit below is only as good as our ability
  -- to identify an IP, and x-forwarded-for is attacker-influenced -- a botnet
  -- or a spoofed header defeats per-IP counting entirely. This ceiling does not
  -- care who is calling, so it holds when the per-IP bucket has been split into
  -- a thousand pieces. Set well above organic traffic; it should only ever fire
  -- during an attack.
  SELECT count(*) INTO v_global
  FROM public.code_attempts
  WHERE attempted_at > now() - interval '1 minute';

  IF v_global >= v_settings.global_attempts_per_min THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.code_attempts
  WHERE ip_hash = p_ip_hash
    AND attempted_at > now() - interval '1 hour';

  IF v_recent >= v_settings.code_attempt_limit THEN
    -- Deliberately does not say whether any attempted code was real.
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT * INTO v_code FROM public.invite_codes WHERE code = v_norm;

  v_reason := CASE
    WHEN v_code.id IS NULL                                   THEN 'invalid'
    WHEN v_code.revoked_at IS NOT NULL                       THEN 'revoked'
    WHEN v_code.locked_at IS NOT NULL                        THEN 'locked'
    WHEN v_code.expires_at IS NOT NULL
         AND v_code.expires_at < now()                       THEN 'expired'
    WHEN v_code.max_uses IS NOT NULL
         AND v_code.uses_count >= v_code.max_uses            THEN 'exhausted'
    ELSE NULL
  END;

  INSERT INTO public.code_attempts (code_text, ip_hash, succeeded)
  VALUES (v_norm, p_ip_hash, v_reason IS NULL);

  IF v_reason IS NOT NULL THEN
    -- A code being ground against gets locked, not just rate-limited: the
    -- attacker can rotate IPs, but the code cannot rotate itself.
    IF v_code.id IS NOT NULL THEN
      SELECT count(*) INTO v_failures
      FROM public.code_attempts
      WHERE code_text = v_norm AND succeeded = false
        AND attempted_at > now() - interval '24 hours';

      IF v_failures >= v_settings.code_lock_threshold THEN
        UPDATE public.invite_codes SET locked_at = now() WHERE id = v_code.id;
      END IF;
    END IF;

    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'code_id', v_code.id,
    'community_id', v_code.community_id,
    'community_name', (SELECT name FROM public.communities WHERE id = v_code.community_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_invite_code(text, text) FROM public, anon, authenticated;

-- ── 7. Application creation ─────────────────────────────────────────────────
-- Runs after Supabase signUp, as the new user. Binds the account to the code
-- and puts the profile into 'pending' -- which, once 072 lands, means the
-- account can read nothing until a human says otherwise.

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

-- ── 8. The decision ─────────────────────────────────────────────────────────
-- Split in two on purpose.
--
-- _apply_decision does the work and checks NOTHING. It is the system acting,
-- and EXECUTE is revoked from every client role -- the only callers are the
-- review-code path above and the public wrapper below.
--
-- decide_application is the client entry point and enforces reviewer
-- capability with no exceptions. An earlier draft of this file let the
-- applicant themselves through so the review-code path would work, which meant
-- any user could approve their own application by calling the RPC directly.
-- The split is what makes the system path possible without opening that door.

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
    SET vetting_status = 'approved', admitted_at = now()
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

-- Unreachable from any client role. This is the whole point of the split.
REVOKE ALL ON FUNCTION public._apply_decision(uuid, text, text, uuid)
  FROM public, anon, authenticated;

-- The client entry point. No exceptions, no self-approval path.
CREATE OR REPLACE FUNCTION public.decide_application(
  p_application_id uuid,
  p_decision       text,
  p_note           text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_review_application(p_application_id) THEN
    RAISE EXCEPTION 'not authorised to decide this application' USING ERRCODE = '42501';
  END IF;

  -- A rejection with no note leaves the applicant, the appeal reviewer, and the
  -- next admin with nothing to go on.
  IF p_decision = 'rejected'
     AND (p_note IS NULL OR char_length(btrim(p_note)) < 10) THEN
    RAISE EXCEPTION 'a rejection requires a note of at least 10 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public._apply_decision(p_application_id, p_decision, p_note, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_application(uuid, text, text) TO authenticated;
