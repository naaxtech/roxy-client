-- 029_user_business_bookmarks.sql
CREATE TABLE IF NOT EXISTS user_business_bookmarks (
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);

ALTER TABLE user_business_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own bookmarks" ON user_business_bookmarks
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
