-- ============================================================
-- 070_invite_gate_core.sql
--
-- Roxy becomes invite-only. Codes are issued by communities, every applicant is
-- reviewed by a human, and every member stays attributable to the code that
-- admitted them.
--
-- Spec: docs/superpowers/specs/2026-08-01-invite-gate-vetting-design.md
--
-- This migration is the gate core: settings, codes, applications, the reviewer
-- split, and the Art. 9 access path. Criteria + scoring + KYC land in 071;
-- grandfathering and enforcement in 072. Nothing here changes access for an
-- existing user -- 070 is additive by design so it can sit on production
-- safely while the rest is built.
--
-- Retry-safe: idempotent throughout.
-- ============================================================

-- ── 1. Settings ─────────────────────────────────────────────────────────────
-- Deliberately its own single-row table rather than a key in platform_settings
-- (021): the gate must not inherit another feature's schema assumptions.

CREATE TABLE IF NOT EXISTS public.gate_settings (
  id                  boolean     PRIMARY KEY DEFAULT true CHECK (id),
  overflow_after_days integer     NOT NULL DEFAULT 7  CHECK (overflow_after_days BETWEEN 1 AND 90),
  reject_cooldown_days integer    NOT NULL DEFAULT 30 CHECK (reject_cooldown_days BETWEEN 0 AND 365),
  code_attempt_limit  integer     NOT NULL DEFAULT 5  CHECK (code_attempt_limit BETWEEN 1 AND 50),
  code_lock_threshold integer     NOT NULL DEFAULT 25 CHECK (code_lock_threshold BETWEEN 1 AND 1000),
  -- Floor that does not depend on IP at all. Per-IP limits are defeated by a
  -- botnet or a spoofable header; this one is not. Sized well above any
  -- plausible organic rate, so it only ever trips during an attack.
  global_attempts_per_min integer NOT NULL DEFAULT 60
                            CHECK (global_attempts_per_min BETWEEN 1 AND 10000),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gate_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.gate_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gs_read" ON public.gate_settings;
CREATE POLICY "gs_read" ON public.gate_settings
  FOR SELECT TO authenticated USING (true);

-- Writes are staff-only and go through the studio.
DROP POLICY IF EXISTS "gs_write" ON public.gate_settings;
CREATE POLICY "gs_write" ON public.gate_settings
  FOR UPDATE TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff());

-- ── 2. Profile columns ──────────────────────────────────────────────────────
-- 'unvetted' is the grandfather state: full access, honestly flagged. 072
-- backfills every existing row to it before enforcement turns on.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vetting_status text NOT NULL DEFAULT 'unvetted',
  ADD COLUMN IF NOT EXISTS admitted_via_code_id uuid,
  ADD COLUMN IF NOT EXISTS admitted_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_vetting_status_check
    CHECK (vetting_status IN ('unvetted','pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_profiles_vetting ON public.profiles(vetting_status);

-- ── 3. Invite codes ─────────────────────────────────────────────────────────
-- 10 chars of Crockford base32 (no I/L/O/U -- they are misread aloud, and these
-- codes get shared in DMs and read off screens). 32^10 ~= 1.1e15, which is what
-- makes the public pre-auth validation endpoint safe to expose at all.

CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  alphabet CONSTANT text  := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  raw      bytea          := uuid_send(gen_random_uuid());
  result   text           := '';
  i        integer;
BEGIN
  -- v4 uuids come from the server's strong RNG. 256 is a clean multiple of 32,
  -- so the modulo introduces no bias.
  FOR i IN 0..9 LOOP
    result := result || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
  END LOOP;
  RETURN result;
END;
$$;

CREATE TABLE IF NOT EXISTS public.invite_codes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text        NOT NULL UNIQUE DEFAULT public.generate_invite_code()
                            CHECK (code = upper(code) AND char_length(code) BETWEEN 6 AND 32),
  community_id  uuid        NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  created_by    uuid        NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  label         text        CHECK (label IS NULL OR char_length(label) <= 80),
  max_uses      integer     CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count    integer     NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  -- Store/app reviewers cannot pass an invite gate. This is the documented
  -- exception to "communities only": staff-issued, auto-approving, and excluded
  -- from analytics so it never pollutes acquisition numbers.
  is_review_code boolean    NOT NULL DEFAULT false,
  locked_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_community ON public.invite_codes(community_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_creator   ON public.invite_codes(created_by);

ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

-- Admins see their own community's codes. Nobody browses codes globally: the
-- code string is the credential, so a readable list is a readable keyring.
DROP POLICY IF EXISTS "ic_read_own_community" ON public.invite_codes;
CREATE POLICY "ic_read_own_community" ON public.invite_codes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = invite_codes.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
    )
  );

DROP POLICY IF EXISTS "ic_read_staff" ON public.invite_codes;
CREATE POLICY "ic_read_staff" ON public.invite_codes
  FOR SELECT TO authenticated USING (public.is_roxy_staff());

DROP POLICY IF EXISTS "ic_insert_admin" ON public.invite_codes;
CREATE POLICY "ic_insert_admin" ON public.invite_codes
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND is_review_code = false          -- only staff mint review codes, via service role
    AND EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = invite_codes.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
    )
  );

