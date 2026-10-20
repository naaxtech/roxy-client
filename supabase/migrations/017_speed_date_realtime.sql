-- 017_speed_date_realtime.sql
-- Enable Realtime on speed_date_sessions so the waiting room can subscribe
-- to status changes and auto-navigate when a match is found.
ALTER PUBLICATION supabase_realtime ADD TABLE speed_date_sessions;

-- Allow any authenticated user to INSERT a speed_date_session via the client.
-- (Edge function already bypasses RLS via service role; this policy covers
--  direct client calls for the simplified queue flow.)
-- Replay-from-zero fix (integration, db-verify): 009 already creates this exact
-- policy, so a fresh apply failed here with 42710. Dropping first yields the
-- same end state production has (one policy, this definition).
DROP POLICY IF EXISTS "speed_date_insert_auth" ON speed_date_sessions;
CREATE POLICY "speed_date_insert_auth" ON speed_date_sessions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
