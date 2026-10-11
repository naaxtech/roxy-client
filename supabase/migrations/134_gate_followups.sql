-- 134 — Gate follow-ups: suspension reaches the gate, decisions reach her
-- phone, every code admits exactly one woman, deleted accounts are erased.
--
-- Applies on top of 129 + 130 (gate) + 131 (ops) + 132 (chat) + 133 (feed).
-- It needs 131's account_suspensions / is_suspended / suspend_member and
-- reads whatever notification types 129–133 allowed.
--
-- What was broken:
--   * A suspended member's access token stays valid for up to an hour, and
--     is_approved_member() never asked whether she was suspended, so RLS kept
--     treating her as a member until the token expired (cross-lane SB-08).
--   * Studio lets staff suspend "until a date"; 131's suspend_member() has no
--     end date, so the call failed and nothing was suspended (ops2 request).
--   * The approval/rejection reached her by email only; the waiting room
--     promised a push that never came, because notifications refused any type
--     but chat/friends/events (G-11).
--   * Codes could admit up to 25 people each, community admins could only
--     mint after being granted reviewer, and nobody could see afterwards who
--     used which code (Nicole, 2026-10-11). A store review code approved
--     itself, which no other path can.
--   * Accounts deleted through gdpr-delete were soft-deleted forever: the
--     "hard delete after 30 days" job was never written (G-16).
--
-- The model after this migration:
--   * Membership = approved AND not deleted AND not suspended. A suspension
--     may carry an end date; it ends on its own (no job), is_suspended() is
--     simply false after it.
--   * A decision on her application (approve, reject, appeal upheld) inserts
--     one 'application_decided' notification, which push_outbox delivers in
--     the 'membership' category. Lock screen copy without previews: "There's
--     news about your membership" — never "rejected", never a community.
--   * Invite codes: minted by Roxy staff (uncapped) or by an approved,
--     unsuspended admin/owner of the code's community (at most
--     gate_settings.admin_open_code_cap unused codes, default 10). Every code
--     has max_uses = 1 and records redeemed_by / redeemed_at; the database
--     refuses a second redemption whatever path writes it. Minting never
--     approves anyone: every application, including a store reviewer's, goes
--     to review.
--   * purge_deleted_accounts() hard-deletes the auth user of every profile
--     deleted more than 30 days ago (cascading her rows), records the id in
--     account_purges, and wakes purge-account-storage, which deletes her files
--     through the Storage API (direct DELETE on storage.objects is refused by
--     Supabase's protect_delete trigger and would leave the bytes behind).
--
-- Down: supabase/downs/134_gate_followups_down.sql

-- ── 1. Suspension with an end date (ops2 request) ──────────────────────────
ALTER TABLE public.account_suspensions
  ADD COLUMN IF NOT EXISTS suspended_until timestamptz;
ALTER TABLE public.account_suspensions DROP CONSTRAINT IF EXISTS account_suspensions_until_after_start;
ALTER TABLE public.account_suspensions ADD CONSTRAINT account_suspensions_until_after_start
  CHECK (suspended_until IS NULL OR suspended_until > suspended_at);

-- Active = not lifted by staff AND (no end date, or the end date is ahead).
CREATE OR REPLACE FUNCTION public.is_suspended(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_suspensions s
    WHERE s.user_id = p_user_id
      AND s.lifted_at IS NULL
      AND (s.suspended_until IS NULL OR s.suspended_until > now())
  );
$$;
REVOKE ALL ON FUNCTION public.is_suspended(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_suspended(uuid) TO authenticated, service_role;

-- Same rules as 131, plus p_until. A suspension whose end date has passed is
-- still the "active" row for the one-active-per-member index (lifted_at IS
-- NULL), so it is closed here before a new one is written.
DROP FUNCTION IF EXISTS public.suspend_member(uuid, text);
CREATE OR REPLACE FUNCTION public.suspend_member(p_user_id uuid, p_reason text,
                                                 p_until timestamptz DEFAULT NULL)
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
  IF p_until IS NOT NULL AND p_until <= now() THEN
    RAISE EXCEPTION 'The end date has to be in the future' USING ERRCODE = '22023';
  END IF;
  IF p_until IS NOT NULL AND p_until > now() + interval '5 years' THEN
    RAISE EXCEPTION 'Pick an end date within five years, or leave it blank' USING ERRCODE = '22023';
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

  -- An earlier suspension that ran out on its date: close it as ended.
  UPDATE public.account_suspensions
  SET lifted_at = greatest(suspended_until, suspended_at), lift_note = coalesce(lift_note, 'Ended on its date')
  WHERE user_id = p_user_id AND lifted_at IS NULL
    AND suspended_until IS NOT NULL AND suspended_until <= now();

  INSERT INTO public.account_suspensions (user_id, reason, suspended_by, suspended_until)
  VALUES (p_user_id, v_reason, v_me, p_until)
  RETURNING id INTO v_id;

  -- No new tokens until the end date (or ever): banned auth user, every
  -- session and refresh token gone. GoTrue lifts the ban by itself when
  -- banned_until passes.
  UPDATE auth.users SET banned_until = coalesce(p_until, now() + interval '100 years') WHERE id = p_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;

  PERFORM public.staff_audit('member_suspended', 'profile', p_user_id,
    jsonb_build_object('suspension_id', v_id, 'reason', v_reason, 'until', p_until));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.suspend_member(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suspend_member(uuid, text, timestamptz) TO authenticated;

-- ── 2. Membership = approved, not deleted, not suspended (SB-08) ───────────
-- A suspended member's token stays valid for up to an hour after
-- suspend_member() kills her sessions. Every policy that asks "is she a
-- member" goes through these two, so she is out from the next request.
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
  )
  AND NOT public.is_suspended(auth.uid());
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
  )
  AND NOT public.is_suspended(p_user_id);
$$;

-- ── 3. The decision reaches her phone (G-11) ───────────────────────────────
-- The type list is merged with whatever 126–133 allowed, so nothing another
-- lane added is dropped. pg_get_constraintdef prints the list either as
-- ARRAY['a'::text, ...] (126/128) or as '{a,b}'::text[] (after 133's rebuild);
-- every quoted literal is split on braces and commas so both forms parse.
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
    UNION
    SELECT 'application_decided'
  ) s
  WHERE t ~ '^[a-z_]+$';

  IF NOT ('message' = ANY (v_types)) THEN
    RAISE EXCEPTION '134: could not read the existing notification types from %', v_def;
  END IF;

  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))',
    v_types
  );
