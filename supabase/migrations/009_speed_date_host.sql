-- Allow authenticated users to create speed date sessions
-- Needed for host flow and dev testing
CREATE POLICY "speed_date_insert_auth" ON speed_date_sessions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
