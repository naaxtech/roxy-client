-- 132_private_groups_and_requests_down.sql
-- Restores the pre-132 shape. GROUPS AND SYSTEM ROWS CANNOT EXIST IN THE OLD
-- MODEL: this deletes every 'group' conversation (its messages cascade) and
-- every 'system' message. Take a backup first (scripts/backup-prod.mjs).
-- Policies come back exactly as 088/105/067/003 left them, except that each
-- is scoped TO authenticated (the old ones defaulted to PUBLIC, i.e. anon).
-- anon table grants are NOT restored: no client ever used them.

-- triggers and policies that depend on the new functions/tables
DROP TRIGGER IF EXISTS conversations_guard_insert ON public.conversations;
DROP TRIGGER IF EXISTS conversations_seed_members ON public.conversations;
DROP TRIGGER IF EXISTS messages_guard_insert ON public.messages;
DROP TRIGGER IF EXISTS messages_guard_update ON public.messages;
DROP TRIGGER IF EXISTS channel_messages_guard_insert ON public.community_channel_messages;
DROP TRIGGER IF EXISTS friendships_promote_requests ON public.friendships;

DROP POLICY IF EXISTS "chat members receive conversation broadcasts" ON realtime.messages;
DROP POLICY IF EXISTS "chat members send conversation broadcasts" ON realtime.messages;

DROP POLICY IF EXISTS conversations_select_member ON public.conversations;
DROP POLICY IF EXISTS conversations_insert_direct ON public.conversations;
CREATE POLICY conversations_participant ON public.conversations
  FOR ALL TO authenticated
  USING (auth.uid() = ANY (participant_ids) AND NOT public.blocked_in_conversation(id))
  WITH CHECK (
    auth.uid() = ANY (participant_ids)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(conversations.participant_ids) AS participant_id(participant_id)
      WHERE public.blocked_pair(auth.uid(), participant_id.participant_id)
    )
  );

DROP POLICY IF EXISTS messages_select_member ON public.messages;
DROP POLICY IF EXISTS messages_insert_member ON public.messages;
DROP POLICY IF EXISTS messages_update_sender ON public.messages;
CREATE POLICY messages_participant ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id AND auth.uid() = ANY (c.participant_ids))
    AND NOT public.blocked_in_conversation(conversation_id)
    AND NOT public.blocked_pair(auth.uid(), sender_id)
  );
CREATE POLICY messages_insert_participant ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (SELECT 1 FROM public.conversations c
                WHERE c.id = messages.conversation_id AND auth.uid() = ANY (c.participant_ids))
    AND NOT public.blocked_in_conversation(conversation_id)
  );
CREATE POLICY messages_update_own ON public.messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id AND NOT public.blocked_in_conversation(conversation_id))
  WITH CHECK (auth.uid() = sender_id AND NOT public.blocked_in_conversation(conversation_id));

DROP POLICY IF EXISTS reactions_select ON public.message_reactions;
DROP POLICY IF EXISTS reactions_insert ON public.message_reactions;
CREATE POLICY reactions_select ON public.message_reactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
                 WHERE m.id = message_reactions.message_id AND auth.uid() = ANY (c.participant_ids)));
CREATE POLICY reactions_insert ON public.message_reactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS friendships_select_own ON public.friendships;
DROP POLICY IF EXISTS friendships_insert_request ON public.friendships;
DROP POLICY IF EXISTS friendships_accept ON public.friendships;
DROP POLICY IF EXISTS friendships_delete_own ON public.friendships;
CREATE POLICY friendships_own ON public.friendships
  FOR ALL TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

DROP POLICY IF EXISTS cm_insert_own ON public.community_members;
DROP POLICY IF EXISTS cm_delete_own ON public.community_members;
DROP POLICY IF EXISTS cm_read_community_member ON public.community_members;
DROP POLICY IF EXISTS cm_read_own ON public.community_members;
CREATE POLICY cm_insert_own ON public.community_members
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND role = 'member');
CREATE POLICY cm_delete_own ON public.community_members
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY cm_read_community_member ON public.community_members
  FOR SELECT TO authenticated USING (public.is_community_member(community_id));
