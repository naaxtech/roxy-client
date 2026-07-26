-- ============================================================
-- 066_checkin_attendee_rpc.sql
-- Security fix: host_checkin_attendees (036_tickets_phase3.sql) is
-- USING(host owns event) WITH CHECK(true) -- that migration's own comment
-- says column restriction "MUST be enforced in the check-in edge function,"
-- but Postgres RLS cannot stop a host from calling the Supabase SDK
-- directly (bypassing the Studio route) to rewrite ticket_code, user_id, or
-- checked_in_at on any attendee of their own event. Moving the column
-- restriction into a SECURITY DEFINER RPC removes that trust boundary
-- instead of documenting it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.checkin_attendee(p_event_id uuid, p_ticket_code text)
RETURNS TABLE(user_id uuid, ticket_code text, checked_in_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_host_id  uuid;
  v_is_staff boolean;
BEGIN
  SELECT host_id INTO v_host_id FROM public.events WHERE id = p_event_id;
  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  SELECT is_staff INTO v_is_staff FROM public.profiles WHERE id = auth.uid();

  IF v_host_id != auth.uid() AND NOT COALESCE(v_is_staff, false) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  UPDATE public.event_attendees ea
  SET is_checked_in = true, checked_in_at = now()
  WHERE ea.event_id = p_event_id AND ea.ticket_code = p_ticket_code
  RETURNING ea.user_id, ea.ticket_code, ea.checked_in_at;
END;
$$;

-- The RPC is now the only path to flip is_checked_in -- drop the direct
-- UPDATE policy so a host's own session token can no longer rewrite
-- event_attendees columns outside it.
DROP POLICY IF EXISTS "host_checkin_attendees" ON public.event_attendees;
