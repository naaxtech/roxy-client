-- ============================================================
-- 007_gamification.sql
-- badges, user_badge_progress
-- ============================================================

CREATE TABLE IF NOT EXISTS badges (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name                  text NOT NULL,
  description           text NOT NULL,
  emoji                 text NOT NULL,
  category              text NOT NULL CHECK (category IN ('community','connection','milestone','ally')),
  points_value          int NOT NULL DEFAULT 10,
  requirement_type      text NOT NULL,
  requirement_threshold int NOT NULL DEFAULT 1,
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_badge_progress (
  user_id       uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  badge_id      uuid REFERENCES badges(id)   ON DELETE CASCADE NOT NULL,
  current_value int NOT NULL DEFAULT 0,
  earned_at     timestamptz,
  PRIMARY KEY (user_id, badge_id)
);

-- RLS
ALTER TABLE badges              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badge_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badges_read_all"   ON badges              FOR SELECT USING (true);
CREATE POLICY "ubp_owner_select"  ON user_badge_progress FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "ubp_owner_insert"  ON user_badge_progress FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "ubp_owner_update"  ON user_badge_progress FOR UPDATE USING (user_id = auth.uid());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ubp_user  ON user_badge_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_ubp_badge ON user_badge_progress(badge_id);

-- ============================================================
-- PL/pgSQL: award points + set earned_at when badge completed
-- ============================================================
CREATE OR REPLACE FUNCTION award_badge_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  badge_points int;
BEGIN
  -- Only fire when earned_at transitions NULL -> value
  IF OLD.earned_at IS NOT NULL OR NEW.earned_at IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT points_value INTO badge_points FROM badges WHERE id = NEW.badge_id;
  UPDATE profiles SET gamification_points = gamification_points + badge_points
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_award_badge_points
  AFTER UPDATE ON user_badge_progress
  FOR EACH ROW EXECUTE FUNCTION award_badge_points();

-- ============================================================
-- Seed: 4 starter badges
-- ============================================================
INSERT INTO badges (name, description, emoji, category, points_value, requirement_type, requirement_threshold) VALUES
  ('First Connection',    'Made your first friend on Roxy',       '💜', 'connection', 25, 'connections',     1),
  ('Conversation Starter','Sent your first message',              '💬', 'connection', 10, 'messages',        1),
  ('Speed Dater',         'Completed your first speed date',      '⚡', 'milestone',  50, 'speed_dates',     1),
  ('Community Builder',   'Joined your first community',          '🏳️‍🌈', 'community', 15, 'community_joins', 1)
ON CONFLICT DO NOTHING;