CREATE POLICY cm_read_own ON public.community_members
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "members read channel messages" ON public.community_channel_messages;
CREATE POLICY "members read channel messages" ON public.community_channel_messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.community_channels c
                 WHERE c.id = community_channel_messages.channel_id AND public.is_community_member(c.community_id)));
DROP POLICY IF EXISTS "members post as themselves" ON public.community_channel_messages;
CREATE POLICY "members post as themselves" ON public.community_channel_messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid()
              AND EXISTS (SELECT 1 FROM public.community_channels c
                          WHERE c.id = community_channel_messages.channel_id AND public.is_community_member(c.community_id)));

DROP POLICY IF EXISTS communities_insert_auth ON public.communities;
CREATE POLICY communities_insert_auth ON public.communities
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());

-- functions back to their previous bodies
CREATE OR REPLACE FUNCTION public.create_community(p_name text, p_slug text, p_description text, p_category text, p_is_private boolean DEFAULT false)
RETURNS public.communities
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_community public.communities;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  INSERT INTO public.communities (name, slug, description, category, is_private, created_by)
  VALUES (p_name, p_slug, p_description, p_category, p_is_private, auth.uid())
  RETURNING * INTO v_community;
  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (v_community.id, auth.uid(), 'admin');
  RETURN v_community;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_marked integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id AND auth.uid() = ANY (c.participant_ids)
  ) THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.messages SET is_read = true
  WHERE conversation_id = p_conversation_id AND sender_id <> auth.uid() AND is_read = false;
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  RETURN v_marked;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_direct_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv        public.conversations%ROWTYPE;
  v_recipient   uuid;
  v_sender_name text;
  v_preview     text;
