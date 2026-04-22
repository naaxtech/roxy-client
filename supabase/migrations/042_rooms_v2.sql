-- 042_rooms_v2.sql
-- Extend community_rooms with participant tracking, timing, and corrected RLS

-- 1. Add new columns
ALTER TABLE community_rooms
  ADD COLUMN IF NOT EXISTS participant_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_participants   INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS started_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at           TIMESTAMPTZ;

-- 2. Add 'idle' to status CHECK (drop old, add new)
ALTER TABLE community_rooms DROP CONSTRAINT IF EXISTS community_rooms_status_check;
ALTER TABLE community_rooms
  ADD CONSTRAINT community_rooms_status_check
  CHECK (status IN ('idle', 'live', 'scheduled', 'closed'));

-- 3. Fix INSERT RLS: was based on can_create_room profile flag — change to admin/mod role
DROP POLICY IF EXISTS "community_rooms_insert" ON community_rooms;
CREATE POLICY "community_rooms_insert" ON community_rooms FOR INSERT
  WITH CHECK (
    created_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM community_members
      WHERE community_id = community_rooms.community_id
        AND user_id = auth.uid()
        AND role IN ('admin', 'moderator')
    )
  );

-- 4. Add UPDATE policy (host, admin, or moderator)
DROP POLICY IF EXISTS "community_rooms_update" ON community_rooms;
CREATE POLICY "community_rooms_update" ON community_rooms FOR UPDATE
  USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM community_members
      WHERE community_id = community_rooms.community_id
        AND user_id = auth.uid()
        AND role IN ('admin', 'moderator')
    )
  );

-- 5. SQL helper functions for atomic participant count updates
CREATE OR REPLACE FUNCTION increment_participant_count(p_room_name TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE community_rooms
  SET participant_count = GREATEST(0, participant_count + 1)
  WHERE daily_room_name = p_room_name AND status = 'live';
$$;

CREATE OR REPLACE FUNCTION decrement_participant_count(p_room_name TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE community_rooms
  SET participant_count = GREATEST(0, participant_count - 1)
  WHERE daily_room_name = p_room_name AND status = 'live';
$$;

-- 6. pg_cron: auto-close empty live rooms after 5 min
-- NOTE: requires pg_cron extension enabled in Supabase dashboard (Database → Extensions → pg_cron)
-- Run this manually once the extension is enabled:
--   SELECT cron.schedule('close-empty-rooms', '*/5 * * * *', $$
--     UPDATE community_rooms SET status = 'closed', ended_at = now()
--     WHERE status = 'live' AND participant_count = 0 AND started_at < now() - interval '5 minutes';
--   $$);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'close-empty-rooms',
      '*/5 * * * *',
      'UPDATE community_rooms SET status = ''closed'', ended_at = now() WHERE status = ''live'' AND participant_count = 0 AND started_at < now() - interval ''5 minutes'''
    );
  END IF;
END $$;

-- 7. Index for webhook lookup by daily_room_name
CREATE INDEX IF NOT EXISTS community_rooms_daily_room_name_idx
  ON community_rooms(daily_room_name)
  WHERE daily_room_name IS NOT NULL;
