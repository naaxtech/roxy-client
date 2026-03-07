-- supabase/migrations/004_connect_dating.sql

-- ─── Add conversation_id to ai_call_log ──────────────────────────────────────
-- Needed for per-conversation rate limiting (icebreaker, wingwoman, nudge)
ALTER TABLE ai_call_log ADD COLUMN conversation_id uuid;
CREATE INDEX idx_ai_log_conversation ON ai_call_log (conversation_id, function_name) WHERE conversation_id IS NOT NULL;

-- ─── conversations ───────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id                         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_ids            uuid[] NOT NULL,
  conversation_type          text DEFAULT 'direct' CHECK (conversation_type IN ('direct','speed_date','sister')),
  last_message_at            timestamptz,
  roxy_nudge_count           int DEFAULT 0,
  roxy_wingwoman_count_today int DEFAULT 0,
  last_roxy_call_date        date,
  created_at                 timestamptz DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Participant can read/insert/update their conversations
CREATE POLICY "conversations_participant" ON conversations
  FOR ALL USING (auth.uid() = ANY(participant_ids));

CREATE INDEX idx_conversations_participants ON conversations USING GIN (participant_ids);
CREATE INDEX idx_conversations_last_msg ON conversations (last_message_at DESC NULLS LAST);

-- ─── messages ────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  content         text,
  media_url       text,
  message_type    text DEFAULT 'text' CHECK (message_type IN ('text','image','voice','roxy_suggestion')),
  is_read         boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT message_has_content CHECK (content IS NOT NULL OR media_url IS NOT NULL)
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Participant of the conversation can read/insert messages
CREATE POLICY "messages_participant" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND auth.uid() = ANY(c.participant_ids)
    )
  );

CREATE POLICY "messages_insert_participant" ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND auth.uid() = ANY(c.participant_ids)
    )
  );

CREATE POLICY "messages_update_own" ON messages
  FOR UPDATE USING (auth.uid() = sender_id);

CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at DESC);
CREATE INDEX idx_messages_unread ON messages (conversation_id, is_read) WHERE is_read = false;

-- Trigger: update conversations.last_message_at on new message
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_update_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message();

-- ─── speed_date_sessions ─────────────────────────────────────────────────────
CREATE TABLE speed_date_sessions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  community_id    uuid REFERENCES communities(id) ON DELETE SET NULL,
  scheduled_at    timestamptz NOT NULL,
  duration_seconds int DEFAULT 300,
  participant_ids uuid[] DEFAULT '{}',
  status          text DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed')),
  daily_room_url  text,
  prompts         text[] DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE speed_date_sessions ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read scheduled/active sessions
CREATE POLICY "speed_date_read_auth" ON speed_date_sessions
  FOR SELECT USING (auth.uid() IS NOT NULL AND status IN ('scheduled','active'));

-- Participants can update (for joining, status changes)
CREATE POLICY "speed_date_participant_update" ON speed_date_sessions
  FOR UPDATE USING (auth.uid() = ANY(participant_ids));

-- Service role manages all (via edge functions)
-- No client INSERT — sessions created server-side only

CREATE INDEX idx_speed_date_scheduled ON speed_date_sessions (scheduled_at) WHERE status = 'scheduled';

-- ─── matches ─────────────────────────────────────────────────────────────────
CREATE TABLE matches (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a_id       uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  user_b_id       uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  matched_at      timestamptz DEFAULT now(),
  source          text DEFAULT 'speed_date' CHECK (source IN ('speed_date','discover','community')),
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  UNIQUE (user_a_id, user_b_id),
  CONSTRAINT no_self_match CHECK (user_a_id != user_b_id)
);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matches_own" ON matches
  FOR ALL USING (auth.uid() IN (user_a_id, user_b_id));

CREATE INDEX idx_matches_users ON matches (user_a_id, user_b_id);

-- Enable Realtime for messages and conversations
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