END $$;

-- Her switch for membership news, ON by default like every type (Nicole,
-- 2026-10-04). push-dispatch reads it as `membership`; absent means ON.
ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS membership boolean NOT NULL DEFAULT true;

-- One in-app row per decision. The words are for inside the app (and for a
-- lock screen only if she turned previews on): "rejected" is never on a lock
-- screen, and no community is ever named. Never fails the decision.
CREATE OR REPLACE FUNCTION public.notify_application_decided(p_user_id uuid, p_approved boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND deleted_at IS NULL) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
  VALUES (
    p_user_id, NULL, 'application_decided',
    CASE WHEN p_approved THEN 'You''re in 💜' ELSE 'About your membership' END,
    CASE WHEN p_approved THEN 'Your membership was approved. Welcome to Roxy.'
         ELSE 'There''s an update on your application. Open Roxy to read it.' END,
    CASE WHEN p_approved THEN '/welcome-in' ELSE '/pending' END
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_application_decided failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_application_decided(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_on_application_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected') THEN
    PERFORM public.notify_application_decided(NEW.auth_user_id, NEW.status = 'approved');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_on_application_status failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_on_application_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_application_status ON public.membership_applications;
CREATE TRIGGER trg_notify_application_status
  AFTER UPDATE OF status ON public.membership_applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_application_status();

-- An upheld appeal changes no status, so it has its own trigger. An
-- overturned one is an approval and is covered by the status trigger.
CREATE OR REPLACE FUNCTION public.notify_on_appeal_upheld()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.outcome = 'upheld' AND OLD.outcome IS DISTINCT FROM 'upheld' THEN
    PERFORM public.notify_application_decided(
      (SELECT a.auth_user_id FROM public.membership_applications a WHERE a.id = NEW.application_id), false);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_on_appeal_upheld failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_on_appeal_upheld() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_appeal_upheld ON public.application_appeals;
CREATE TRIGGER trg_notify_appeal_upheld
  AFTER UPDATE OF outcome ON public.application_appeals
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_appeal_upheld();

-- ── 4. Invite codes: one code, one woman, a name on both ends ──────────────
ALTER TABLE public.invite_codes
  ADD COLUMN IF NOT EXISTS redeemed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redeemed_at timestamptz;
CREATE INDEX IF NOT EXISTS invite_codes_created_by_idx ON public.invite_codes (created_by, created_at DESC);

-- Who used each code so far: the earliest application on it (prod has one
-- code, used once, when this was written).
UPDATE public.invite_codes c
SET redeemed_by = first_use.auth_user_id,
    redeemed_at = first_use.at
FROM (
  SELECT DISTINCT ON (a.code_id) a.code_id, a.auth_user_id, a.submitted_at AS at
  FROM public.membership_applications a
  WHERE a.code_id IS NOT NULL
  ORDER BY a.code_id, a.submitted_at NULLS LAST
) first_use
WHERE c.id = first_use.code_id AND c.redeemed_by IS NULL;

-- Single use, always. A multi-use code becomes single-use: unused, it admits
-- one more woman; used, it is exhausted (uses_count >= 1). Prod had one code,
-- already single-use, when this was written.
UPDATE public.invite_codes SET max_uses = 1 WHERE max_uses IS DISTINCT FROM 1;
ALTER TABLE public.invite_codes ALTER COLUMN max_uses SET DEFAULT 1;
ALTER TABLE public.invite_codes ALTER COLUMN max_uses SET NOT NULL;
ALTER TABLE public.invite_codes DROP CONSTRAINT IF EXISTS invite_codes_single_use;
ALTER TABLE public.invite_codes ADD CONSTRAINT invite_codes_single_use
  CHECK (max_uses = 1);

ALTER TABLE public.gate_settings
  ADD COLUMN IF NOT EXISTS admin_open_code_cap integer NOT NULL DEFAULT 10
    CHECK (admin_open_code_cap BETWEEN 0 AND 1000);

-- Who may mint for a community: Roxy staff, or an admin/owner of THAT
-- community — and in both cases an approved, not deleted, not suspended
-- member (is_approved_member() since section 2).
CREATE OR REPLACE FUNCTION public.can_mint_invite_for(p_community_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_community_id IS NOT NULL
     AND public.is_approved_member()
     AND (
       public.is_roxy_staff()
       OR EXISTS (
         SELECT 1 FROM public.community_members m
         WHERE m.community_id = p_community_id
           AND m.user_id = auth.uid()
           AND m.role = 'admin'
       )
       OR EXISTS (
         SELECT 1 FROM public.communities c
         WHERE c.id = p_community_id AND c.created_by = auth.uid()
       )
     );
$$;
REVOKE ALL ON FUNCTION public.can_mint_invite_for(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_mint_invite_for(uuid) TO authenticated;

-- "May I mint one more?" for the Studio form: staff always; an admin while
-- she has fewer unused codes than the cap.
CREATE OR REPLACE FUNCTION public.invite_code_quota_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_roxy_staff()
      OR (SELECT count(*) FROM public.invite_codes
          WHERE created_by = auth.uid()
            AND NOT is_member_code
            AND NOT is_review_code
            AND redeemed_by IS NULL
            AND uses_count = 0
            AND revoked_at IS NULL
            AND locked_at IS NULL
            AND (expires_at IS NULL OR expires_at > now()))
         < (SELECT admin_open_code_cap FROM public.gate_settings WHERE id);
$$;
REVOKE ALL ON FUNCTION public.invite_code_quota_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_code_quota_ok() TO authenticated;

-- The cap is enforced on the row, after insert, so a batch insert of 30 by an
-- admin with a cap of 10 fails as a whole instead of slipping past a policy
-- that only sees the table as it was before the statement.
CREATE OR REPLACE FUNCTION public.invite_codes_enforce_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap  integer;
  v_open integer;
BEGIN
  IF NEW.is_member_code OR NEW.is_review_code OR NEW.created_by IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.created_by AND is_staff) THEN
    RETURN NULL;                                  -- staff are uncapped
  END IF;
  SELECT admin_open_code_cap INTO v_cap FROM public.gate_settings WHERE id;
  SELECT count(*) INTO v_open FROM public.invite_codes
  WHERE created_by = NEW.created_by
    AND NOT is_member_code
    AND NOT is_review_code
    AND redeemed_by IS NULL
    AND uses_count = 0
    AND revoked_at IS NULL
    AND locked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());
  IF v_open > coalesce(v_cap, 10) THEN
    RAISE EXCEPTION 'You already have % unused codes. Revoke one, or wait until one is used.', coalesce(v_cap, 10)
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.invite_codes_enforce_cap() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_invite_codes_enforce_cap ON public.invite_codes;
CREATE TRIGGER trg_invite_codes_enforce_cap
  AFTER INSERT ON public.invite_codes
  FOR EACH ROW EXECUTE FUNCTION public.invite_codes_enforce_cap();

-- One redemption per code, whatever writes it — SECURITY DEFINER code
-- included. The only change to redeemed_by after it is set is the FK's own
-- SET NULL when that account is hard-deleted. A revoked code stays revoked
-- (otherwise revoke + un-revoke would walk around the cap): mint a new one.
CREATE OR REPLACE FUNCTION public.invite_codes_single_redemption()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.uses_count > OLD.uses_count AND (OLD.redeemed_by IS NOT NULL OR NEW.uses_count > 1) THEN
    RAISE EXCEPTION 'This code has already been used' USING ERRCODE = '23505';
  END IF;
  IF OLD.redeemed_by IS NOT NULL AND NEW.redeemed_by IS DISTINCT FROM OLD.redeemed_by
     AND NOT (NEW.redeemed_by IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.redeemed_by)) THEN
    RAISE EXCEPTION 'Who used a code cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'A revoked code stays revoked. Create a new one.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.invite_codes_single_redemption() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_invite_codes_single_redemption ON public.invite_codes;
CREATE TRIGGER trg_invite_codes_single_redemption
  BEFORE UPDATE ON public.invite_codes
  FOR EACH ROW EXECUTE FUNCTION public.invite_codes_single_redemption();

DROP POLICY IF EXISTS ic_insert_reviewer ON public.invite_codes;
DROP POLICY IF EXISTS ic_insert_minter ON public.invite_codes;
CREATE POLICY ic_insert_minter ON public.invite_codes
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND is_review_code = false
    AND is_member_code = false
    AND max_uses = 1
    AND public.can_mint_invite_for(community_id)
  );

