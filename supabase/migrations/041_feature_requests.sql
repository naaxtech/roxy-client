-- 041_feature_requests.sql
-- Feature voting system: community pitches ideas + votes; Roxy team marks planned items

CREATE TABLE feature_requests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT        NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  description    TEXT        CHECK (description IS NULL OR length(trim(description)) BETWEEN 10 AND 1000),
  type           TEXT        NOT NULL DEFAULT 'pitched' CHECK (type IN ('planned', 'pitched')),
  status         TEXT        NOT NULL DEFAULT 'open'    CHECK (status IN ('open', 'in_progress', 'done', 'rejected')),
  vote_count     INTEGER     NOT NULL DEFAULT 0,
  created_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  webhook_notified BOOLEAN   NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feature_votes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id UUID        NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(feature_id, user_id)
);

CREATE INDEX idx_feature_requests_type_status ON feature_requests(type, status);
CREATE INDEX idx_feature_requests_vote_count  ON feature_requests(vote_count DESC);
CREATE INDEX idx_feature_votes_user_id        ON feature_votes(user_id);

-- RLS
ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_votes    ENABLE ROW LEVEL SECURITY;

-- feature_requests: anyone reads; authed users pitch; staff updates via service role
CREATE POLICY "feature_requests_read"   ON feature_requests FOR SELECT USING (true);
CREATE POLICY "feature_requests_pitch"  ON feature_requests FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND type = 'pitched');

-- feature_votes: anyone reads; users vote once; users delete own vote
CREATE POLICY "feature_votes_read"      ON feature_votes FOR SELECT USING (true);
CREATE POLICY "feature_votes_insert"    ON feature_votes FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "feature_votes_delete"    ON feature_votes FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger: keep vote_count denormalised
CREATE OR REPLACE FUNCTION update_feature_vote_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE feature_requests SET vote_count = vote_count + 1 WHERE id = NEW.feature_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE feature_requests SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = OLD.feature_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER feature_vote_count_trigger
AFTER INSERT OR DELETE ON feature_votes
FOR EACH ROW EXECUTE FUNCTION update_feature_vote_count();

-- Seed planned features
INSERT INTO feature_requests (title, description, type, status) VALUES
  ('Dark mode', 'A full dark theme across all screens — your eyes will thank you.', 'planned', 'in_progress'),
  ('Voice messages in chat', 'Send short voice notes to your connections instead of typing.', 'planned', 'open'),
  ('Event calendar sync', 'Sync Roxy events directly to Google or Apple Calendar.', 'planned', 'open'),
  ('Speed dating for communities', 'Quick 1-on-1 video rounds within your community to meet new people.', 'planned', 'open');