BEGIN
  IF NEW.sender_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_conv.id IS NULL OR v_conv.conversation_type <> 'direct' THEN RETURN NEW; END IF;
  SELECT display_name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  SELECT p INTO v_recipient FROM unnest(v_conv.participant_ids) AS p WHERE p <> NEW.sender_id LIMIT 1;
  IF v_recipient IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.mutes WHERE user_id = v_recipient AND muted_user_id = NEW.sender_id) THEN
    RETURN NEW;
  END IF;
  v_preview := CASE
    WHEN NEW.message_type = 'image' THEN '📷 sent you a photo'
    WHEN NEW.content IS NULL OR btrim(NEW.content) = '' THEN 'sent you a message'
    ELSE left(NEW.content, 120)
  END;
  INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
  VALUES (v_recipient, NEW.sender_id, 'message',
          left(COALESCE(v_sender_name, 'Someone'), 150) || ' sent you a message',
          v_preview, '/chat/' || NEW.conversation_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_channel_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel_name text;
  v_comm_id      uuid;
  v_sender_name  text;
BEGIN
  IF NEW.sender_id IS NULL THEN RETURN NEW; END IF;
  SELECT community_id, slug INTO v_comm_id, v_channel_name FROM public.community_channels WHERE id = NEW.channel_id;
  IF v_comm_id IS NULL THEN RETURN NEW; END IF;
  SELECT display_name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
  SELECT cm.user_id, NEW.sender_id, 'channel_message',
         left(COALESCE(v_sender_name, 'Someone'), 150) || ' in #' || left(v_channel_name, 40),
         left(NEW.body, 120), '/community/channels/' || v_comm_id
  FROM public.community_members cm
  WHERE cm.community_id = v_comm_id AND cm.notify_messages = true AND cm.user_id <> NEW.sender_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

ALTER FUNCTION public.update_conversation_last_message() SECURITY INVOKER;
ALTER FUNCTION public.update_conversation_last_message() RESET search_path;
ALTER FUNCTION public.update_conversation_last_message_at() RESET search_path;

DROP POLICY IF EXISTS conversation_members_select ON public.conversation_members;
DROP POLICY IF EXISTS chat_settings_select_own ON public.chat_settings;
DROP POLICY IF EXISTS message_revisions_select_staff ON public.message_revisions;
DROP FUNCTION IF EXISTS public.inbox_summary() CASCADE;
DROP FUNCTION IF EXISTS public.messages_badge();
DROP FUNCTION IF EXISTS public.start_direct(uuid);
DROP FUNCTION IF EXISTS public.respond_message_request(uuid, boolean);
DROP FUNCTION IF EXISTS public.create_group(text, uuid[], text);
DROP FUNCTION IF EXISTS public.add_group_members(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.remove_group_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.leave_group(uuid);
DROP FUNCTION IF EXISTS public.set_group_role(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.rename_group(uuid, text, text);
DROP FUNCTION IF EXISTS public.mute_conversation(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.hide_conversation(uuid);
DROP FUNCTION IF EXISTS public.set_chat_settings(boolean, text);
DROP FUNCTION IF EXISTS public.remove_community_member(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.unban_community_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.chat_system_message(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.chat_my_group_role(uuid);
DROP FUNCTION IF EXISTS public.chat_require_member();
DROP FUNCTION IF EXISTS public.conversations_guard_insert();
DROP FUNCTION IF EXISTS public.conversations_seed_members();
DROP FUNCTION IF EXISTS public.messages_guard_insert();
DROP FUNCTION IF EXISTS public.messages_guard_update();
DROP FUNCTION IF EXISTS public.channel_messages_guard_insert();
DROP FUNCTION IF EXISTS public.friendships_promote_requests();
DROP FUNCTION IF EXISTS public.chat_check_message_insert(uuid, text, text);
DROP FUNCTION IF EXISTS public.chat_record_revision(uuid, text);
DROP FUNCTION IF EXISTS public.realtime_conversation_topic_ok(text);
DROP FUNCTION IF EXISTS public.can_read_message_id(uuid);
DROP FUNCTION IF EXISTS public.can_read_message(uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.can_send_message(uuid);
DROP FUNCTION IF EXISTS public.is_allowed_chat_media(text, uuid);
DROP FUNCTION IF EXISTS public.chat_new_conversation_allowed();
DROP FUNCTION IF EXISTS public.chat_can_add_to_group(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.chat_display_name(uuid);
DROP FUNCTION IF EXISTS public.is_conversation_member(uuid);
DROP FUNCTION IF EXISTS public.has_conversation_member_row(uuid);
-- community_bans policy uses is_community_moderator only; the table goes below.
DROP POLICY IF EXISTS community_bans_select ON public.community_bans;
DROP FUNCTION IF EXISTS public.is_banned_from_community(uuid, uuid);

-- data that the old model cannot hold
DELETE FROM public.conversations WHERE conversation_type = 'group';
DELETE FROM public.messages WHERE message_type = 'system';
UPDATE public.messages SET content = '' WHERE content IS NULL AND media_url IS NULL;

DROP TABLE IF EXISTS public.conversation_members;
DROP TABLE IF EXISTS public.chat_settings;
DROP TABLE IF EXISTS public.message_revisions;
DROP TABLE IF EXISTS public.community_bans;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_len;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS message_has_content;
ALTER TABLE public.messages ADD CONSTRAINT message_has_content CHECK (content IS NOT NULL OR media_url IS NOT NULL);
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'voice', 'roxy_suggestion'));
DROP INDEX IF EXISTS public.idx_messages_sender_recent;
ALTER TABLE public.messages DROP COLUMN IF EXISTS reply_to_id;
ALTER TABLE public.messages DROP COLUMN IF EXISTS edited_at;
ALTER TABLE public.messages DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_group_has_no_array;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_title_len;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_avatar_emoji_len;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_max_members_cap;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_conversation_type_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_conversation_type_check
  CHECK (conversation_type IN ('direct', 'speed_date', 'sister'));
DROP INDEX IF EXISTS public.idx_conversations_created_by;
ALTER TABLE public.conversations DROP COLUMN IF EXISTS title;
ALTER TABLE public.conversations DROP COLUMN IF EXISTS avatar_emoji;
ALTER TABLE public.conversations DROP COLUMN IF EXISTS created_by;
ALTER TABLE public.conversations DROP COLUMN IF EXISTS max_members;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations, public.messages, public.friendships,
  public.message_reactions, public.community_members TO authenticated;