DROP POLICY IF EXISTS ic_update_reviewer ON public.invite_codes;
DROP POLICY IF EXISTS ic_update_minter ON public.invite_codes;
-- Staff manage every code; an admin manages the codes she minted.
CREATE POLICY ic_update_minter ON public.invite_codes
  FOR UPDATE TO authenticated
  USING (
    is_review_code = false AND is_member_code = false
    AND public.can_mint_invite_for(community_id)
    AND (created_by = auth.uid() OR public.is_roxy_staff())
  )
  WITH CHECK (
    is_review_code = false AND is_member_code = false
    AND max_uses = 1
    AND public.can_mint_invite_for(community_id)
    AND (created_by = auth.uid() OR public.is_roxy_staff())
  );

-- Admins see their community's codes (to copy and revoke them); staff keep
-- ic_read_staff; reviewers keep ic_read_reviewer.
DROP POLICY IF EXISTS ic_read_minter ON public.invite_codes;
CREATE POLICY ic_read_minter ON public.invite_codes
  FOR SELECT TO authenticated
  USING (public.can_mint_invite_for(community_id));

-- Redemption: 130's rules, plus the code records who used it, and a store
-- review code no longer approves itself (Nicole: minting never approves
-- anyone; the reviewer account is approved in Studio, docs/ops/store-review-account.md).
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

  -- The row lock is the fix for the race: a second redemption of a code
  -- waits here, then sees it already redeemed.
  SELECT * INTO v_code FROM public.invite_codes WHERE code = v_norm FOR UPDATE;

  v_reason := CASE
    WHEN v_code.id IS NULL                                        THEN 'invalid'
    WHEN v_code.revoked_at IS NOT NULL                            THEN 'revoked'
    WHEN v_code.locked_at IS NOT NULL                             THEN 'locked'
    WHEN v_code.expires_at IS NOT NULL AND v_code.expires_at < now() THEN 'expired'
    WHEN v_code.redeemed_by IS NOT NULL                           THEN 'exhausted'
    WHEN v_code.uses_count >= COALESCE(v_code.max_uses, 1)        THEN 'exhausted'
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

  UPDATE public.invite_codes
  SET uses_count  = uses_count + 1,
      redeemed_by = v_uid,
      redeemed_at = now()
  WHERE id = v_code.id;

  UPDATE public.profiles
  SET vetting_status = 'pending', admitted_via_code_id = v_code.id
  WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'application_id', v_app,
                            'community_id', v_code.community_id,
                            'approved', false);
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;

