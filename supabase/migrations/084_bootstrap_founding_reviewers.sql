-- ============================================================
-- 084_bootstrap_founding_reviewers.sql
--
-- The gate cannot admit its first member.
--
-- can_review_application (070:289) requires the REVIEWER's own
-- profiles.vetting_status = 'approved'. The only writer of 'approved' is
-- _apply_decision (071), which only runs when an existing reviewer decides a
-- mobile application. So: no approved member exists, therefore no reviewer
-- exists, therefore no application can ever be decided, therefore no approved
-- member is ever created. A founder can mint invite codes in the studio all
-- day and never be permitted to review the applications they produce.
--
-- This is a bootstrap problem, not a security hole, and it needs exactly one
-- seed of trust from outside the loop.
--
-- WHY is_staff IS THE RIGHT SEED, and why this grants nothing new:
-- is_roxy_staff() (069:94) already opens posts_select_staff, ic_read_staff,
-- ca_staff, aal_staff_read, aa_staff, ms_staff, vc_staff, pa_staff,
-- ce_read_staff, cr_read_staff and gs_write. A staff account can already read
-- every applicant record in the system. Marking it 'approved' is strictly
-- weaker than what it holds today -- it lets that same person be *held to* the
-- reviewer rules (approved + signed agreement) rather than bypassing them.
--
-- is_staff itself is not client-writable: 080 revoked UPDATE on profiles from
-- `authenticated` and granted only a column allowlist that deliberately
-- excludes is_staff and vetting_status. It can only be set by the service role,
-- i.e. by a human with the project keys. That is the out-of-band trust anchor.
--
-- Deliberately NOT done here: signing the reviewer agreement. That is a
-- confidentiality undertaking about handling other women's legal names, and a
-- migration must not tick that box on a person's behalf. Each founding
-- reviewer accepts it herself in roxy-studio, which has the UI for it.
--
-- Retry-safe and self-limiting: only ever promotes 'unvetted', so a later
-- 'rejected' or 'pending' decision is never silently overturned by a re-run.
-- ============================================================

DO $$
DECLARE
  v_promoted integer;
BEGIN
  UPDATE public.profiles
  SET vetting_status = 'approved',
      admitted_at    = COALESCE(admitted_at, now())
  WHERE is_staff = true
    AND vetting_status = 'unvetted';

  GET DIAGNOSTICS v_promoted = ROW_COUNT;

  IF v_promoted = 0 THEN
    -- Not an error on a re-run, but on a FIRST run it means there is no staff
    -- account yet and the gate still has no way to admit anyone. Say so loudly
    -- rather than finishing silently and leaving someone to discover it when
    -- the review queue refuses to open.
    RAISE NOTICE
      'No staff profile was promoted. If this is the first run, set is_staff on a founding account (service role only) and re-apply, or the application queue cannot be reviewed by anyone.';
  ELSE
    RAISE NOTICE 'Promoted % staff profile(s) to approved. Each must still sign the reviewer agreement in roxy-studio.', v_promoted;
  END IF;
END;
$$;

-- Keeps the loop closed as the team grows: a founder marked is_staff after
-- this migration is applied gets the same seed automatically, without needing
-- another migration or a hand-written UPDATE.
CREATE OR REPLACE FUNCTION public.approve_on_staff_grant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_staff = true AND COALESCE(OLD.is_staff, false) = false
     AND NEW.vetting_status = 'unvetted' THEN
    NEW.vetting_status := 'approved';
    NEW.admitted_at    := COALESCE(NEW.admitted_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approve_on_staff_grant ON public.profiles;
CREATE TRIGGER trg_approve_on_staff_grant
  BEFORE UPDATE OF is_staff ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.approve_on_staff_grant();