-- Revocation is an UPDATE. uses_count is bumped by the signup RPC under
-- SECURITY DEFINER, never by a client.
--
-- Two controls, because RLS alone is the wrong tool for half of this.
--
-- WITH CHECK is mandatory here: omit it and Postgres reuses USING for the new
-- row, which constrains only the community. An admin could then set
-- is_review_code = true on their own code -- and create_membership_application
-- auto-approves review codes, so that is a one-statement bypass of human review
-- for anyone they hand the code to. The INSERT policy blocked this; the UPDATE
-- path has to block it too.
--
-- Column grants do what RLS cannot: locked_at is a security control set by the
-- system when a code is being ground, and an admin clearing it re-opens the
-- attack. uses_count is likewise not theirs to rewrite.
REVOKE UPDATE ON public.invite_codes FROM authenticated;
GRANT UPDATE (label, max_uses, expires_at, revoked_at) ON public.invite_codes TO authenticated;

DROP POLICY IF EXISTS "ic_update_admin" ON public.invite_codes;
CREATE POLICY "ic_update_admin" ON public.invite_codes
  FOR UPDATE TO authenticated
  USING (
    is_review_code = false
    AND EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = invite_codes.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
    )
  )
  WITH CHECK (
    is_review_code = false
    AND EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = invite_codes.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
    )
  );

-- ── 4. Code attempts ────────────────────────────────────────────────────────
-- The validation endpoint is public and pre-auth, so it is the one place an
-- attacker can grind. IPs are hashed: an unsuccessful applicant's IP is still
-- personal data, and we have no reason to hold it in the clear.