-- Store review codes are single-use like every other code.
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
  IF NOT public.is_roxy_core() OR NOT public.is_approved_member() THEN
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
  VALUES (v_community, auth.uid(), left(btrim(p_label), 80), 1,
          now() + make_interval(days => LEAST(GREATEST(p_days, 1), 90)), true)
  RETURNING code INTO v_code;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.mint_review_code(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mint_review_code(text, integer) TO authenticated;

-- Accountability, per code: who minted it, who used it and when, where she is
-- now (membership status) and when she last signed in. Staff see every code;
-- an admin sees the codes she minted. Last sign-in is to the day for admins
-- (enough to see a dormant account, not her routine), exact for staff.
CREATE OR REPLACE FUNCTION public.invite_code_ledger(p_community_id uuid DEFAULT NULL,
                                                     p_limit integer DEFAULT 200)
RETURNS TABLE (
  code_id           uuid,
  code              text,
  community_id      uuid,
  community_name    text,
  label             text,
  kind              text,
  created_at        timestamptz,
  expires_at        timestamptz,
  revoked_at        timestamptz,
  locked_at         timestamptz,
  minted_by         uuid,
  minter_name       text,
  minter_username   text,
  redeemed_by       uuid,
  redeemer_name     text,
  redeemer_username text,
  redeemed_at       timestamptz,
  redeemer_status   text,
  redeemer_last_sign_in timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_staff boolean := public.is_roxy_staff();
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'Members only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.id, c.code, c.community_id, cm.name::text, c.label,
         CASE WHEN c.is_review_code THEN 'review'
              WHEN c.is_member_code THEN 'member'
              ELSE 'invite' END,
         c.created_at, c.expires_at, c.revoked_at, c.locked_at,
         c.created_by, mp.display_name::text, mp.username::text,
         c.redeemed_by, rp.display_name::text, rp.username::text,
         c.redeemed_at,
         CASE
           WHEN c.redeemed_by IS NULL AND c.uses_count > 0 THEN 'account_deleted'
           WHEN c.redeemed_by IS NULL THEN NULL
           WHEN rp.deleted_at IS NOT NULL THEN 'deleted'
           WHEN public.is_suspended(c.redeemed_by) THEN 'suspended'
           ELSE rp.vetting_status::text
         END,
         CASE WHEN v_staff THEN u.last_sign_in_at
              ELSE date_trunc('day', u.last_sign_in_at) END
  FROM public.invite_codes c
  LEFT JOIN public.communities cm ON cm.id = c.community_id
  LEFT JOIN public.profiles mp ON mp.id = c.created_by
  LEFT JOIN public.profiles rp ON rp.id = c.redeemed_by
  LEFT JOIN auth.users u ON u.id = c.redeemed_by
  WHERE (v_staff OR c.created_by = auth.uid())
    AND (p_community_id IS NULL OR c.community_id = p_community_id)
  ORDER BY c.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 200), 1), 1000);
