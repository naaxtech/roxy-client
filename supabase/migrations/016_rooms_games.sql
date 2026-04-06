-- 016_rooms_games.sql
-- games catalog, community_rooms, and feature flag columns on profiles

-- 1. games table
CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,          -- e.g. 'speed_dating'
  name text NOT NULL,                  -- e.g. 'Speed Dating'
  description text,
  emoji text NOT NULL DEFAULT '🎮',
  is_active boolean NOT NULL DEFAULT true,
  min_players integer NOT NULL DEFAULT 2,
  max_players integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "games_read_all" ON games FOR SELECT USING (true);

INSERT INTO games (slug, name, description, emoji, is_active, min_players, max_players)
VALUES ('speed_dating', 'Speed Dating', 'Meet someone new in 5 minutes', '⚡', true, 2, 2)
ON CONFLICT (slug) DO NOTHING;

-- 2. Feature flag columns on profiles (must exist before community_rooms policy references them)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_create_room boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_submit_game boolean NOT NULL DEFAULT false;

-- 3. community_rooms table
CREATE TABLE IF NOT EXISTS community_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  room_type text NOT NULL DEFAULT 'video' CHECK (room_type IN ('video', 'audio')),
  daily_room_url text,
  daily_room_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE community_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "community_rooms_select" ON community_rooms FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM community_members cm
    WHERE cm.community_id = community_rooms.community_id
      AND cm.user_id = auth.uid()
  ));

CREATE POLICY "community_rooms_insert" ON community_rooms FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.can_create_room = true
  ));

