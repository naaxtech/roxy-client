-- 018_chat_triggers.sql
-- Keep conversations.last_message_at in sync when messages are inserted.
-- This powers: inbox ordering, global unread detection, "last seen" previews.

CREATE OR REPLACE FUNCTION update_conversation_last_message_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_message_insert_update_conversation ON messages;
CREATE TRIGGER on_message_insert_update_conversation
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_last_message_at();