END $$;
REVOKE ALL ON FUNCTION public.invite_code_ledger(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_code_ledger(uuid, integer) TO authenticated;

-- ── 5. Deleted accounts are erased after 30 days (G-16) ────────────────────
-- 130's append-only trigger refused EVERY update, including the ones Postgres
-- itself makes when a referenced row goes: application_id SET NULL when the
-- applicant purge deletes a rejected application, decided_by SET NULL when a
-- reviewer's account is erased. Both purges would have failed on the first
-- row with a decision. Those two nullings, and only them, are allowed.
CREATE OR REPLACE FUNCTION public.application_decisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id = OLD.id
     AND NEW.subject_user_id = OLD.subject_user_id
     AND NEW.decision = OLD.decision
     AND NEW.reason_category IS NOT DISTINCT FROM OLD.reason_category
     AND NEW.note IS NOT DISTINCT FROM OLD.note
     AND NEW.decided_at = OLD.decided_at
     AND (NEW.application_id IS NOT DISTINCT FROM OLD.application_id
          OR (NEW.application_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.membership_applications WHERE id = OLD.application_id)))
     AND (NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by
          OR (NEW.decided_by IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.decided_by)))
     AND (NEW.application_id IS DISTINCT FROM OLD.application_id
          OR NEW.decided_by IS DISTINCT FROM OLD.decided_by) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'application_decisions is append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.application_decisions_append_only() FROM PUBLIC, anon, authenticated;

-- account_purges keeps only the id of an erased account (no FK: the account
-- is gone) so her files can be found by the path and owner they still carry.
-- Service-only.
CREATE TABLE IF NOT EXISTS public.account_purges (
  user_id            uuid PRIMARY KEY,
  deleted_at         timestamptz NOT NULL,
  purged_at          timestamptz NOT NULL DEFAULT now(),
  storage_cleared_at timestamptz
);
ALTER TABLE public.account_purges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_purges FROM PUBLIC, anon, authenticated;

