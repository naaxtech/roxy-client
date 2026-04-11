-- 026_seed_community_rooms.sql
-- Inserts dev rooms for every existing community.
-- Runs as superuser — bypasses RLS.
-- Safe to re-run (WHERE NOT EXISTS guards).
-- Statuses: mix of live, scheduled, closed for UI testing.

-- Audio Hangout (live) — one per community
INSERT INTO community_rooms (community_id, name, description, room_type, status, is_active, scheduled_at)
SELECT
  c.id,
  'Audio Hangout',
  'Open voice room for members',
  'audio',
  'live',
  true,
  NULL
FROM communities c
WHERE NOT EXISTS (
  SELECT 1 FROM community_rooms cr
  WHERE cr.community_id = c.id AND cr.name = 'Audio Hangout'
);

-- Video Hangout (live) — one per community
INSERT INTO community_rooms (community_id, name, description, room_type, status, is_active, scheduled_at)
SELECT
  c.id,
  'Video Hangout',
  'Video room for members',
  'video',
  'live',
  true,
  NULL
FROM communities c
WHERE NOT EXISTS (
  SELECT 1 FROM community_rooms cr
  WHERE cr.community_id = c.id AND cr.name = 'Video Hangout'
);

-- Weekly Catch-up (scheduled) — one per community, 3 days from now
INSERT INTO community_rooms (community_id, name, description, room_type, status, is_active, scheduled_at)
SELECT
  c.id,
  'Weekly Catch-up',
  'Our regular weekly video call',
  'video',
  'scheduled',
  false,
  now() + interval '3 days'
FROM communities c
WHERE NOT EXISTS (
  SELECT 1 FROM community_rooms cr
  WHERE cr.community_id = c.id AND cr.name = 'Weekly Catch-up'
);
