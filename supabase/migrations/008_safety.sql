-- ============================================================
-- 008_safety.sql
-- reports table (blocks use existing friendships.status='blocked')
-- ============================================================

CREATE TABLE IF NOT EXISTS reports (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id      uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  reported_user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content_type     text NOT NULL CHECK (content_type IN ('message','post','profile')),
  content_id       uuid,
  reason           text NOT NULL CHECK (reason IN ('harassment','spam','inappropriate','hate_speech','other')),
  detail           text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
  reviewed_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now(),
  CONSTRAINT no_self_report CHECK (reporter_id != reported_user_id)
);

-- RLS
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_insert_own"  ON reports FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "reports_select_own"  ON reports FOR SELECT USING  (reporter_id = auth.uid());
-- Admin updates handled via service role key in edge functions

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