-- Hard-delete every account soft-deleted (gdpr-delete) more than 30 days ago.
-- Deleting the auth user cascades to her profile and everything keyed on it.
-- Accounts with money records (orders, payment logs) are kept: those are
-- retained for accounting and are already stripped of her profile details.
-- One account failing never stops the others. Logs carry counts only.
CREATE OR REPLACE FUNCTION public.purge_deleted_accounts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r          record;
  v_due      integer := 0;
  v_deleted  integer := 0;
  v_kept     integer := 0;
  v_failed   integer := 0;
  v_wake     bigint;
BEGIN
  FOR r IN
    SELECT p.id, p.deleted_at FROM public.profiles p
    WHERE p.deleted_at IS NOT NULL AND p.deleted_at < now() - interval '30 days'
    ORDER BY p.deleted_at
    LIMIT 200
  LOOP
    v_due := v_due + 1;
    IF EXISTS (SELECT 1 FROM public.orders o WHERE o.buyer_id = r.id)
       OR EXISTS (SELECT 1 FROM public.payment_logs l WHERE l.buyer_id = r.id OR l.host_id = r.id) THEN
      v_kept := v_kept + 1;
      CONTINUE;
    END IF;
    BEGIN
      -- References that would otherwise block the delete (NO ACTION FKs).
      DELETE FROM public.email_queue WHERE recipient_user_id = r.id;
      DELETE FROM public.carts WHERE buyer_id = r.id;
      UPDATE public.events SET cancelled_by = NULL WHERE cancelled_by = r.id;
      UPDATE public.platform_settings SET updated_by = NULL WHERE updated_by = r.id;

      INSERT INTO public.account_purges (user_id, deleted_at)
      VALUES (r.id, r.deleted_at)
      ON CONFLICT (user_id) DO UPDATE SET purged_at = now(), storage_cleared_at = NULL;

      DELETE FROM auth.users WHERE id = r.id;
      IF NOT FOUND THEN
        DELETE FROM public.profiles WHERE id = r.id;   -- a profile with no auth user
      END IF;
      v_deleted := v_deleted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'purge_deleted_accounts: one account kept (%)', SQLSTATE;
    END;
  END LOOP;

  -- Her files go through the Storage API (purge-account-storage). Quiet when
  -- 131's ops_invoke_edge or its Vault secrets are absent; the next run wakes it.
  IF EXISTS (SELECT 1 FROM public.account_purges WHERE storage_cleared_at IS NULL)
     AND to_regprocedure('public.ops_invoke_edge(text,jsonb)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT public.ops_invoke_edge($1, $2)' INTO v_wake
        USING 'purge-account-storage', '{}'::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'purge_deleted_accounts: storage wake failed (%)', SQLSTATE;
    END;
  END IF;

  RETURN jsonb_build_object('due', v_due, 'deleted', v_deleted, 'kept_for_money_records', v_kept,
                            'failed', v_failed, 'storage_woken', v_wake IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.purge_deleted_accounts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_deleted_accounts() TO service_role;

-- The files of erased accounts still in storage: owned by her, or under her
-- id in a bucket whose policy keys the first path segment on the uploader.
CREATE OR REPLACE FUNCTION public.account_purge_storage_batch(p_limit integer DEFAULT 500)
RETURNS TABLE (bucket_id text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.bucket_id::text, o.name::text
  FROM storage.objects o
  JOIN public.account_purges ap ON ap.storage_cleared_at IS NULL
   AND (o.owner_id = ap.user_id::text
        OR o.owner = ap.user_id
        OR (o.bucket_id IN ('avatars', 'profile-photos', 'post-media')
            AND split_part(o.name, '/', 1) = ap.user_id::text))
  ORDER BY o.bucket_id, o.name
  LIMIT least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;
REVOKE ALL ON FUNCTION public.account_purge_storage_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_purge_storage_batch(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_account_storage_cleared()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.account_purges ap
  SET storage_cleared_at = now()
  WHERE ap.storage_cleared_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.owner_id = ap.user_id::text
         OR o.owner = ap.user_id
         OR (o.bucket_id IN ('avatars', 'profile-photos', 'post-media')
             AND split_part(o.name, '/', 1) = ap.user_id::text)
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.mark_account_storage_cleared() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_account_storage_cleared() TO service_role;
