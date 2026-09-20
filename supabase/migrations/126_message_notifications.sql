-- 126 — direct-message notifications.
--
-- The notification centre (057) covered friend requests/accepts and community
-- events but never messages: a new DM appeared in the inbox with no bell. This
-- adds the 'message' type and fans out one row per incoming direct message to
-- the OTHER participant. Group channels stay quiet on purpose — a per-message
-- fan-out to every member of a busy channel is noise, not a notification (same
-- fan-out caveat 057 already records for events).

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('friend_request','friend_accept','community_event','message'));

CREATE OR REPLACE FUNCTION public.notify_direct_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv        conversations%ROWTYPE;
  v_recipient   uuid;
  v_sender_name text;
  v_preview     text;
BEGIN
  -- Roxy's own suggestion rows have no sender; speed-date / sister threads are
  -- ephemeral and must not ring the bell.
  IF NEW.sender_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_conv FROM conversations WHERE id = NEW.conversation_id;
  IF v_conv.id IS NULL OR v_conv.conversation_type <> 'direct' THEN RETURN NEW; END IF;

  SELECT display_name INTO v_sender_name FROM profiles WHERE id = NEW.sender_id;
  SELECT p INTO v_recipient FROM unnest(v_conv.participant_ids) AS p
  WHERE p <> NEW.sender_id LIMIT 1;
  IF v_recipient IS NULL THEN RETURN NEW; END IF;

  v_preview := CASE
    WHEN NEW.message_type = 'image' THEN '📷 sent you a photo'
    WHEN NEW.content IS NULL OR btrim(NEW.content) = '' THEN 'sent you a message'
    ELSE left(NEW.content, 120)
  END;

  INSERT INTO notifications (user_id, actor_id, type, title, body, link_path)
  VALUES (
    v_recipient, NEW.sender_id, 'message',
    left(COALESCE(v_sender_name, 'Someone'), 150) || ' sent you a message',
    v_preview,
    '/chat/' || NEW.conversation_id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_direct_message ON public.messages;
CREATE TRIGGER trg_notify_direct_message
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.notify_direct_message();
