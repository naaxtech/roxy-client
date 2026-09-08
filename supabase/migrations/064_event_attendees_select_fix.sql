-- ============================================================
-- 064_event_attendees_select_fix.sql
-- Security fix: event_attendees "ea_select" (005_content_feed.sql) was
-- USING(true) -- any authenticated user could read every attendee row for
-- every event, including ticket_code (the sole check-in credential, added in
-- 020_event_detail.sql) and user_id (an outing risk on a WLW app). Verified
-- every mobile call site only ever queries its own row (.eq('user_id', self)),
-- so tightening to own-row + host (host_read_attendees, 036_tickets_phase3.sql,
-- unchanged) + staff does not break any existing read path.
-- ============================================================

DROP POLICY IF EXISTS "ea_select" ON public.event_attendees;

CREATE POLICY "ea_select_own" ON public.event_attendees
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "ea_select_staff" ON public.event_attendees
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_staff = true
    )
  );

-- host_read_attendees (036_tickets_phase3.sql) already covers the host case --
-- left untouched.
