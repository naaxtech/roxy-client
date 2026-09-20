-- 128 — channel message notifications (opt-in per community)
--
-- A direct message rings the bell (126); a group channel does not, and for good
-- reason: per-message fan-out to every member of a busy community is noise. This
-- makes it opt-in: a member flips `notify_messages` for a community and gets one
-- notification per incoming channel message (never her own), no others affected.

ALTER TABLE public.community_members
  ADD COLUMN IF NOT EXISTS notify_messages boolean NOT NULL DEFAULT false;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('friend_request','friend_accept','community_event','message','channel_message'));

CREATE OR REPLACE FUNCTION public.set_channel_notifications(p_community_id uuid, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_members
  SET notify_messages = p_enabled
  WHERE community_id = p_community_id AND user_id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.set_channel_notifications(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_channel_notifications(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_channel_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel_name text;
  v_comm_id      uuid;
  v_sender_name  text;
BEGIN
  IF NEW.sender_id IS NULL THEN RETURN NEW; END IF;

  SELECT community_id, slug INTO v_comm_id, v_channel_name
  FROM community_channels WHERE id = NEW.channel_id;
  IF v_comm_id IS NULL THEN RETURN NEW; END IF;

  SELECT display_name INTO v_sender_name FROM profiles WHERE id = NEW.sender_id;

  INSERT INTO notifications (user_id, actor_id, type, title, body, link_path)
  SELECT
    cm.user_id,
    NEW.sender_id,
    'channel_message',
    left(COALESCE(v_sender_name, 'Someone'), 150) || ' in #' || left(v_channel_name, 40),
    left(NEW.body, 120),
    '/community/channels/' || v_comm_id
  FROM community_members cm
  WHERE cm.community_id = v_comm_id
    AND cm.notify_messages = true
    AND cm.user_id <> NEW.sender_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_channel_message ON public.community_channel_messages;
CREATE TRIGGER trg_notify_channel_message
AFTER INSERT ON public.community_channel_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_channel_message();
