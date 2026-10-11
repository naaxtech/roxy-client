-- Down for 134_gate_followups.sql. Restores the 129–133 state: 130's gate
-- functions and invite-code policies, 131's suspension functions, the
-- notification types without 'application_decided'.
-- Data that cannot come back: codes keep max_uses = 1 (their old limits are
-- not recorded), redeemed_by/redeemed_at are dropped, application_decided
-- notifications are deleted, erased accounts stay erased.
-- destructive-ok: reversal of 134 only.

-- ── 5. purge ──
DROP FUNCTION IF EXISTS public.mark_account_storage_cleared();
DROP FUNCTION IF EXISTS public.account_purge_storage_batch(integer);
DROP FUNCTION IF EXISTS public.purge_deleted_accounts();
DROP TABLE IF EXISTS public.account_purges;

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


-- ── 4. invite codes ──
DROP FUNCTION IF EXISTS public.invite_code_ledger(uuid, integer);
DROP POLICY IF EXISTS ic_read_minter ON public.invite_codes;
DROP POLICY IF EXISTS ic_update_minter ON public.invite_codes;
DROP POLICY IF EXISTS ic_insert_minter ON public.invite_codes;
DROP TRIGGER IF EXISTS trg_invite_codes_single_redemption ON public.invite_codes;
DROP FUNCTION IF EXISTS public.invite_codes_single_redemption();
DROP TRIGGER IF EXISTS trg_invite_codes_enforce_cap ON public.invite_codes;
DROP FUNCTION IF EXISTS public.invite_codes_enforce_cap();

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

DROP FUNCTION IF EXISTS public.can_mint_invite_for(uuid);
ALTER TABLE public.gate_settings DROP COLUMN IF EXISTS admin_open_code_cap;
ALTER TABLE public.invite_codes DROP CONSTRAINT IF EXISTS invite_codes_single_use;
ALTER TABLE public.invite_codes ALTER COLUMN max_uses DROP NOT NULL;
ALTER TABLE public.invite_codes ALTER COLUMN max_uses DROP DEFAULT;
DROP INDEX IF EXISTS public.invite_codes_created_by_idx;
ALTER TABLE public.invite_codes DROP COLUMN IF EXISTS redeemed_at;
ALTER TABLE public.invite_codes DROP COLUMN IF EXISTS redeemed_by;

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


-- ── 3. application_decided ──
DROP TRIGGER IF EXISTS trg_notify_appeal_upheld ON public.application_appeals;
DROP FUNCTION IF EXISTS public.notify_on_appeal_upheld();
DROP TRIGGER IF EXISTS trg_notify_application_status ON public.membership_applications;
DROP FUNCTION IF EXISTS public.notify_on_application_status();
DROP FUNCTION IF EXISTS public.notify_application_decided(uuid, boolean);
DELETE FROM public.notifications WHERE type = 'application_decided';
DO $$
DECLARE
  v_def   text;
  v_types text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_types
  FROM (
    SELECT btrim(x, ' "') AS t
    FROM regexp_matches(COALESCE(v_def, ''), '''([^'']*)''', 'g') AS m(lit),
         LATERAL regexp_split_to_table(translate(m.lit[1], '{}', ''), ',') AS x
  ) s
  WHERE t ~ '^[a-z_]+$' AND t <> 'application_decided';
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))',
    v_types
  );
END $$;

-- ── 2. membership ──

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


-- ── 1. suspension end date ──
DROP FUNCTION IF EXISTS public.suspend_member(uuid, text, timestamptz);

CREATE OR REPLACE FUNCTION public.suspend_member(p_user_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_staff  boolean;
  v_id     uuid;
BEGIN
  IF v_me IS NULL OR NOT public.is_roxy_staff() THEN
    RAISE EXCEPTION 'Only Roxy staff can suspend a member' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Which member?' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_me THEN
    RAISE EXCEPTION 'You cannot suspend yourself' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) < 3 OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Give a reason (3 to 2000 characters)' USING ERRCODE = '22023';
  END IF;

  SELECT p.is_staff INTO v_staff FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(v_staff, false) AND NOT public.is_roxy_core() THEN
    RAISE EXCEPTION 'Only core staff can suspend a staff member' USING ERRCODE = '42501';
  END IF;
  IF public.is_suspended(p_user_id) THEN
    RAISE EXCEPTION 'This member is already suspended' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.account_suspensions (user_id, reason, suspended_by)
  VALUES (p_user_id, v_reason, v_me)
  RETURNING id INTO v_id;

  -- No new tokens: banned auth user, every session and refresh token gone.
  UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = p_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;

  PERFORM public.staff_audit('member_suspended', 'profile', p_user_id,
    jsonb_build_object('suspension_id', v_id, 'reason', v_reason));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.suspend_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suspend_member(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_suspended(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_suspensions s
    WHERE s.user_id = p_user_id AND s.lifted_at IS NULL
  );
$$;
-- Callable by members so gate's is_approved_member() (SECURITY DEFINER) and
-- RLS expressions can use it; it answers only "is this id suspended", which
-- staff tooling shows anyway and a member learns from the account itself.
REVOKE ALL ON FUNCTION public.is_suspended(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_suspended(uuid) TO authenticated, service_role;

ALTER TABLE public.account_suspensions DROP CONSTRAINT IF EXISTS account_suspensions_until_after_start;
ALTER TABLE public.account_suspensions DROP COLUMN IF EXISTS suspended_until;
