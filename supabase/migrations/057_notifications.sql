-- 057: notifications center — friend requests/accepts + new community events.
-- Clients can only read + mark-read their own rows (column-level UPDATE grant
-- restricts writes to read_at); all inserts happen inside SECURITY DEFINER
-- trigger functions. Every statement is retry-safe: a partially-applied run
-- of this migration can be re-pushed without manual repair.

CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  type       text NOT NULL CHECK (type IN ('friend_request','friend_accept','community_event')),
  title      text NOT NULL CHECK (char_length(title) <= 200),
  body       text CHECK (char_length(body) <= 500),
  link_path  text CHECK (char_length(link_path) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RLS is row-level only — without this grant a user could rewrite the
-- title/body/type of their own rows. Column-level grant = mark-read only.
REVOKE UPDATE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

-- No INSERT/DELETE policies: clients cannot write rows directly.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already in the publication (retry after partial failure)
END $$;

-- ── Fan-out: friend request sent ────────────────────────────────────────────
-- All trigger bodies swallow their own errors: a notification must never
-- roll back the user action that produced it. Text inputs are truncated
-- because display_name / community name / event title are unbounded.
CREATE OR REPLACE FUNCTION public.notify_friend_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sender_name text;
BEGIN
  IF NEW.status = 'pending' THEN
    -- Dedup: an unread request notification from this sender already exists
    -- (cancel-and-resend must not spam the recipient).
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

DROP TRIGGER IF EXISTS trg_notify_friend_request ON public.friendships;
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

DROP TRIGGER IF EXISTS trg_notify_friend_accept ON public.friendships;
CREATE TRIGGER trg_notify_friend_accept
AFTER UPDATE ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.notify_friend_accept();

-- ── Fan-out: new event in a joined community ────────────────────────────────
-- Synchronous fan-out is acceptable at current community sizes; revisit
-- condition recorded in .claude/decisions.md (move to queued fan-out when a
-- community approaches ~5k members).
CREATE OR REPLACE FUNCTION public.notify_community_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE comm_name text;
BEGIN
  IF NEW.community_id IS NOT NULL THEN
    SELECT name INTO comm_name FROM communities WHERE id = NEW.community_id;
    INSERT INTO notifications (user_id, actor_id, type, title, body, link_path)
    SELECT
      cm.user_id,
      NEW.host_id,
      'community_event',
      left(COALESCE(comm_name, 'Your community'), 170) || ' has a new event',
      left(NEW.title, 500),
      '/event/' || NEW.id
    FROM community_members cm
    WHERE cm.community_id = NEW.community_id
      AND cm.user_id <> NEW.host_id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_community_event ON public.events;
CREATE TRIGGER trg_notify_community_event
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.notify_community_event();
