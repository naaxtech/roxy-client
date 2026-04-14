-- 028_user_project_supports.sql
CREATE TABLE IF NOT EXISTS user_project_supports (
  user_id    uuid REFERENCES profiles(id) ON DELETE CASCADE,
  project_id uuid REFERENCES impact_projects(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

ALTER TABLE user_project_supports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own supports" ON user_project_supports
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION sync_supporter_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE impact_projects
    SET supporter_count = (
      SELECT COUNT(*) FROM user_project_supports
      WHERE project_id = OLD.project_id
    )
    WHERE id = OLD.project_id;
    RETURN OLD;
  ELSE
    UPDATE impact_projects
    SET supporter_count = (
      SELECT COUNT(*) FROM user_project_supports
      WHERE project_id = NEW.project_id
    )
    WHERE id = NEW.project_id;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_sync_supporter_count
AFTER INSERT OR DELETE ON user_project_supports
FOR EACH ROW EXECUTE FUNCTION sync_supporter_count();
