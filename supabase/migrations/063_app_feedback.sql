-- ============================================================
-- 063_app_feedback.sql
-- In-app "report a problem" feedback: bug/broken/other reports from users.
-- Feature requests + voting already exist (see 041_feature_requests.sql) --
-- this table is deliberately scoped to problems, not ideas, to avoid
-- duplicating that mechanism.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_feedback (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  category       text NOT NULL CHECK (category IN ('bug', 'broken', 'other')),
  rating         smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  message        text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 1000),
  screen_context text,
  app_version    text,
  platform       text CHECK (platform IS NULL OR platform IN ('ios', 'android', 'web')),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'wontfix')),
  internal_notes text,
  created_at     timestamptz DEFAULT now(),
  resolved_at    timestamptz
);

-- RLS
ALTER TABLE app_feedback ENABLE ROW LEVEL SECURITY;

-- Users insert and read their own submissions (so the loop closes: they can
-- see status move from open -> in_review -> resolved). internal_notes is
-- selected by this same policy, but the client never renders it for
-- non-staff users -- staff-only visibility of that column is a client
-- convention, not enforced by a column-level grant, matching this table's
-- own tradeoff already accepted on `reports.detail`.
CREATE POLICY "app_feedback_insert_own" ON app_feedback FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "app_feedback_select_own" ON app_feedback FOR SELECT USING (user_id = auth.uid());

-- Staff: read everything, update status/internal_notes (triage in Studio).
-- Same pattern as 043_staff_product_select.sql.
CREATE POLICY "app_feedback_select_staff" ON app_feedback
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_staff = true
    )
  );

CREATE POLICY "app_feedback_update_staff" ON app_feedback
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_staff = true
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_app_feedback_user_id ON app_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_app_feedback_status ON app_feedback(status);
CREATE INDEX IF NOT EXISTS idx_app_feedback_created_at ON app_feedback(created_at DESC);
