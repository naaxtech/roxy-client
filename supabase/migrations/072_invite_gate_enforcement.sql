-- ============================================================
-- 072_invite_gate_enforcement.sql
--
-- Turns the gate on, extends the notification path, and installs retention.
-- Depends on 069, 070, 071.
--
-- Spec: docs/superpowers/specs/2026-08-01-invite-gate-vetting-design.md
--
-- ORDERING IS LOAD-BEARING. Section 1 must complete before section 2. Every
-- existing account has to be sitting in a state the enforcement predicate
-- accepts before the predicate exists, or the entire user base loses access
-- the moment this file applies. Sections 1 and 2 are in one migration, and
-- therefore one transaction, specifically so they cannot be split.
--
-- Retry-safe: idempotent throughout.
-- ============================================================

-- ── 1. Grandfathering (must run first) ──────────────────────────────────────
-- 070 added profiles.vetting_status NOT NULL DEFAULT 'unvetted', which
-- backfilled every existing row as it was added. This is the belt-and-braces
-- pass: it is a no-op on a clean run and the safety net if 070 was ever partly
-- applied by hand.

UPDATE public.profiles
SET vetting_status = 'unvetted'
WHERE vetting_status IS NULL
   OR vetting_status NOT IN ('unvetted','pending','approved','rejected');

-- Now flip the default. Existing rows keep 'unvetted' and keep their access;
-- every account created from here starts 'pending' and can read nothing until a
-- human decides. Leaving the default at 'unvetted' would mean a new signup was
-- fully admitted during the window between profile creation and
-- create_membership_application() -- a gate with a hole exactly the width of
-- one network round trip.
ALTER TABLE public.profiles ALTER COLUMN vetting_status SET DEFAULT 'pending';

-- ── 2. The enforcement predicate ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_approved_member()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      -- 'unvetted' is the grandfathered population and MUST be allowed. A
      -- predicate testing = 'approved' locks out every pre-gate user at once.
      AND vetting_status IN ('approved','unvetted')
  );
$$;

COMMENT ON FUNCTION public.is_approved_member() IS
  'Gate predicate. Includes unvetted (grandfathered) deliberately -- narrowing this to approved-only locks out every pre-gate account.';

-- Fold it into the 069 helpers rather than editing every policy in the
-- database. Three function bodies replace what would otherwise be a sweep
-- across a dozen tables, and any future table that uses these helpers inherits
-- the gate for free.

CREATE OR REPLACE FUNCTION public.can_read_community_content(cid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.is_approved_member()
    AND (
      cid IS NULL
      OR EXISTS (
        SELECT 1 FROM public.communities c
        WHERE c.id = cid AND c.is_private = false
      )
      OR public.is_community_member(cid)
    );
$$;

-- Membership itself stops meaning anything for an unapproved account: this
-- closes private communities and their member lists in one move.
CREATE OR REPLACE FUNCTION public.is_community_member(cid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_approved_member()
     AND EXISTS (
       SELECT 1 FROM public.community_members
       WHERE community_id = cid
         AND user_id = auth.uid()
     );
$$;

-- Events carry their own policy (020) rather than going through the helpers.
DROP POLICY IF EXISTS "events_select" ON public.events;
CREATE POLICY "events_select" ON public.events
  FOR SELECT TO authenticated
  USING (
    public.is_approved_member()
    AND (
      is_private = false
      OR (
        is_private = true
        AND community_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.community_members cm
          WHERE cm.community_id = public.events.community_id
            AND cm.user_id = auth.uid()
        )
      )
    )
  );

-- NOT gated here, and deliberately so: profiles, conversations, and messages.
-- A pending applicant has no conversations and no friends, so those tables hold
-- nothing for them to read. profiles is readable, which is what lets the
-- pending screen greet someone by name. Narrowing profiles is a follow-up with
-- its own blast radius -- it is referenced by nearly every join in the app --
-- and it is tracked in the spec rather than smuggled into this file.

-- ── 3. Notification path ────────────────────────────────────────────────────
-- Reuses email_queue (034_marketplace_infra.sql) and its Resend worker. The
-- email_type CHECK is a closed list, so new types need the constraint replaced,
-- and recipient_type was written for a marketplace that only knew buyers and
-- businesses.

ALTER TABLE public.email_queue DROP CONSTRAINT IF EXISTS email_queue_email_type_check;
ALTER TABLE public.email_queue
  ADD CONSTRAINT email_queue_email_type_check CHECK (email_type IN (
    'order_shipped_buyer',
    'product_approved',
    'product_rejected',
    'refund_notification_buyer',
    'dispute_alert_business',
    'application_approved',
    'application_rejected',
    'application_received'
  ));

ALTER TABLE public.email_queue DROP CONSTRAINT IF EXISTS email_queue_recipient_type_check;
ALTER TABLE public.email_queue
  ADD CONSTRAINT email_queue_recipient_type_check
  CHECK (recipient_type IN ('buyer','business','applicant'));

-- Enqueue on decision. A trigger rather than a call inside _apply_decision so
-- the notification cannot be forgotten by a future write path.
CREATE OR REPLACE FUNCTION public.enqueue_application_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = OLD.status OR NEW.status NOT IN ('approved','rejected') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.email_queue (email_type, recipient_type, recipient_user_id, payload)
  VALUES (
    CASE NEW.status WHEN 'approved' THEN 'application_approved'
                    ELSE 'application_rejected' END,
    'applicant',
    NEW.auth_user_id,
    jsonb_build_object(
      'application_id', NEW.id,
      'community_name', (SELECT name FROM public.communities WHERE id = NEW.community_id),
      'can_reapply_at', NEW.rejected_until
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_email ON public.membership_applications;
CREATE TRIGGER trg_application_email
  AFTER UPDATE OF status ON public.membership_applications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_application_email();

-- ── 4. Retention ────────────────────────────────────────────────────────────
-- "Purged after a decision" is only true if something does the purging.

CREATE OR REPLACE FUNCTION public.purge_expired_applicant_data()
RETURNS TABLE (names_purged integer, applications_purged integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_names integer;
  v_apps  integer;
BEGIN
  -- Legal names, 30 days after a decision. The row stays so the access log
  -- still has something to reference; only the name goes.
  WITH gone AS (
    DELETE FROM public.applicant_identity
    WHERE purge_after IS NOT NULL AND purge_after < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_names FROM gone;

  -- Rejected applications in full, 90 days after the decision. Cascades take
  -- answers, criteria, reviews and the access log with them.
  WITH gone AS (
    DELETE FROM public.membership_applications
    WHERE purge_after IS NOT NULL AND purge_after < now() AND status = 'rejected'
    RETURNING 1
  )
  SELECT count(*) INTO v_apps FROM gone;

  -- Attempt logs are only useful while the window they police is open.
  DELETE FROM public.code_attempts WHERE attempted_at < now() - interval '30 days';

  RETURN QUERY SELECT v_names, v_apps;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_applicant_data() FROM public, anon, authenticated;

-- Schedule it if pg_cron is available; otherwise the function still exists and
-- can be driven by an edge function on a schedule. Failing the whole migration
-- because an extension is not enabled would be worse than either.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-applicant-data')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-applicant-data');

    PERFORM cron.schedule(
      'purge-applicant-data',
      '17 3 * * *',
      'SELECT public.purge_expired_applicant_data();'
    );
  ELSE
    RAISE NOTICE 'pg_cron not enabled -- purge_expired_applicant_data() must be driven by a scheduled edge function';
  END IF;
END;
$$;
