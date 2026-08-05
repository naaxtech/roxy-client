-- ============================================================
-- 074_processor_agreements_and_consent.sql
--
-- Two things the invite gate needs in order to be lawful, not merely working.
--
-- 1. PROCESSOR REGISTER + HARD GATE.
--    GDPR Art. 28(3) forbids using a processor to handle personal data without
--    a contract in place. Didit lists its DPA under the Enterprise tier, and
--    whether a standard DPA covers the free tier is unconfirmed. A comment in a
--    spec does not stop code from running, so the check lives here: no DPA row,
--    no verification session. The system refuses rather than trusting anyone to
--    remember.
--
-- 2. CONSENT RECORD.
--    Art. 9(2)(a) requires EXPLICIT consent to process special-category data,
--    and Art. 7(1) requires being able to DEMONSTRATE it. Roxy already holds
--    sexual-orientation data; the gate adds identity verification on top. A
--    checkbox that leaves no record is not demonstrable consent.
--
-- Retry-safe: idempotent throughout.
-- ============================================================

-- ── 1. Processor register (Art. 28 + Art. 30) ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.processor_agreements (
  processor        text        PRIMARY KEY,
  purpose          text        NOT NULL,
  -- NULL means no contract on record. Every gate below reads it as "stop".
  dpa_signed_at    timestamptz,
  dpa_reference    text,
  -- Art. 46: needed when the processor moves data outside the EEA/UK.
  transfer_mechanism text      CHECK (
                                 transfer_mechanism IS NULL
                                 OR transfer_mechanism IN ('scc','adequacy','bcr','derogation')
                               ),
  data_categories  text[]      NOT NULL DEFAULT '{}',
  retention_note   text,
  sub_processors   text[]      NOT NULL DEFAULT '{}',
  reviewed_at      timestamptz,
  updated_by       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processor_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pa_staff" ON public.processor_agreements;
CREATE POLICY "pa_staff" ON public.processor_agreements
  FOR ALL TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff());

-- Seeded deliberately with dpa_signed_at NULL. This is the honest current
-- state: no DPA is on record, so identity verification is switched off until
-- one is. Filling this row in is a legal act, not a deployment step -- do it
-- only when the signed agreement actually exists.
INSERT INTO public.processor_agreements
  (processor, purpose, data_categories, retention_note, transfer_mechanism)
VALUES (
  'didit',
  'Identity document verification and liveness check for membership applications',
  ARRAY['government_id_image','facial_biometric','document_metadata','device_ip'],
  'Artifacts are held by the processor. Roxy stores only status, session id and a duplicate signal.',
  NULL
)
ON CONFLICT (processor) DO NOTHING;

/**
 * The gate. Returns true only when a DPA is genuinely recorded.
 *
 * Deliberately not a feature flag: a flag says "we chose not to", this says
 * "we are not permitted to". Both stop the code, but only one is auditable.
 */
CREATE OR REPLACE FUNCTION public.processor_is_cleared(p_processor text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.processor_agreements
    WHERE processor = p_processor
      AND dpa_signed_at IS NOT NULL
      AND dpa_signed_at <= now()
  );
$$;

GRANT EXECUTE ON FUNCTION public.processor_is_cleared(text) TO authenticated;

COMMENT ON FUNCTION public.processor_is_cleared(text) IS
  'Art. 28(3) gate: false until a DPA is recorded for this processor. kyc-create-session refuses while false.';

-- Belt and braces: even if an edge function forgets to ask, the row cannot be
-- written. A verification record is evidence that processing happened.
CREATE OR REPLACE FUNCTION public.assert_processor_cleared()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.processor_is_cleared(NEW.provider) THEN
    RAISE EXCEPTION
      'No data processing agreement on record for processor "%": refusing to process personal data (GDPR Art. 28)',
      NEW.provider
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_processor_cleared ON public.identity_verifications;
CREATE TRIGGER trg_assert_processor_cleared
  BEFORE INSERT ON public.identity_verifications
  FOR EACH ROW EXECUTE FUNCTION public.assert_processor_cleared();

-- ── 2. Consent (Art. 7 + Art. 9(2)(a)) ──────────────────────────────────────
-- One row per grant, one per withdrawal. Never updated in place: "when did she
-- consent, and to what wording" is unanswerable if the record is mutable.

CREATE TABLE IF NOT EXISTS public.consent_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose        text        NOT NULL CHECK (purpose IN (
                               'identity_verification',
                               'special_category_processing',
                               'ai_training',
                               'marketing'
                             )),
  granted        boolean     NOT NULL,
  -- The exact wording shown. Consent to a policy you cannot reproduce is not
  -- demonstrable consent.
  policy_version text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_user
  ON public.consent_events(user_id, purpose, created_at DESC);

ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;

-- Own rows readable and insertable; never updatable or deletable by anyone,
-- which is what makes the trail worth having.
DROP POLICY IF EXISTS "ce_read_own" ON public.consent_events;
CREATE POLICY "ce_read_own" ON public.consent_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ce_insert_own" ON public.consent_events;
CREATE POLICY "ce_insert_own" ON public.consent_events
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ce_read_staff" ON public.consent_events;
CREATE POLICY "ce_read_staff" ON public.consent_events
  FOR SELECT TO authenticated USING (public.is_roxy_staff());

