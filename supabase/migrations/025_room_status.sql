-- 025_room_status.sql
-- Adds status and scheduled_at to community_rooms.
-- status replaces the implicit meaning of is_active:
--   'live'      → room is open, joinable
--   'scheduled' → room is future-dated, not yet joinable
--   'closed'    → room has ended, not joinable (hidden in mobile list)
-- is_active is kept for backward compat with existing edge fn query (updated later).

ALTER TABLE community_rooms
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'live'
    CHECK (status IN ('live', 'scheduled', 'closed')),
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz NULL;

-- Back-fill: map is_active → status (column just added, all rows are 'live' by default)
UPDATE community_rooms SET status = 'closed' WHERE is_active = false;
-- Rows with is_active = true already have status = 'live' (the default) — no update needed

COMMENT ON COLUMN community_rooms.status IS
  'live=open and joinable, scheduled=future room, closed=ended';
COMMENT ON COLUMN community_rooms.scheduled_at IS
  'Required when status=scheduled. NULL for live/closed rooms.';
