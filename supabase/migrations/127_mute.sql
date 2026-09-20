-- 127 — mute without blocking
--
-- Blocking severs a relationship; muting only silences it. A woman should be
-- able to stop a stranger's notifications without the permanence (and the
-- "you will not see each other" promise) of a block — the two are different
-- intents and the app had only one of them.

CREATE TABLE IF NOT EXISTS public.mutes (
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  muted_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, muted_user_id),
  CONSTRAINT mutes_no_self CHECK (user_id <> muted_user_id)
);

ALTER TABLE public.mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mutes_own" ON public.mutes;
CREATE POLICY "mutes_own" ON public.mutes FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.mute_user(p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_target_id = auth.uid() THEN
    RAISE EXCEPTION 'you cannot mute yourself' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.mutes (user_id, muted_user_id)
  VALUES (auth.uid(), p_target_id)
  ON CONFLICT (user_id, muted_user_id) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.mute_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mute_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unmute_user(p_target_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_removed integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.mutes WHERE user_id = auth.uid() AND muted_user_id = p_target_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END $$;

REVOKE ALL ON FUNCTION public.unmute_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmute_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.muted_user_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT muted_user_id FROM public.mutes WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.muted_user_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.muted_user_ids() TO authenticated;

-- Muted senders do not ring the bell. The in-app notification is suppressed
-- too, so a mute is a mute everywhere, not just on the push channel.
CREATE OR REPLACE FUNCTION public.notify_direct_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv        conversations%ROWTYPE;
  v_recipient   uuid;
  v_sender_name text;
  v_preview     text;
BEGIN
  IF NEW.sender_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_conv FROM conversations WHERE id = NEW.conversation_id;
  IF v_conv.id IS NULL OR v_conv.conversation_type <> 'direct' THEN RETURN NEW; END IF;

  SELECT display_name INTO v_sender_name FROM profiles WHERE id = NEW.sender_id;
  SELECT p INTO v_recipient FROM unnest(v_conv.participant_ids) AS p
  WHERE p <> NEW.sender_id LIMIT 1;
  IF v_recipient IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.mutes WHERE user_id = v_recipient AND muted_user_id = NEW.sender_id) THEN
    RETURN NEW;
  END IF;

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