/** Current state of a consent: the most recent event wins. */
CREATE OR REPLACE FUNCTION public.has_consent(p_user_id uuid, p_purpose text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT granted FROM public.consent_events
     WHERE user_id = p_user_id AND purpose = p_purpose
     ORDER BY created_at DESC LIMIT 1),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_consent(uuid, text) TO authenticated;

-- Identity verification cannot start without explicit consent on record.
CREATE OR REPLACE FUNCTION public.assert_verification_consent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_consent(NEW.auth_user_id, 'identity_verification') THEN
    RAISE EXCEPTION
      'No explicit consent on record for identity verification (GDPR Art. 9(2)(a))'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_verification_consent ON public.identity_verifications;
CREATE TRIGGER trg_assert_verification_consent
  BEFORE INSERT ON public.identity_verifications
  FOR EACH ROW EXECUTE FUNCTION public.assert_verification_consent();

-- ── 3. Erasure coverage (Art. 17) ───────────────────────────────────────────
-- gdpr-delete previously touched only profiles and push_tokens. Everything the
-- invite gate stores -- legal name, identity outcomes, answers, appeals, safety
-- notes -- was outside erasure entirely. One function so a future table added
-- to the gate has one obvious place to be registered.

CREATE OR REPLACE FUNCTION public.erase_gate_data(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Deleting the application cascades to applicant_identity, application_reviews,
  -- application_answers, application_criteria_met, application_access_log and
  -- application_appeals -- every one is ON DELETE CASCADE from this row.
  DELETE FROM public.membership_applications WHERE auth_user_id = p_user_id;

  -- The vendor keeps its own record under its own lawful basis; ours goes.
  DELETE FROM public.identity_verifications WHERE auth_user_id = p_user_id;

  -- Safety notes are erased too. Retaining them would need a documented lawful
  -- basis under Art. 17(3), and we do not need one: a returning banned user
  -- still needs a fresh invite code, and the processor's own duplicate
  -- detection catches a repeat identity without us holding anything.
  DELETE FROM public.member_safety WHERE user_id = p_user_id;

  -- consent_events is deliberately NOT deleted here. It is the evidence that
  -- processing was lawful while it happened, and Art. 17 does not require
  -- destroying the record that proves compliance. It dies with the auth user
  -- via ON DELETE CASCADE when the account is hard-deleted after 30 days.
END;
$$;

REVOKE ALL ON FUNCTION public.erase_gate_data(uuid) FROM public, anon, authenticated;

/** Everything the gate holds about one person, for Art. 15(3). */
CREATE OR REPLACE FUNCTION public.export_gate_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'application', (
      SELECT to_jsonb(a) - 'auth_user_id'
      FROM public.membership_applications a WHERE a.auth_user_id = p_user_id
    ),
    'legal_name', (
      SELECT ai.legal_name
      FROM public.applicant_identity ai
      JOIN public.membership_applications a ON a.id = ai.application_id
      WHERE a.auth_user_id = p_user_id
    ),
    'answers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'question', c.prompt, 'answer', ans.answer, 'answered_at', ans.answered_at)), '[]'::jsonb)
      FROM public.application_answers ans
      JOIN public.membership_applications a ON a.id = ans.application_id
      JOIN public.verification_criteria c ON c.id = ans.criterion_id
      WHERE a.auth_user_id = p_user_id
    ),
    'identity_verifications', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'provider', iv.provider, 'status', iv.status, 'decided_at', iv.decided_at)), '[]'::jsonb)
      FROM public.identity_verifications iv WHERE iv.auth_user_id = p_user_id
    ),
    'appeals', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'reason', ap.reason, 'requested_at', ap.requested_at, 'outcome', ap.outcome)), '[]'::jsonb)
      FROM public.application_appeals ap
      JOIN public.membership_applications a ON a.id = ap.application_id
      WHERE a.auth_user_id = p_user_id
    ),
    'consents', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'purpose', ce.purpose, 'granted', ce.granted,
               'policy_version', ce.policy_version, 'at', ce.created_at)
             ORDER BY ce.created_at), '[]'::jsonb)
      FROM public.consent_events ce WHERE ce.user_id = p_user_id
    ),
    -- Art. 15(1)(c): who her data was disclosed to.
    'processors', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'processor', pa.processor, 'purpose', pa.purpose,
               'data_categories', pa.data_categories)), '[]'::jsonb)
      FROM public.processor_agreements pa WHERE pa.dpa_signed_at IS NOT NULL
    )
  );
$$;

REVOKE ALL ON FUNCTION public.export_gate_data(uuid) FROM public, anon, authenticated;

-- Deliberately NOT exported: application_reviews (safety_rating, watchlist) and
-- application_access_log. Art. 15(4) preserves the rights of others, and
-- disclosing an internal safety assessment would identify the reviewer who
-- made it and defeat the purpose of having one. If a regulator or the data
-- subject formally requests it, that is a human decision with legal advice --
-- not something this function should hand out on request.
