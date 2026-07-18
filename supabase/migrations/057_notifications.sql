-- 057: notifications center — friend requests/accepts + new community events.
-- Clients can only read + mark-read their own rows; all writes happen inside
-- SECURITY DEFINER trigger functions.

CREATE TABLE public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('friend_request','friend_accept','community_event')),
  title      text NOT NULL CHECK (char_length(title) <= 200),
  body       text CHECK (char_length(body) <= 500),
  link_path  text CHECK (char_length(link_path) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);

CREATE INDEX idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON public.notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Mark-read only; user_id is immutable because WITH CHECK re-verifies ownership.
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- No INSERT/DELETE policies: clients cannot write rows directly.

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ── Fan-out: friend request sent ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_friend_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sender_name text;
BEGIN
  IF NEW.status = 'pending' THEN
    SELECT display_name INTO sender_name FROM profiles WHERE id = NEW.requester_id;
    INSERT INTO notifications (user_id, type, title, body, link_path)
    VALUES (
      NEW.addressee_id,
      'friend_request',
      COALESCE(sender_name, 'Someone') || ' sent you a friend request',
      'Accept to start chatting 💜',
      '/(tabs)/grow/people'
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_friend_request
AFTER INSERT ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.notify_friend_request();

-- ── Fan-out: friend request accepted ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_friend_accept()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE accepter_name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    SELECT display_name INTO accepter_name FROM profiles WHERE id = NEW.addressee_id;
    INSERT INTO notifications (user_id, type, title, body, link_path)
    VALUES (
      NEW.requester_id,
      'friend_accept',
      COALESCE(accepter_name, 'Someone') || ' accepted your friend request',
      'You are now connected 🌸',
      '/(tabs)/grow/people'
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_friend_accept
AFTER UPDATE ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.notify_friend_accept();

-- ── Fan-out: new event in a joined community ────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_community_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE comm_name text;
BEGIN
  IF NEW.community_id IS NOT NULL THEN
    SELECT name INTO comm_name FROM communities WHERE id = NEW.community_id;
    INSERT INTO notifications (user_id, type, title, body, link_path)
    SELECT
      cm.user_id,
      'community_event',
      COALESCE(comm_name, 'Your community') || ' has a new event',
      NEW.title,
      '/event/' || NEW.id
    FROM community_members cm
    WHERE cm.community_id = NEW.community_id
      AND cm.user_id <> NEW.host_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_community_event
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.notify_community_event();
