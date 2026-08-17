-- Down for 092 — restore migration 057's notification deep links.
--
-- Restores both trigger function bodies verbatim from 057 and puts the
-- back-filled rows back on the old path, so a rollback leaves the table exactly
-- as 092 found it.

CREATE OR REPLACE FUNCTION public.notify_friend_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sender_name text;
BEGIN
  IF NEW.status = 'pending' THEN
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE user_id = NEW.addressee_id AND actor_id = NEW.requester_id
        AND type = 'friend_request' AND read_at IS NULL
    ) THEN
      SELECT display_name INTO sender_name FROM profiles WHERE id = NEW.requester_id;
      INSERT INTO notifications (user_id, actor_id, type, title, body, link_path)
      VALUES (
        NEW.addressee_id,
        NEW.requester_id,
        'friend_request',
        left(COALESCE(sender_name, 'Someone'), 150) || ' sent you a friend request',
        'Accept to start chatting 💜',
        '/(tabs)/grow/people'
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_friend_accept()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE accepter_name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    SELECT display_name INTO accepter_name FROM profiles WHERE id = NEW.addressee_id;
    INSERT INTO notifications (user_id, actor_id, type, title, body, link_path)
    VALUES (
      NEW.requester_id,
      NEW.addressee_id,
      'friend_accept',
      left(COALESCE(accepter_name, 'Someone'), 150) || ' accepted your friend request',
      'You are now connected 🌸',
      '/(tabs)/grow/people'
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

UPDATE public.notifications
SET link_path = '/(tabs)/grow/people'
WHERE link_path = '/(tabs)/messages'
  AND type IN ('friend_request', 'friend_accept');