CREATE TABLE IF NOT EXISTS public.code_attempts (
  id           bigserial   PRIMARY KEY,
  code_text    text        NOT NULL,
  ip_hash      text        NOT NULL,
  succeeded    boolean     NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_code_attempts_ip
  ON public.code_attempts(ip_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_code_attempts_code
  ON public.code_attempts(code_text, attempted_at DESC) WHERE succeeded = false;

ALTER TABLE public.code_attempts ENABLE ROW LEVEL SECURITY;
-- No client policy at all. Written and read only by the SECURITY DEFINER
-- validation path and by staff tooling on the service role.
DROP POLICY IF EXISTS "ca_staff" ON public.code_attempts;
CREATE POLICY "ca_staff" ON public.code_attempts
  FOR SELECT TO authenticated USING (public.is_roxy_staff());

-- ── 5. Applications ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.membership_applications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id   uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code_id        uuid        REFERENCES public.invite_codes(id) ON DELETE SET NULL,
  -- Denormalised so review access survives the code being deleted, and so the
  -- RLS predicate does not need a join.
  community_id   uuid        NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','approved','rejected','withdrawn')),
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  rejected_until timestamptz,
  purge_after    timestamptz,
  CONSTRAINT app_decided_consistency CHECK (
    (status IN ('pending','withdrawn') AND decided_at IS NULL)
    OR (status IN ('approved','rejected') AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_apps_queue
  ON public.membership_applications(community_id, status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_apps_overflow
  ON public.membership_applications(submitted_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_apps_purge
  ON public.membership_applications(purge_after) WHERE purge_after IS NOT NULL;

-- ── 6. Reviewer settings ────────────────────────────────────────────────────
-- reviewer_agreement_at is the confidentiality undertaking. Without it a
-- reviewer cannot reach Art. 9 data, including a grandfathered community admin.

CREATE TABLE IF NOT EXISTS public.reviewer_settings (
  user_id               uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  accepts_overflow      boolean     NOT NULL DEFAULT false,
  reviewer_agreement_at timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reviewer_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rs_own" ON public.reviewer_settings;
CREATE POLICY "rs_own" ON public.reviewer_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "rs_staff_read" ON public.reviewer_settings;
CREATE POLICY "rs_staff_read" ON public.reviewer_settings
  FOR SELECT TO authenticated USING (public.is_roxy_staff());

-- ── 7. Reviewer capability ──────────────────────────────────────────────────
-- One definition, used by every policy below. SECURITY DEFINER so it can read
-- community_members and profiles without tripping over their own RLS.

CREATE OR REPLACE FUNCTION public.can_review_application(app_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.membership_applications a
    CROSS JOIN LATERAL (
      SELECT p.is_staff, p.vetting_status FROM public.profiles p WHERE p.id = auth.uid()
    ) me
    LEFT JOIN public.reviewer_settings rs ON rs.user_id = auth.uid()
    WHERE a.id = app_id
      -- Gate 1: the reviewer is themselves vetted and has signed the undertaking.
      AND me.vetting_status = 'approved'
      AND rs.reviewer_agreement_at IS NOT NULL
      -- Gate 2: one of the three access routes.
      AND (
        me.is_staff
        OR EXISTS (
          SELECT 1 FROM public.community_members m
          WHERE m.community_id = a.community_id
            AND m.user_id = auth.uid()
            AND m.role IN ('admin','border_patrol')
        )
        OR (
          rs.accepts_overflow
          AND a.status = 'pending'
          AND a.submitted_at <
              now() - make_interval(days => (SELECT overflow_after_days FROM public.gate_settings))
          AND EXISTS (
            SELECT 1 FROM public.community_members m2
            WHERE m2.user_id = auth.uid()
              AND m2.role IN ('admin','border_patrol')
          )
        )
      )
  );
$$;

COMMENT ON FUNCTION public.can_review_application(uuid) IS
  'Reviewer capability: vetted + agreement signed, then staff OR own-community admin/border_patrol OR opted-in overflow on an aged application.';

ALTER TABLE public.membership_applications ENABLE ROW LEVEL SECURITY;

-- The applicant reads their own row. Safe only because every internal field
-- lives in application_reviews -- RLS is row-level, not column-level.
DROP POLICY IF EXISTS "ma_read_own" ON public.membership_applications;
CREATE POLICY "ma_read_own" ON public.membership_applications
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "ma_read_reviewer" ON public.membership_applications;
CREATE POLICY "ma_read_reviewer" ON public.membership_applications
  FOR SELECT TO authenticated USING (public.can_review_application(id));

-- Decisions go through an RPC (071) so they can be transactional with the
-- profile flip and the email enqueue. Reviewers get UPDATE for status changes
-- made through that path; direct client writes are blocked by the RPC being the
-- only thing that knows how to write application_reviews.
DROP POLICY IF EXISTS "ma_update_reviewer" ON public.membership_applications;
CREATE POLICY "ma_update_reviewer" ON public.membership_applications
  FOR UPDATE TO authenticated
  USING (public.can_review_application(id))
  WITH CHECK (public.can_review_application(id));

-- Withdrawal is the applicant's own right.
DROP POLICY IF EXISTS "ma_withdraw_own" ON public.membership_applications;
CREATE POLICY "ma_withdraw_own" ON public.membership_applications
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid() AND status = 'pending')
  WITH CHECK (auth_user_id = auth.uid() AND status IN ('pending','withdrawn'));

-- ── 8. Reviews (internal — the applicant must never read this) ──────────────

CREATE TABLE IF NOT EXISTS public.application_reviews (
  application_id   uuid        PRIMARY KEY
                               REFERENCES public.membership_applications(id) ON DELETE CASCADE,
  safety_rating    integer     CHECK (safety_rating BETWEEN 1 AND 5),
  watchlist        boolean     NOT NULL DEFAULT false,
  -- A flag without a reason is an accusation nobody can audit.
  watchlist_reason text        CHECK (
                                 (watchlist = false)
                                 OR (watchlist_reason IS NOT NULL
                                     AND char_length(btrim(watchlist_reason)) >= 10)
                               ),
  decision_note    text        CHECK (decision_note IS NULL OR char_length(decision_note) <= 2000),
  decided_by       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ar_reviewer" ON public.application_reviews;
CREATE POLICY "ar_reviewer" ON public.application_reviews
  FOR ALL TO authenticated
  USING (public.can_review_application(application_id))
  WITH CHECK (public.can_review_application(application_id));

-- ── 9. Applicant identity — Art. 9, RPC-only ────────────────────────────────
-- No SELECT policy exists on this table by design. RLS cannot log a read, so
-- the read path is a function that logs. A direct PostgREST select returns zero
-- rows for everyone, including staff.

CREATE TABLE IF NOT EXISTS public.applicant_identity (
  application_id uuid        PRIMARY KEY
                             REFERENCES public.membership_applications(id) ON DELETE CASCADE,
  legal_name     text        NOT NULL CHECK (char_length(btrim(legal_name)) BETWEEN 2 AND 200),
  purge_after    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applicant_identity_purge
  ON public.applicant_identity(purge_after) WHERE purge_after IS NOT NULL;

ALTER TABLE public.applicant_identity ENABLE ROW LEVEL SECURITY;

-- Applicant may write their own name once; nobody may read through RLS.
DROP POLICY IF EXISTS "ai_insert_own" ON public.applicant_identity;
CREATE POLICY "ai_insert_own" ON public.applicant_identity
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.membership_applications a
      WHERE a.id = applicant_identity.application_id
        AND a.auth_user_id = auth.uid()
        AND a.status = 'pending'
    )
  );

CREATE TABLE IF NOT EXISTS public.application_access_log (
  id             bigserial   PRIMARY KEY,
  application_id uuid        NOT NULL REFERENCES public.membership_applications(id) ON DELETE CASCADE,
  viewer_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  field          text        NOT NULL,
  viewed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aal_application ON public.application_access_log(application_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_aal_viewer      ON public.application_access_log(viewer_id, viewed_at DESC);

ALTER TABLE public.application_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aal_staff_read" ON public.application_access_log;
CREATE POLICY "aal_staff_read" ON public.application_access_log
  FOR SELECT TO authenticated USING (public.is_roxy_staff());

-- The only way to read a legal name.
CREATE OR REPLACE FUNCTION public.reveal_applicant_legal_name(app_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE                                  -- writes the audit row; must not be inlined or skipped
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT public.can_review_application(app_id) THEN
    RAISE EXCEPTION 'not authorised to review this application'
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

REVOKE ALL ON FUNCTION public.reveal_applicant_legal_name(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reveal_applicant_legal_name(uuid) TO authenticated;

-- ── 10. Appeals ─────────────────────────────────────────────────────────────
-- Always-human review with no appeal means a wrongly-rejected woman has no
-- recourse. One appeal per rejection, resolved by staff rather than by the
-- community that rejected her.

CREATE TABLE IF NOT EXISTS public.application_appeals (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid        NOT NULL UNIQUE
                             REFERENCES public.membership_applications(id) ON DELETE CASCADE,
  reason         text        NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 2000),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolved_by    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  outcome        text        CHECK (outcome IN ('upheld','overturned'))
);

ALTER TABLE public.application_appeals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aa_own" ON public.application_appeals;
CREATE POLICY "aa_own" ON public.application_appeals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.membership_applications a
      WHERE a.id = application_appeals.application_id AND a.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "aa_insert_own" ON public.application_appeals;
CREATE POLICY "aa_insert_own" ON public.application_appeals
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.membership_applications a
      WHERE a.id = application_appeals.application_id
        AND a.auth_user_id = auth.uid()
        AND a.status = 'rejected'
    )
  );

DROP POLICY IF EXISTS "aa_staff" ON public.application_appeals;
CREATE POLICY "aa_staff" ON public.application_appeals
  FOR ALL TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff());

-- ── 11. Ongoing member safety ───────────────────────────────────────────────
-- Separate from applications: a safety rating has to outlive admission, and a
-- member flagged two years in never had an application row to hang it on.
-- Cross-community visibility is staff-only -- a flag is defamation-adjacent, and
-- a community admin has no business reading another community's judgement.

CREATE TABLE IF NOT EXISTS public.member_safety (
  user_id          uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  community_id     uuid        REFERENCES public.communities(id) ON DELETE SET NULL,
  safety_rating    integer     CHECK (safety_rating BETWEEN 1 AND 5),
  watchlist        boolean     NOT NULL DEFAULT false,
  watchlist_reason text        CHECK (
                                 (watchlist = false)
                                 OR (watchlist_reason IS NOT NULL
                                     AND char_length(btrim(watchlist_reason)) >= 10)
                               ),
  updated_by       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_safety_watchlist
  ON public.member_safety(community_id) WHERE watchlist = true;

ALTER TABLE public.member_safety ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ms_own_community" ON public.member_safety;
CREATE POLICY "ms_own_community" ON public.member_safety
  FOR ALL TO authenticated
  USING (
    community_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.community_members m
      JOIN public.profiles p ON p.id = auth.uid()
      LEFT JOIN public.reviewer_settings rs ON rs.user_id = auth.uid()
      WHERE m.community_id = member_safety.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
        AND p.vetting_status = 'approved'
        AND rs.reviewer_agreement_at IS NOT NULL
    )
  )
  WITH CHECK (
    community_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.community_members m
      JOIN public.profiles p ON p.id = auth.uid()
      LEFT JOIN public.reviewer_settings rs ON rs.user_id = auth.uid()
      WHERE m.community_id = member_safety.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
        AND p.vetting_status = 'approved'
        AND rs.reviewer_agreement_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "ms_staff" ON public.member_safety;
CREATE POLICY "ms_staff" ON public.member_safety
  FOR ALL TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff());

-- ── 12. border_patrol role ──────────────────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE public.community_members DROP CONSTRAINT IF EXISTS community_members_role_check;
  ALTER TABLE public.community_members
    ADD CONSTRAINT community_members_role_check
    CHECK (role IN ('member','moderator','admin','border_patrol'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_community_members_reviewers
  ON public.community_members(user_id) WHERE role IN ('admin','border_patrol');
