-- ============================================================
-- 078_community_role_management.sql
--
-- Roles could be created but never assigned.
--
-- create_community (067) makes its creator an admin atomically, and that is
-- the ONLY way anyone has ever become one. cm_insert_own restricts direct
-- inserts to role='member' -- correctly, since otherwise anyone could insert
-- themselves as admin anywhere -- and there is no UPDATE policy on
-- community_members at all. So a community's admin set is frozen at exactly
-- one person, forever.
--
-- 070 then added 'border_patrol' and made the application review queue require
-- admin OR border_patrol. That role has been unassignable since the day it
-- shipped, which means the overflow reviewer pool the gate design depends on
-- cannot be staffed.
--
-- Retry-safe: idempotent throughout.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.community_role_changes (
  id           bigserial   PRIMARY KEY,
  community_id uuid        NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  old_role     text,
  new_role     text        NOT NULL,
  changed_by   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_changes_community
  ON public.community_role_changes(community_id, changed_at DESC);

ALTER TABLE public.community_role_changes ENABLE ROW LEVEL SECURITY;

-- Who granted whom the ability to read applicants' legal names is exactly the
-- question an incident review asks first.
DROP POLICY IF EXISTS "crc_read_admin" ON public.community_role_changes;
CREATE POLICY "crc_read_admin" ON public.community_role_changes
  FOR SELECT TO authenticated
  USING (
    public.is_roxy_staff()
    OR EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = community_role_changes.community_id
        AND m.user_id = auth.uid()
        AND m.role IN ('admin','border_patrol')
    )
  );

/**
 * Change a member's role.
 *
 * SECURITY DEFINER because cm_insert_own/UPDATE deliberately forbid clients
 * from touching `role` directly -- this function is the single audited path,
 * and the checks below are the reason it is safe to have one.
 */
CREATE OR REPLACE FUNCTION public.set_community_role(
  p_community_id uuid,
  p_user_id      uuid,
  p_role         text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_old_role     text;
  v_caller_role  text;
  v_admin_count  integer;
  v_is_staff     boolean := public.is_roxy_staff();
BEGIN
  IF p_role NOT IN ('member','moderator','admin','border_patrol') THEN
    RAISE EXCEPTION 'invalid role %', p_role USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.community_members
  WHERE community_id = p_community_id AND user_id = auth.uid();

  -- Only an admin of THIS community, or Roxy staff. Note border_patrol is
  -- deliberately excluded: reviewing applicants is not the same authority as
  -- deciding who else gets to review applicants.
  IF NOT v_is_staff AND COALESCE(v_caller_role, '') <> 'admin' THEN
    RAISE EXCEPTION 'only a community admin can change roles'
      USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_old_role
  FROM public.community_members
  WHERE community_id = p_community_id AND user_id = p_user_id;

  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'that person is not a member of this community'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_old_role = p_role THEN
    RETURN;                                   -- idempotent, not an error
  END IF;

  -- Lockout protection. Demoting the last admin orphans the community: nobody
  -- can issue invite codes, review applicants, or ever restore an admin,
  -- because this very function requires one.
  IF v_old_role = 'admin' AND p_role <> 'admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.community_members
    WHERE community_id = p_community_id AND role = 'admin';

    IF v_admin_count <= 1 AND NOT v_is_staff THEN
      RAISE EXCEPTION 'a community must keep at least one admin -- promote someone else first'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The two roles are held to different bars, because they are for different
  -- things.
  --
  -- border_patrol exists ONLY to review applicants, which means reading legal
  -- names and identity outcomes. It requires 'approved' with no grandfather
  -- clause: can_review_application (070) already refuses anyone who is not
  -- approved, so granting this to an unvetted member produces a role that
  -- cannot do its job while still conferring invite-code and code-request
  -- access. That is strictly a liability.
  IF p_role = 'border_patrol' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND vetting_status = 'approved'
    ) THEN
      RAISE EXCEPTION 'border patrol reviews applicants -- that member must complete verification first'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- admin is an organiser role that predates the gate. 'unvetted' is allowed
  -- deliberately: it is the entire grandfathered population, every existing
  -- community creator is in it, and refusing them would leave every community
  -- unable to appoint a second admin -- the exact frozen admin set this
  -- migration exists to unfreeze. 'pending' and 'rejected' are still refused.
  -- An unvetted admin still cannot read applicant data: can_review_application
  -- gates that on 'approved' plus a signed agreement, independently of role.
  IF p_role = 'admin' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND vetting_status IN ('approved','unvetted')
    ) THEN
      RAISE EXCEPTION 'that member cannot be made an admin while their own account is unverified'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.community_members
  SET role = p_role
  WHERE community_id = p_community_id AND user_id = p_user_id;

  INSERT INTO public.community_role_changes
    (community_id, user_id, old_role, new_role, changed_by)
  VALUES (p_community_id, p_user_id, v_old_role, p_role, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_community_role(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.set_community_role(uuid, uuid, text) IS
  'Single audited path for changing a community role. Admin-or-staff only, refuses to demote the last admin, and refuses to grant reviewer roles to unvetted members.';

-- ── Transferring a community ────────────────────────────────────────────────
-- Distinct from set_community_role because it is one transaction: promote the
-- new admin, then step down. Done as two calls, the last-admin guard correctly
-- blocks the second one and the caller is stuck as admin of a community she
-- meant to hand over.

CREATE OR REPLACE FUNCTION public.transfer_community_admin(
  p_community_id uuid,
  p_to_user_id   uuid,
  p_step_down    boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
BEGIN
  PERFORM public.set_community_role(p_community_id, p_to_user_id, 'admin');

  IF p_step_down THEN
    -- Safe now: the promotion above means there are at least two admins, so
    -- the last-admin guard passes.
    PERFORM public.set_community_role(p_community_id, auth.uid(), 'member');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_community_admin(uuid, uuid, boolean) TO authenticated;
