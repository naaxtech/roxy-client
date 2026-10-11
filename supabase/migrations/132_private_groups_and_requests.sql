-- 132_private_groups_and_requests.sql
--
-- Chat hardening for launch: private group chats, true request-first DMs, and
-- the write-path fixes from the chat audit (CHAT-01..05, 07, 09, 10, 12, 13, 15)
-- plus G-05 (friendships forge / block bypass) and the chat + community parts
-- of G-06 (unapproved accounts writing to members).
--
-- One membership model for every thread: public.conversation_members.
--   direct  -> two rows. The initiator is 'active'; the other woman is 'active'
--              when they are friends, otherwise 'request' until she answers.
--   group   -> one row per member (owner/admin/member), friends only in v1,
--              cap 32, a new member never sees what was said before she joined.
-- Every write to conversations / conversation_members goes through a
-- SECURITY DEFINER RPC below. Clients can no longer UPDATE or DELETE a
-- conversation (CHAT-03) and can change only content/deleted_at of their own
-- message, inside 15 minutes, with the original kept for moderators (CHAT-04).
--
-- Expand, then contract: participant_ids, conversation_type, the direct-insert
-- path (lib/directMessages.ts in builds before this release) and
-- mark_conversation_read all keep working. Existing direct threads are
-- backfilled into conversation_members here.

-- ── 1. Columns and shapes ────────────────────────────────────────────────

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS title        text,
  ADD COLUMN IF NOT EXISTS avatar_emoji text,
  ADD COLUMN IF NOT EXISTS created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS max_members  int NOT NULL DEFAULT 32;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_conversation_type_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_conversation_type_check
  CHECK (conversation_type IN ('direct', 'group', 'speed_date', 'sister'));

-- A group's membership lives in conversation_members only. Mirroring it into
-- participant_ids would re-open the array-shaped bypasses migration 103 closed.
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_group_has_no_array;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_group_has_no_array
  CHECK (conversation_type <> 'group' OR cardinality(participant_ids) = 0);
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_title_len;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_title_len
  CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 60);
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_avatar_emoji_len;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_avatar_emoji_len
  CHECK (avatar_emoji IS NULL OR char_length(avatar_emoji) BETWEEN 1 AND 16);
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_max_members_cap;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_max_members_cap
  CHECK (max_members BETWEEN 2 AND 32);

CREATE INDEX IF NOT EXISTS idx_conversations_created_by
  ON public.conversations (created_by, created_at DESC);

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at   timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;

-- 'system' rows ("Ana added Bea") are written only by the RPCs below.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'voice', 'roxy_suggestion', 'system'));
-- An unsent message keeps its row (reply previews, receipts) but loses its words.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS message_has_content;
ALTER TABLE public.messages ADD CONSTRAINT message_has_content
  CHECK (content IS NOT NULL OR media_url IS NOT NULL OR deleted_at IS NOT NULL);
-- CHAT-12. Longest message on production today is 2000 characters.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_len;
ALTER TABLE public.messages ADD CONSTRAINT messages_content_len
  CHECK (content IS NULL OR char_length(content) <= 4000);

CREATE INDEX IF NOT EXISTS idx_messages_sender_recent
  ON public.messages (sender_id, created_at DESC);

-- "Report conversation" (a whole DM or group). Before this the chat header had
-- to aim a report at "her latest message", and a group whose owner had not
-- written yet gave a moderator nothing to open. content_id = conversations.id.
-- reports is ops-owned; this one value was approved for the chat lane. Keep the
-- list literal: apps/mobile/__tests__/lib/reportContentTypes.test.ts parses
-- the last `content_type IN (...)` across migrations and compares it with the
-- client constant and the submit-report allowlist.
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_content_type_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_content_type_check
  CHECK (content_type IN (
    'message', 'post', 'profile', 'room', 'speed_date',
    'archive_entry', 'archive_review', 'conversation'
  ));

-- ── 2. New tables ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'request', 'declined', 'left', 'removed')),
  added_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  left_at         timestamptz,
  last_read_at    timestamptz,
  muted_until     timestamptz,
  hidden_at       timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_conversation_members_user
  ON public.conversation_members (user_id, status);

-- Per-woman chat preferences. Kept out of profiles (owned by the gate lane).
CREATE TABLE IF NOT EXISTS public.chat_settings (
  user_id              uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_receipts        boolean NOT NULL DEFAULT true,
  group_add_permission text NOT NULL DEFAULT 'friends' CHECK (group_add_permission IN ('friends', 'nobody')),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_settings ENABLE ROW LEVEL SECURITY;

-- Evidence: what a message said before its author edited or unsent it.
-- Staff only. Without this an abuser could soften or erase a message between
-- her screenshot and a moderator's look (CHAT-04).
CREATE TABLE IF NOT EXISTS public.message_revisions (
  id              bigserial PRIMARY KEY,
  message_id      uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  sender_id       uuid,
  action          text NOT NULL CHECK (action IN ('edit', 'unsend')),
  content         text,
  media_url       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_revisions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_message_revisions_message ON public.message_revisions (message_id);

-- CHAT-09: a removed woman must be able to stay removed.
CREATE TABLE IF NOT EXISTS public.community_bans (
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  banned_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason       text CHECK (reason IS NULL OR char_length(reason) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  PRIMARY KEY (community_id, user_id)
);
ALTER TABLE public.community_bans ENABLE ROW LEVEL SECURITY;

-- CHAT-09: the only doors into a private community. She asks and a moderator
-- says yes ('request'), or a moderator invites her and she says yes
-- ('invite'). One row per person per community; written only by the RPCs.
CREATE TABLE IF NOT EXISTS public.community_join_requests (
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('request', 'invite')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  note         text CHECK (note IS NULL OR char_length(note) <= 300),
  invited_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  PRIMARY KEY (community_id, user_id)
);
ALTER TABLE public.community_join_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_community_join_requests_pending
  ON public.community_join_requests (community_id, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_community_join_requests_user
  ON public.community_join_requests (user_id) WHERE status = 'pending';

-- CHAT-17: reactions in community channels. Same shape and rules as DM
-- message_reactions — one row per (message, woman, emoji), insert/delete only.
-- Other phones hear about them on the private chan:<id>:reactions topic.
CREATE TABLE IF NOT EXISTS public.community_channel_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.community_channel_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji      text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 8),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);
ALTER TABLE public.community_channel_reactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_community_channel_reactions_user
  ON public.community_channel_reactions (user_id);

-- ── 3. Helpers (SECURITY DEFINER so policies never recurse) ──────────────

CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conv uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = p_conv AND user_id = auth.uid()
      AND status IN ('active', 'request')
  );
$$;

CREATE OR REPLACE FUNCTION public.has_conversation_member_row(p_conv uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = p_conv AND user_id = auth.uid()
  );
$$;

-- Can the caller read a message with this sender/time in this conversation?
-- A group member sees only what was said after she joined.
CREATE OR REPLACE FUNCTION public.can_read_message(p_conv uuid, p_sender uuid, p_created timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.conversation_members cm
       JOIN public.conversations c ON c.id = cm.conversation_id
       WHERE cm.conversation_id = p_conv
         AND cm.user_id = auth.uid()
         AND cm.status IN ('active', 'request')
         AND (c.conversation_type <> 'group' OR p_created >= cm.joined_at)
     )
     AND NOT public.blocked_pair(auth.uid(), p_sender)
     AND NOT public.blocked_in_conversation(p_conv);
$$;

CREATE OR REPLACE FUNCTION public.can_read_message_id(p_message uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message
      AND m.deleted_at IS NULL
      AND public.can_read_message(m.conversation_id, m.sender_id, m.created_at)
  );
$$;

-- The caller may post here: an ACTIVE member (a request recipient accepts
-- first), nobody in the thread is block-paired with her.
CREATE OR REPLACE FUNCTION public.can_send_message(p_conv uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.conversation_members
       WHERE conversation_id = p_conv AND user_id = auth.uid() AND status = 'active'
     )
     AND NOT public.blocked_in_conversation(p_conv);
$$;

-- Only two kinds of image reach a chat: a GIPHY CDN gif (what the GIF picker
-- sends) or a file in Roxy's own chat-media bucket under this conversation.
-- Anything else is a tracking pixel or unsolicited content (CHAT-07).
CREATE OR REPLACE FUNCTION public.is_allowed_chat_media(p_url text, p_conv uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  -- (Postgres caps a regex repetition count at 255, hence `+` plus a length check.)
  SELECT p_url IS NOT NULL AND char_length(p_url) <= 500 AND (
    p_url ~ '^https://(media[0-9]?|i)\.giphy\.com/media/[A-Za-z0-9/_.?=&%-]+$'
    OR p_url ~ ('^chat-media/' || p_conv::text || '/[A-Za-z0-9._-]+$')
  );
$$;

-- 20 new conversations (direct or group) per rolling day (CHAT-12).
CREATE OR REPLACE FUNCTION public.chat_new_conversation_allowed()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    SELECT count(*) FROM public.conversations
    WHERE created_by = auth.uid() AND created_at > now() - interval '1 day'
  ) < 20;
$$;

-- Every rule a client's message must pass, for auth.uid(). Raises on refusal.
-- Called by the (invoker) insert trigger; calling it directly is a dry run.
-- Silent (returns) when she is not in the thread: RLS refuses that insert and
-- an error here would confirm the thread exists.
CREATE OR REPLACE FUNCTION public.chat_check_message_insert(p_conv uuid, p_type text, p_media text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type   text;
  v_status text;
  v_other  text;
  v_sent   int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT conversation_type INTO v_type FROM public.conversations WHERE id = p_conv;
  SELECT status INTO v_status FROM public.conversation_members
   WHERE conversation_id = p_conv AND user_id = auth.uid();
  IF v_type IS NULL OR v_status IS NULL THEN
    RETURN;
  END IF;

  IF p_media IS NOT NULL AND NOT public.is_allowed_chat_media(p_media, p_conv) THEN
    RAISE EXCEPTION 'media_not_allowed: that image cannot be sent here' USING ERRCODE = '42501';
  END IF;

  -- 30 messages a minute per sender across all threads (CHAT-12).
  PERFORM pg_advisory_xact_lock(4208, hashtext(auth.uid()::text));
  IF (SELECT count(*) FROM public.messages
       WHERE sender_id = auth.uid() AND created_at > now() - interval '1 minute') >= 30 THEN
    RAISE EXCEPTION 'rate_limited: slow down a moment' USING ERRCODE = 'PT429';
  END IF;

  IF v_type = 'direct' AND v_status = 'active' THEN
    SELECT status INTO v_other FROM public.conversation_members
     WHERE conversation_id = p_conv AND user_id <> auth.uid()
     LIMIT 1;
    IF v_other = 'declined' THEN
      RAISE EXCEPTION 'request_declined: this message request was not accepted' USING ERRCODE = '42501';
    END IF;
    IF v_other = 'request' THEN
      IF p_type <> 'text' OR p_media IS NOT NULL THEN
        RAISE EXCEPTION 'request_text_only: photos and GIFs unlock once she accepts' USING ERRCODE = '42501';
      END IF;
      SELECT count(*) INTO v_sent FROM public.messages
       WHERE conversation_id = p_conv AND sender_id = auth.uid();
      IF v_sent >= 3 THEN
        RAISE EXCEPTION 'request_cap: you can send 3 messages until she accepts' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
END $$;

-- Copy a message's CURRENT words into message_revisions before her edit or
-- unsend lands. Only her own live message; it copies, it never takes text in,
-- so calling it directly cannot forge evidence.
CREATE OR REPLACE FUNCTION public.chat_record_revision(p_message uuid, p_action text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_action NOT IN ('edit', 'unsend') THEN
    RAISE EXCEPTION 'invalid action' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.message_revisions (message_id, conversation_id, sender_id, action, content, media_url)
  SELECT m.id, m.conversation_id, m.sender_id, p_action, m.content, m.media_url
  FROM public.messages m
  WHERE m.id = p_message AND m.sender_id = auth.uid() AND m.deleted_at IS NULL;
END $$;

-- May p_adder put p_user into p_conv? Friends only (v1), her own setting, no
-- block between her and the adder or ANY active member, approved account.
CREATE OR REPLACE FUNCTION public.chat_can_add_to_group(p_adder uuid, p_user uuid, p_conv uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL
     AND p_user <> p_adder
     AND public.are_friends(p_adder, p_user)
     AND NOT public.blocked_pair(p_adder, p_user)
     AND EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = p_user
         AND coalesce(p.is_active, true)
         AND p.vetting_status IN ('approved', 'unvetted')
     )
     AND coalesce((SELECT s.group_add_permission FROM public.chat_settings s WHERE s.user_id = p_user), 'friends') = 'friends'
     AND NOT EXISTS (
       SELECT 1 FROM public.conversation_members m
       WHERE m.conversation_id = p_conv AND m.status = 'active'
         AND public.blocked_pair(m.user_id, p_user)
     );
$$;

CREATE OR REPLACE FUNCTION public.chat_display_name(p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT left(coalesce((SELECT display_name FROM public.profiles WHERE id = p_user), 'Someone'), 60);
$$;

CREATE OR REPLACE FUNCTION public.is_banned_from_community(p_community uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_bans b
    WHERE b.community_id = p_community AND b.user_id = p_user
      AND (b.expires_at IS NULL OR b.expires_at > now())
  );
$$;

-- An invitee may see the community she was invited to (name, crest) before
-- she says yes; nobody else learns a private community exists.
CREATE OR REPLACE FUNCTION public.has_community_invite(p_community uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_join_requests r
    WHERE r.community_id = p_community AND r.user_id = auth.uid()
      AND r.kind = 'invite' AND r.status = 'pending'
  );
$$;

-- Private Realtime topics: 'conv:<uuid>:typing' and 'conv:<uuid>:reactions'.
CREATE OR REPLACE FUNCTION public.realtime_conversation_topic_ok(p_topic text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_topic IS NULL OR p_topic !~ '^conv:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(typing|reactions)$' THEN
    RETURN false;
  END IF;
  v_id := split_part(p_topic, ':', 2)::uuid;
  RETURN public.is_conversation_member(v_id) AND NOT public.blocked_in_conversation(v_id);
END $$;

-- CHAT-17: a community channel message she may read (member of its
-- community, not banned, sender not block-paired with her). Reactions ride on
-- this, so a reaction never reaches a message she cannot see.
CREATE OR REPLACE FUNCTION public.can_read_channel_message(p_message uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_channel_messages m
    JOIN public.community_channels c ON c.id = m.channel_id
    WHERE m.id = p_message
      AND public.is_community_member(c.community_id)
      AND NOT public.is_banned_from_community(c.community_id, auth.uid())
      AND NOT public.blocked_pair(auth.uid(), m.sender_id)
  );
$$;

-- CHAT-17: private broadcast topics chan:<channel id>:typing|reactions admit
-- members of the channel's community who are not banned from it.
CREATE OR REPLACE FUNCTION public.realtime_channel_topic_ok(p_topic text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_community uuid;
BEGIN
  IF p_topic IS NULL OR p_topic !~ '^chan:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(typing|reactions)$' THEN
    RETURN false;
  END IF;
  SELECT community_id INTO v_community FROM public.community_channels WHERE id = split_part(p_topic, ':', 2)::uuid;
  IF v_community IS NULL THEN RETURN false; END IF;
  RETURN public.is_community_member(v_community)
     AND NOT public.is_banned_from_community(v_community, auth.uid());
END $$;

-- ── 4. Backfill existing threads ─────────────────────────────────────────
-- Direct: a woman is 'active' when they are friends or she has written in the
-- thread; in an empty thread the first element (every client wrote
-- [me, them]) is the initiator. Everyone else lands in Requests: prod has
-- 6 of 11 direct threads between non-friends, which is what CHAT-02 is about.
-- last_read_at: the newest message she has read or written.
INSERT INTO public.conversation_members (conversation_id, user_id, role, status, joined_at, last_read_at)
SELECT c.id,
       u.uid,
       'member',
       CASE
         WHEN c.conversation_type <> 'direct' THEN 'active'
         WHEN public.are_friends(c.participant_ids[1], c.participant_ids[2]) THEN 'active'
         WHEN EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id AND m.sender_id = u.uid) THEN 'active'
         WHEN u.ord = 1 AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id) THEN 'active'
         ELSE 'request'
       END,
       coalesce(c.created_at, now()),
       (SELECT max(m.created_at) FROM public.messages m
         WHERE m.conversation_id = c.id
           AND (m.sender_id = u.uid OR (m.sender_id IS DISTINCT FROM u.uid AND m.is_read)))
FROM public.conversations c
CROSS JOIN LATERAL unnest(c.participant_ids) WITH ORDINALITY AS u(uid, ord)
WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.uid)
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- ── 5. Triggers ──────────────────────────────────────────────────────────

-- The old non-definer copy of this trigger would fail once authenticated
-- loses UPDATE on conversations, and take every message insert with it.
ALTER FUNCTION public.update_conversation_last_message() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.update_conversation_last_message_at() SECURITY DEFINER SET search_path = public;

-- SECURITY INVOKER on purpose: current_user is then the role that wrote the
-- row. A definer trigger always sees its owner and could not tell a client
-- insert from one made inside an RPC.
CREATE OR REPLACE FUNCTION public.conversations_guard_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- Only a client is policed here; RPCs and the service role set their own.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  NEW.created_by := auth.uid();
  NEW.created_at := now();
  NEW.last_message_at := NULL;
  NEW.roxy_nudge_count := 0;
  NEW.roxy_wingwoman_count_today := 0;
  NEW.title := NULL;
  NEW.avatar_emoji := NULL;
  IF NOT public.chat_new_conversation_allowed() THEN
    RAISE EXCEPTION 'rate_limited: you have started a lot of new chats today, try again tomorrow'
      USING ERRCODE = 'PT429';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS conversations_guard_insert ON public.conversations;
CREATE TRIGGER conversations_guard_insert
  BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_guard_insert();

-- Membership rows for threads created by the legacy direct insert (older
-- builds) and by the service role (speed dates). Groups seed their own.
CREATE OR REPLACE FUNCTION public.conversations_seed_members()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid;
BEGIN
  IF NEW.conversation_type = 'group' THEN
    RETURN NULL;
  END IF;
  FOR v_user IN SELECT DISTINCT p FROM unnest(NEW.participant_ids) AS p LOOP
    INSERT INTO public.conversation_members (conversation_id, user_id, role, status, added_by, joined_at)
    VALUES (
      NEW.id, v_user, 'member',
      CASE
        WHEN NEW.conversation_type <> 'direct' OR NEW.created_by IS NULL THEN 'active'
        WHEN v_user = NEW.created_by THEN 'active'
        WHEN public.are_friends(v_user, NEW.created_by) THEN 'active'
        ELSE 'request'
      END,
      NEW.created_by,
      coalesce(NEW.created_at, now())
    )
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS conversations_seed_members ON public.conversations;
CREATE TRIGGER conversations_seed_members
  AFTER INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_seed_members();

-- Message writes from a client: server clock, rate limit, request rules, media.
CREATE OR REPLACE FUNCTION public.messages_guard_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  NEW.created_at := now();
  NEW.is_read := false;
  NEW.edited_at := NULL;
  NEW.deleted_at := NULL;

  -- A reply points into the same thread, at a message she can read (RLS).
  IF NEW.reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.messages r WHERE r.id = NEW.reply_to_id AND r.conversation_id = NEW.conversation_id
  ) THEN
    NEW.reply_to_id := NULL;
  END IF;

  PERFORM public.chat_check_message_insert(NEW.conversation_id, NEW.message_type, NEW.media_url);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_guard_insert ON public.messages;
CREATE TRIGGER messages_guard_insert
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_guard_insert();

-- Edit / unsend: her own message, within 15 minutes, words only. Everything
-- else on the row is frozen, and the previous text is kept for moderators.
CREATE OR REPLACE FUNCTION public.messages_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF OLD.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'only the sender can change a message' USING ERRCODE = '42501';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'that message was unsent' USING ERRCODE = '42501';
  END IF;
  IF OLD.message_type NOT IN ('text', 'image') THEN
    RAISE EXCEPTION 'that message cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF now() - OLD.created_at > interval '15 minutes' THEN
    RAISE EXCEPTION 'edit_window: messages can be edited or unsent for 15 minutes' USING ERRCODE = '42501';
  END IF;

  NEW.id := OLD.id;
  NEW.conversation_id := OLD.conversation_id;
  NEW.sender_id := OLD.sender_id;
  NEW.message_type := OLD.message_type;
  NEW.created_at := OLD.created_at;
  NEW.reply_to_id := OLD.reply_to_id;
  NEW.is_read := OLD.is_read;

  IF NEW.deleted_at IS NOT NULL THEN
    PERFORM public.chat_record_revision(OLD.id, 'unsend');
    NEW.deleted_at := now();
    NEW.content := NULL;
    NEW.media_url := NULL;
    NEW.edited_at := OLD.edited_at;
    RETURN NEW;
  END IF;

  NEW.media_url := OLD.media_url;
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    IF OLD.message_type <> 'text' OR NEW.content IS NULL OR btrim(NEW.content) = '' THEN
      RAISE EXCEPTION 'only text can be edited, and not to nothing (unsend instead)' USING ERRCODE = '22023';
    END IF;
    PERFORM public.chat_record_revision(OLD.id, 'edit');
    NEW.edited_at := now();
  ELSE
    NEW.edited_at := OLD.edited_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_guard_update ON public.messages;
CREATE TRIGGER messages_guard_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_guard_update();

-- Channel posts: server clock and the same 30-a-minute cap.
CREATE OR REPLACE FUNCTION public.channel_messages_guard_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  NEW.created_at := now();
  NEW.edited_at := NULL;
  NEW.deleted_at := NULL;
  PERFORM pg_advisory_xact_lock(4209, hashtext(auth.uid()::text));
  IF (SELECT count(*) FROM public.community_channel_messages
       WHERE sender_id = auth.uid() AND created_at > now() - interval '1 minute') >= 30 THEN
    RAISE EXCEPTION 'rate_limited: slow down a moment' USING ERRCODE = 'PT429';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS channel_messages_guard_insert ON public.community_channel_messages;
CREATE TRIGGER channel_messages_guard_insert
  BEFORE INSERT ON public.community_channel_messages
  FOR EACH ROW EXECUTE FUNCTION public.channel_messages_guard_insert();

-- Bell rows for direct + group messages. Never for a message request (no
-- push, no text: CHAT-02/14), a muted thread, a muted or block-paired sender.
CREATE OR REPLACE FUNCTION public.notify_direct_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv        public.conversations%ROWTYPE;
  v_sender_name text;
  v_preview     text;
  v_title       text;
BEGIN
  IF NEW.sender_id IS NULL OR NEW.message_type = 'system' THEN RETURN NEW; END IF;
  SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_conv.id IS NULL OR v_conv.conversation_type NOT IN ('direct', 'group') THEN RETURN NEW; END IF;

  v_sender_name := public.chat_display_name(NEW.sender_id);
  v_preview := CASE
    WHEN NEW.message_type = 'image' THEN '📷 sent a photo'
    WHEN NEW.content IS NULL OR btrim(NEW.content) = '' THEN 'sent a message'
    ELSE left(NEW.content, 120)
  END;
  v_title := CASE
    WHEN v_conv.conversation_type = 'group'
      THEN v_sender_name || ' in ' || left(coalesce(v_conv.title, 'your group'), 60)
    ELSE v_sender_name || ' sent you a message'
  END;

  INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
  SELECT cm.user_id, NEW.sender_id, 'message', v_title, v_preview, '/chat/' || NEW.conversation_id
  FROM public.conversation_members cm
  WHERE cm.conversation_id = NEW.conversation_id
    AND cm.user_id <> NEW.sender_id
    AND cm.status = 'active'
    AND (cm.muted_until IS NULL OR cm.muted_until <= now())
    AND NOT public.blocked_pair(cm.user_id, NEW.sender_id)
    AND NOT EXISTS (SELECT 1 FROM public.mutes mu WHERE mu.user_id = cm.user_id AND mu.muted_user_id = NEW.sender_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_direct_message failed: %', SQLERRM;
  RETURN NEW;
END $$;

-- CHAT-10: the channel bell skips block-paired and muted senders, and the banned.
CREATE OR REPLACE FUNCTION public.notify_channel_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel_name text;
  v_comm_id      uuid;
  v_sender_name  text;
BEGIN
  IF NEW.sender_id IS NULL THEN RETURN NEW; END IF;

  SELECT community_id, slug INTO v_comm_id, v_channel_name
  FROM public.community_channels WHERE id = NEW.channel_id;
  IF v_comm_id IS NULL THEN RETURN NEW; END IF;

  SELECT display_name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;

  INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
  SELECT cm.user_id, NEW.sender_id, 'channel_message',
         left(COALESCE(v_sender_name, 'Someone'), 150) || ' in #' || left(v_channel_name, 40),
         left(NEW.body, 120),
         '/community/channels/' || v_comm_id
  FROM public.community_members cm
  WHERE cm.community_id = v_comm_id
    AND cm.notify_messages = true
    AND cm.user_id <> NEW.sender_id
    AND NOT public.blocked_pair(cm.user_id, NEW.sender_id)
    AND NOT EXISTS (SELECT 1 FROM public.mutes mu WHERE mu.user_id = cm.user_id AND mu.muted_user_id = NEW.sender_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_channel_message failed: %', SQLERRM;
  RETURN NEW;
END $$;

-- Becoming friends answers a waiting message request between them.
CREATE OR REPLACE FUNCTION public.friendships_promote_requests()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    UPDATE public.conversation_members cm
       SET status = 'active'
      FROM public.conversations c
     WHERE c.id = cm.conversation_id
       AND c.conversation_type = 'direct'
       AND public.sorted_uuids(c.participant_ids) = public.sorted_uuids(ARRAY[NEW.requester_id, NEW.addressee_id])
       AND cm.status = 'request';
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'friendships_promote_requests failed: %', SQLERRM;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS friendships_promote_requests ON public.friendships;
CREATE TRIGGER friendships_promote_requests
  AFTER UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.friendships_promote_requests();

-- ── 6. Policies ──────────────────────────────────────────────────────────

-- conversations: read your threads, create a direct one (legacy path), nothing else.
DROP POLICY IF EXISTS conversations_participant ON public.conversations;
DROP POLICY IF EXISTS conversations_select_member ON public.conversations;
DROP POLICY IF EXISTS conversations_insert_direct ON public.conversations;
CREATE POLICY conversations_select_member ON public.conversations
  FOR SELECT TO authenticated
  USING (
    (public.is_conversation_member(id)
      -- The row a legacy client is inserting has no member rows yet: RETURNING
      -- is checked before the AFTER trigger seeds them.
      OR (conversation_type <> 'group' AND auth.uid() = ANY (participant_ids)
          AND NOT public.has_conversation_member_row(id)))
    AND NOT public.blocked_in_conversation(id)
  );
CREATE POLICY conversations_insert_direct ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    conversation_type = 'direct'
    AND auth.uid() = ANY (participant_ids)
    AND public.is_approved_member()
    AND NOT EXISTS (
      SELECT 1 FROM unnest(participant_ids) AS p(pid)
      WHERE public.blocked_pair(auth.uid(), p.pid)
    )
  );

DROP POLICY IF EXISTS conversation_members_select ON public.conversation_members;
CREATE POLICY conversation_members_select ON public.conversation_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS chat_settings_select_own ON public.chat_settings;
CREATE POLICY chat_settings_select_own ON public.chat_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS message_revisions_select_staff ON public.message_revisions;
CREATE POLICY message_revisions_select_staff ON public.message_revisions
  FOR SELECT TO authenticated USING (public.is_roxy_staff());

-- messages
DROP POLICY IF EXISTS messages_participant ON public.messages;
DROP POLICY IF EXISTS messages_insert_participant ON public.messages;
DROP POLICY IF EXISTS messages_update_own ON public.messages;
DROP POLICY IF EXISTS messages_select_member ON public.messages;
DROP POLICY IF EXISTS messages_insert_member ON public.messages;
DROP POLICY IF EXISTS messages_update_sender ON public.messages;
CREATE POLICY messages_select_member ON public.messages
  FOR SELECT TO authenticated
  USING (public.can_read_message(conversation_id, sender_id, created_at));
-- CHAT-05: roxy_suggestion / system / voice are never a client's to write.
CREATE POLICY messages_insert_member ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND message_type IN ('text', 'image')
    AND public.is_approved_member()
    AND public.can_send_message(conversation_id)
  );
CREATE POLICY messages_update_sender ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() AND public.can_send_message(conversation_id))
  WITH CHECK (sender_id = auth.uid());

-- reactions (CHAT-15): only on a message she can read.
DROP POLICY IF EXISTS reactions_select ON public.message_reactions;
DROP POLICY IF EXISTS reactions_insert ON public.message_reactions;
CREATE POLICY reactions_select ON public.message_reactions
  FOR SELECT TO authenticated
  USING (public.can_read_message_id(message_id));
CREATE POLICY reactions_insert ON public.message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_approved_member() AND public.can_read_message_id(message_id));

-- channel reactions (CHAT-17): read and write only on a channel message she
-- can read; a block-paired reactor is invisible both ways; delete only her own.
DROP POLICY IF EXISTS channel_reactions_select ON public.community_channel_reactions;
DROP POLICY IF EXISTS channel_reactions_insert ON public.community_channel_reactions;
DROP POLICY IF EXISTS channel_reactions_delete ON public.community_channel_reactions;
CREATE POLICY channel_reactions_select ON public.community_channel_reactions
  FOR SELECT TO authenticated
  USING (public.can_read_channel_message(message_id) AND NOT public.blocked_pair(auth.uid(), user_id));
CREATE POLICY channel_reactions_insert ON public.community_channel_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_approved_member() AND public.can_read_channel_message(message_id));
CREATE POLICY channel_reactions_delete ON public.community_channel_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- friendships (G-05): a request is only ever 'pending' from its requester; only
-- the addressee accepts; nobody but its author can touch a block.
DROP POLICY IF EXISTS friendships_own ON public.friendships;
DROP POLICY IF EXISTS friendships_select_own ON public.friendships;
DROP POLICY IF EXISTS friendships_insert_request ON public.friendships;
DROP POLICY IF EXISTS friendships_accept ON public.friendships;
DROP POLICY IF EXISTS friendships_delete_own ON public.friendships;
CREATE POLICY friendships_select_own ON public.friendships
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR (addressee_id = auth.uid() AND status <> 'blocked'));
CREATE POLICY friendships_insert_request ON public.friendships
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND status = 'pending'
    AND public.is_approved_member()
    AND NOT public.blocked_pair(requester_id, addressee_id)
  );
CREATE POLICY friendships_accept ON public.friendships
  FOR UPDATE TO authenticated
  USING (addressee_id = auth.uid() AND status = 'pending')
  WITH CHECK (addressee_id = auth.uid() AND status = 'accepted' AND public.is_approved_member());
CREATE POLICY friendships_delete_own ON public.friendships
  FOR DELETE TO authenticated
  USING ((requester_id = auth.uid() OR addressee_id = auth.uid()) AND status <> 'blocked');

-- community_members (CHAT-09, G-06): approved, public community, not banned.
DROP POLICY IF EXISTS cm_insert_own ON public.community_members;
DROP POLICY IF EXISTS cm_delete_own ON public.community_members;
DROP POLICY IF EXISTS cm_read_community_member ON public.community_members;
DROP POLICY IF EXISTS cm_read_own ON public.community_members;
CREATE POLICY cm_insert_own ON public.community_members
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND role = 'member'
    AND public.is_approved_member()
    AND EXISTS (SELECT 1 FROM public.communities c WHERE c.id = community_id AND NOT coalesce(c.is_private, false))
    AND NOT public.is_banned_from_community(community_id, auth.uid())
  );
CREATE POLICY cm_delete_own ON public.community_members
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY cm_read_community_member ON public.community_members
  FOR SELECT TO authenticated USING (public.is_community_member(community_id));
CREATE POLICY cm_read_own ON public.community_members
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS community_bans_select ON public.community_bans;
CREATE POLICY community_bans_select ON public.community_bans
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_community_moderator(community_id) OR public.is_roxy_staff());

-- Join requests / invites: she sees her own; moderators see their community's.
-- Writes go through request_to_join_community / respond_join_request /
-- invite_to_community / respond_community_invite only.
DROP POLICY IF EXISTS community_join_requests_select ON public.community_join_requests;
CREATE POLICY community_join_requests_select ON public.community_join_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_community_moderator(community_id) OR public.is_roxy_staff());

-- communities: the policies 003/015 left on PUBLIC (anon included) are
-- re-scoped TO authenticated, same rules. An invitee may read the community
-- she was invited to, so the invite can show its name before she says yes.
DROP POLICY IF EXISTS communities_read_member ON public.communities;
CREATE POLICY communities_read_member ON public.communities
  FOR SELECT TO authenticated USING (public.is_community_member(id));
DROP POLICY IF EXISTS communities_read_invited ON public.communities;
CREATE POLICY communities_read_invited ON public.communities
  FOR SELECT TO authenticated USING (public.has_community_invite(id));
DROP POLICY IF EXISTS communities_update_own ON public.communities;
CREATE POLICY communities_update_own ON public.communities
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- channel messages (CHAT-10): block-paired senders vanish both ways.
DROP POLICY IF EXISTS "members read channel messages" ON public.community_channel_messages;
CREATE POLICY "members read channel messages" ON public.community_channel_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_channels c
      WHERE c.id = community_channel_messages.channel_id
        AND public.is_community_member(c.community_id)
    )
    AND NOT public.blocked_pair(auth.uid(), sender_id)
  );
DROP POLICY IF EXISTS "members post as themselves" ON public.community_channel_messages;
CREATE POLICY "members post as themselves" ON public.community_channel_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.community_channels c
      WHERE c.id = community_channel_messages.channel_id
        AND public.is_community_member(c.community_id)
        AND NOT public.is_banned_from_community(c.community_id, auth.uid())
    )
  );

-- G-06: an unapproved account cannot create a community.
DROP POLICY IF EXISTS communities_insert_auth ON public.communities;
CREATE POLICY communities_insert_auth ON public.communities
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid() AND public.is_approved_member());

CREATE OR REPLACE FUNCTION public.create_community(p_name text, p_slug text, p_description text, p_category text, p_is_private boolean DEFAULT false)
RETURNS public.communities
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_community public.communities;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'approved members only' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.communities (name, slug, description, category, is_private, created_by)
  VALUES (p_name, p_slug, p_description, p_category, p_is_private, auth.uid())
  RETURNING * INTO v_community;

  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (v_community.id, auth.uid(), 'admin');

  RETURN v_community;
END;
$$;

-- Private Realtime broadcast (typing, reactions): members of the thread only.
DROP POLICY IF EXISTS "chat members receive conversation broadcasts" ON realtime.messages;
DROP POLICY IF EXISTS "chat members send conversation broadcasts" ON realtime.messages;
CREATE POLICY "chat members receive conversation broadcasts" ON realtime.messages
  FOR SELECT TO authenticated
  USING (extension IN ('broadcast', 'presence') AND public.realtime_conversation_topic_ok(realtime.topic()));
CREATE POLICY "chat members send conversation broadcasts" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (extension IN ('broadcast', 'presence') AND public.realtime_conversation_topic_ok(realtime.topic()));
-- CHAT-17: the same for community channels (chan:<id>:typing|reactions).
DROP POLICY IF EXISTS "community members receive channel broadcasts" ON realtime.messages;
DROP POLICY IF EXISTS "community members send channel broadcasts" ON realtime.messages;
CREATE POLICY "community members receive channel broadcasts" ON realtime.messages
  FOR SELECT TO authenticated
  USING (extension IN ('broadcast', 'presence') AND public.realtime_channel_topic_ok(realtime.topic()));
CREATE POLICY "community members send channel broadcasts" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (extension IN ('broadcast', 'presence') AND public.realtime_channel_topic_ok(realtime.topic()));

-- ── 7. Grants on the tables this lane owns ───────────────────────────────

REVOKE ALL ON public.conversations, public.messages, public.conversation_members, public.friendships,
              public.message_reactions, public.community_members, public.community_channel_messages,
              public.chat_settings, public.message_revisions, public.community_bans,
              public.community_join_requests
  FROM anon;
REVOKE ALL ON public.conversation_members, public.chat_settings, public.message_revisions, public.community_bans,
              public.community_join_requests
  FROM PUBLIC;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.conversations, public.messages, public.friendships,
              public.message_reactions, public.community_members
  FROM authenticated;

-- CHAT-03: no client UPDATE/DELETE on a conversation.
REVOKE UPDATE, DELETE ON public.conversations FROM authenticated;
GRANT SELECT, INSERT ON public.conversations TO authenticated;
-- CHAT-04: words and the unsend flag only; no DELETE (evidence).
REVOKE UPDATE, DELETE ON public.messages FROM authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT UPDATE (content, deleted_at) ON public.messages TO authenticated;
REVOKE UPDATE ON public.friendships FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.friendships TO authenticated;
GRANT UPDATE (status) ON public.friendships TO authenticated;
REVOKE UPDATE ON public.message_reactions FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.message_reactions TO authenticated;
-- CHAT-17: a reaction is added or taken back, never edited.
REVOKE ALL ON public.community_channel_reactions FROM anon, PUBLIC;
REVOKE UPDATE, TRUNCATE, TRIGGER, REFERENCES ON public.community_channel_reactions FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.community_channel_reactions TO authenticated;
REVOKE UPDATE ON public.community_members FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.community_members TO authenticated;
GRANT SELECT ON public.conversation_members, public.chat_settings, public.message_revisions, public.community_bans,
              public.community_join_requests
  TO authenticated;
-- RPC-written tables: Supabase's default privileges hand authenticated ALL on
-- every new table. RLS already makes a write a 0-row no-op; take the grant
-- away too, so a direct write is refused outright (42501), not "ok 0".
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.conversation_members, public.chat_settings, public.message_revisions, public.community_bans,
     public.community_join_requests
  FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversation_members') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;
  END IF;
END $$;

-- ── 8. RPCs ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_require_member()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'approved members only' USING ERRCODE = '42501';
  END IF;
  RETURN auth.uid();
END $$;

-- Find or open the 1:1 thread. Friends -> both active. Otherwise her
-- dm_permission decides (enforce_dm_permission) and a stranger's thread opens
-- as a request on her side.
CREATE OR REPLACE FUNCTION public.start_direct(p_user uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me   uuid := public.chat_require_member();
  v_conv uuid;
BEGIN
  IF p_user IS NULL OR p_user = v_me THEN
    RAISE EXCEPTION 'pick someone else to message' USING ERRCODE = '22023';
  END IF;
  -- A block reads the same as an account that is gone: never confirm a block.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND coalesce(is_active, true))
     OR public.blocked_pair(v_me, p_user) THEN
    RAISE EXCEPTION 'that account is not available' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_conv FROM public.conversations
   WHERE conversation_type = 'direct'
     AND public.sorted_uuids(participant_ids) = public.sorted_uuids(ARRAY[v_me, p_user])
   LIMIT 1;

  IF v_conv IS NULL THEN
    IF NOT public.chat_new_conversation_allowed() THEN
      RAISE EXCEPTION 'rate_limited: you have started a lot of new chats today, try again tomorrow'
        USING ERRCODE = 'PT429';
    END IF;
    BEGIN
      INSERT INTO public.conversations (participant_ids, conversation_type, created_by)
      VALUES (ARRAY[v_me, p_user], 'direct', v_me)
      RETURNING id INTO v_conv;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_conv FROM public.conversations
       WHERE conversation_type = 'direct'
         AND public.sorted_uuids(participant_ids) = public.sorted_uuids(ARRAY[v_me, p_user])
       LIMIT 1;
    END;
  END IF;

  -- Legacy threads may predate their member rows.
  INSERT INTO public.conversation_members (conversation_id, user_id, status, added_by)
  VALUES (v_conv, v_me, 'active', v_me)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
  INSERT INTO public.conversation_members (conversation_id, user_id, status, added_by)
  VALUES (v_conv, p_user, CASE WHEN public.are_friends(v_me, p_user) THEN 'active' ELSE 'request' END, v_me)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  -- Opening it herself answers any request on her side and un-hides it.
  UPDATE public.conversation_members
     SET status = 'active', hidden_at = NULL
   WHERE conversation_id = v_conv AND user_id = v_me;
  -- Friends since the request? Then it is not a request any more.
  IF public.are_friends(v_me, p_user) THEN
    UPDATE public.conversation_members SET status = 'active'
     WHERE conversation_id = v_conv AND user_id = p_user AND status = 'request';
  END IF;
  RETURN v_conv;
END $$;

CREATE OR REPLACE FUNCTION public.respond_message_request(p_conv uuid, p_accept boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_new text := CASE WHEN p_accept THEN 'active' ELSE 'declined' END;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  -- Declining is always allowed; accepting means writing to someone, so approved only.
  IF p_accept AND NOT public.is_approved_member() THEN
    RAISE EXCEPTION 'approved members only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.conversation_members
     SET status = v_new,
         hidden_at = CASE WHEN p_accept THEN NULL ELSE now() END,
         last_read_at = now()
   WHERE conversation_id = p_conv AND user_id = v_me AND status = 'request';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no message request here' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.chat_system_message(p_conv uuid, p_actor uuid, p_text text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type)
  VALUES (p_conv, p_actor, left(p_text, 300), 'system');
$$;

CREATE OR REPLACE FUNCTION public.create_group(p_title text, p_member_ids uuid[], p_emoji text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    uuid := public.chat_require_member();
  v_ids   uuid[];
  v_conv  uuid;
  v_id    uuid;
  v_added int := 0;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
BEGIN
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_member_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL AND x <> v_me);
  IF cardinality(v_ids) < 2 THEN
    RAISE EXCEPTION 'a group needs at least two friends — one is a direct message' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) > 31 THEN
    RAISE EXCEPTION 'groups hold up to 32 people' USING ERRCODE = '22023';
  END IF;
  IF v_title IS NOT NULL AND char_length(v_title) > 60 THEN
    RAISE EXCEPTION 'group names are up to 60 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT public.chat_new_conversation_allowed() THEN
    RAISE EXCEPTION 'rate_limited: you have started a lot of new chats today, try again tomorrow'
      USING ERRCODE = 'PT429';
  END IF;

  INSERT INTO public.conversations (participant_ids, conversation_type, title, avatar_emoji, created_by)
  VALUES ('{}', 'group', v_title, nullif(btrim(coalesce(p_emoji, '')), ''), v_me)
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_members (conversation_id, user_id, role, status, added_by, joined_at, last_read_at)
  VALUES (v_conv, v_me, 'owner', 'active', v_me, now(), now());

  FOREACH v_id IN ARRAY v_ids LOOP
    -- Checked one at a time against the members already in, so two women who
    -- blocked each other are never put in one room. Skipped silently: the
    -- creator must not learn who blocked whom.
    IF public.chat_can_add_to_group(v_me, v_id, v_conv) THEN
      INSERT INTO public.conversation_members (conversation_id, user_id, role, status, added_by, joined_at)
      VALUES (v_conv, v_id, 'member', 'active', v_me, now());
      v_added := v_added + 1;
    END IF;
  END LOOP;

  IF v_added = 0 THEN
    RAISE EXCEPTION 'none of those friends can be added to a group right now' USING ERRCODE = '22023';
  END IF;

  PERFORM public.chat_system_message(v_conv, v_me, public.chat_display_name(v_me) || ' started the group');
  RETURN v_conv;
END $$;

CREATE OR REPLACE FUNCTION public.chat_my_group_role(p_conv uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cm.role FROM public.conversation_members cm
  JOIN public.conversations c ON c.id = cm.conversation_id AND c.conversation_type = 'group'
  WHERE cm.conversation_id = p_conv AND cm.user_id = auth.uid() AND cm.status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.add_group_members(p_conv uuid, p_ids uuid[])
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me     uuid := public.chat_require_member();
  v_role   text := public.chat_my_group_role(p_conv);
  v_id     uuid;
  v_status text;
  v_count  int;
  v_names  text[] := '{}';
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'group not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.conversations WHERE id = p_conv FOR UPDATE;

  FOREACH v_id IN ARRAY ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL) LOOP
    SELECT count(*) INTO v_count FROM public.conversation_members WHERE conversation_id = p_conv AND status = 'active';
    IF v_count >= 32 THEN
      RAISE EXCEPTION 'groups hold up to 32 people' USING ERRCODE = '22023';
    END IF;
    SELECT status INTO v_status FROM public.conversation_members WHERE conversation_id = p_conv AND user_id = v_id;
    IF v_status = 'active' THEN CONTINUE; END IF;
    -- Someone an admin removed comes back only by an admin's hand.
    IF v_status = 'removed' AND v_role NOT IN ('owner', 'admin') THEN CONTINUE; END IF;
    IF NOT public.chat_can_add_to_group(v_me, v_id, p_conv) THEN CONTINUE; END IF;

    INSERT INTO public.conversation_members (conversation_id, user_id, role, status, added_by, joined_at)
    VALUES (p_conv, v_id, 'member', 'active', v_me, now())
    ON CONFLICT (conversation_id, user_id) DO UPDATE
      SET status = 'active', role = 'member', added_by = v_me, joined_at = now(),
          left_at = NULL, last_read_at = NULL, hidden_at = NULL;
    v_names := v_names || public.chat_display_name(v_id);
  END LOOP;

  IF cardinality(v_names) > 0 THEN
    PERFORM public.chat_system_message(p_conv, v_me,
      public.chat_display_name(v_me) || ' added ' || array_to_string(v_names, ', '));
  END IF;
  RETURN cardinality(v_names);
END $$;

CREATE OR REPLACE FUNCTION public.remove_group_member(p_conv uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_role  text := public.chat_my_group_role(p_conv);
  v_their text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF v_role IS NULL THEN RAISE EXCEPTION 'group not found' USING ERRCODE = 'P0002'; END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'only the group owner or an admin can remove people' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_their FROM public.conversation_members
   WHERE conversation_id = p_conv AND user_id = p_user AND status = 'active';
  IF v_their IS NULL OR p_user = v_me THEN
    RAISE EXCEPTION 'that person is not in this group' USING ERRCODE = 'P0002';
  END IF;
  IF v_their = 'owner' OR (v_their = 'admin' AND v_role <> 'owner') THEN
    RAISE EXCEPTION 'you cannot remove someone at your level or above' USING ERRCODE = '42501';
  END IF;
  UPDATE public.conversation_members SET status = 'removed', left_at = now()
   WHERE conversation_id = p_conv AND user_id = p_user;
  PERFORM public.chat_system_message(p_conv, v_me,
    public.chat_display_name(v_me) || ' removed ' || public.chat_display_name(p_user));
END $$;

CREATE OR REPLACE FUNCTION public.leave_group(p_conv uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me   uuid := auth.uid();
  v_role text := public.chat_my_group_role(p_conv);
  v_next uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF v_role IS NULL THEN RAISE EXCEPTION 'group not found' USING ERRCODE = 'P0002'; END IF;
  -- System line first: once she has left she can no longer be its sender of record.
  PERFORM public.chat_system_message(p_conv, v_me, public.chat_display_name(v_me) || ' left the group');
  UPDATE public.conversation_members SET status = 'left', left_at = now(), role = 'member'
   WHERE conversation_id = p_conv AND user_id = v_me;
  IF v_role = 'owner' THEN
    SELECT user_id INTO v_next FROM public.conversation_members
     WHERE conversation_id = p_conv AND status = 'active'
     ORDER BY (role = 'admin') DESC, joined_at
     LIMIT 1;
    IF v_next IS NOT NULL THEN
      UPDATE public.conversation_members SET role = 'owner'
       WHERE conversation_id = p_conv AND user_id = v_next;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_group_role(p_conv uuid, p_user uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'invalid role' USING ERRCODE = '22023';
  END IF;
  IF public.chat_my_group_role(p_conv) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only the group owner can change roles' USING ERRCODE = '42501';
  END IF;
  UPDATE public.conversation_members SET role = p_role
   WHERE conversation_id = p_conv AND user_id = p_user AND status = 'active' AND role <> 'owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that person is not in this group' USING ERRCODE = 'P0002';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rename_group(p_conv uuid, p_title text, p_emoji text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role  text := public.chat_my_group_role(p_conv);
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
BEGIN
  IF v_role IS NULL THEN RAISE EXCEPTION 'group not found' USING ERRCODE = 'P0002'; END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'only the group owner or an admin can rename it' USING ERRCODE = '42501';
  END IF;
  IF v_title IS NOT NULL AND char_length(v_title) > 60 THEN
    RAISE EXCEPTION 'group names are up to 60 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE public.conversations
     SET title = v_title, avatar_emoji = nullif(btrim(coalesce(p_emoji, '')), '')
   WHERE id = p_conv;
  PERFORM public.chat_system_message(p_conv, auth.uid(),
    public.chat_display_name(auth.uid()) || CASE WHEN v_title IS NULL THEN ' cleared the group name'
                                                 ELSE ' named the group ' || v_title END);
END $$;

CREATE OR REPLACE FUNCTION public.mute_conversation(p_conv uuid, p_until timestamptz)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  UPDATE public.conversation_members SET muted_until = p_until
   WHERE conversation_id = p_conv AND user_id = auth.uid() AND status IN ('active', 'request');
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002'; END IF;
END $$;

-- "Delete chat" for her only. It comes back when a new message arrives.
CREATE OR REPLACE FUNCTION public.hide_conversation(p_conv uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  UPDATE public.conversation_members SET hidden_at = now(), last_read_at = now()
   WHERE conversation_id = p_conv AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_chat_settings(p_read_receipts boolean DEFAULT NULL, p_group_add_permission text DEFAULT NULL)
RETURNS public.chat_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.chat_settings;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.chat_settings (user_id, read_receipts, group_add_permission)
  VALUES (auth.uid(), coalesce(p_read_receipts, true), coalesce(p_group_add_permission, 'friends'))
  ON CONFLICT (user_id) DO UPDATE
    SET read_receipts = coalesce(p_read_receipts, public.chat_settings.read_receipts),
        group_add_permission = coalesce(p_group_add_permission, public.chat_settings.group_add_permission),
        updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- One read model for every thread (CHAT-13): last_read_at. is_read stays as
-- the visible receipt, sent only by an active member who has receipts on.
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status   text;
  v_marked   integer := 0;
  v_receipts boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.conversation_members
   WHERE conversation_id = p_conversation_id AND user_id = auth.uid();
  IF v_status IS NULL OR v_status NOT IN ('active', 'request') THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.conversation_members SET last_read_at = now()
   WHERE conversation_id = p_conversation_id AND user_id = auth.uid();

  v_receipts := coalesce((SELECT read_receipts FROM public.chat_settings WHERE user_id = auth.uid()), true);
  -- A stranger never learns that her request was read.
  IF v_status = 'active' AND v_receipts THEN
    UPDATE public.messages
       SET is_read = true
     WHERE conversation_id = p_conversation_id
       AND sender_id <> auth.uid()
       AND is_read = false;
    GET DIAGNOSTICS v_marked = ROW_COUNT;
  END IF;

  UPDATE public.notifications SET read_at = now()
   WHERE user_id = auth.uid() AND link_path = '/chat/' || p_conversation_id AND read_at IS NULL;
  RETURN v_marked;
END $$;

-- The Messages tab in one round trip: every thread she is in (or has been
-- asked into) with its last line, unread count and up to four faces.
CREATE OR REPLACE FUNCTION public.inbox_summary()
RETURNS TABLE (
  conversation_id   uuid,
  conversation_type text,
  title             text,
  avatar_emoji      text,
  my_status         text,
  my_role           text,
  muted_until       timestamptz,
  hidden_at         timestamptz,
  last_message_at   timestamptz,
  created_at        timestamptz,
  created_by        uuid,
  last_message      jsonb,
  unread            int,
  member_count      int,
  members           jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.conversation_type, c.title, c.avatar_emoji, me.status, me.role,
         me.muted_until, me.hidden_at, c.last_message_at, c.created_at, c.created_by,
         (SELECT jsonb_build_object(
                   'id', m.id, 'sender_id', m.sender_id, 'message_type', m.message_type,
                   'content', CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE left(m.content, 140) END,
                   'deleted', m.deleted_at IS NOT NULL, 'created_at', m.created_at, 'is_read', m.is_read)
            FROM public.messages m
           WHERE m.conversation_id = c.id
             AND (c.conversation_type <> 'group' OR m.created_at >= me.joined_at)
             AND NOT public.blocked_pair(auth.uid(), m.sender_id)
           ORDER BY m.created_at DESC
           LIMIT 1),
         (SELECT count(*)::int
            FROM public.messages m
           WHERE m.conversation_id = c.id
             AND m.sender_id IS DISTINCT FROM auth.uid()
             AND m.deleted_at IS NULL
             AND m.message_type <> 'system'
             AND m.created_at > coalesce(me.last_read_at, me.joined_at, '-infinity'::timestamptz)
             AND (c.conversation_type <> 'group' OR m.created_at >= me.joined_at)
             AND NOT public.blocked_pair(auth.uid(), m.sender_id)),
         (SELECT count(*)::int FROM public.conversation_members x
           WHERE x.conversation_id = c.id AND x.status = 'active'),
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', p.id, 'display_name', p.display_name, 'username', p.username,
                    'avatar_url', p.avatar_url, 'last_seen_at', p.last_seen_at,
                    'status', x.status, 'role', x.role) ORDER BY x.joined_at)
             FROM (SELECT * FROM public.conversation_members x
                    WHERE x.conversation_id = c.id AND x.user_id <> auth.uid()
                      AND (x.status IN ('active', 'request') OR c.conversation_type = 'direct')
                    ORDER BY x.joined_at
                    LIMIT 4) x
             JOIN public.profiles p ON p.id = x.user_id), '[]'::jsonb)
  FROM public.conversation_members me
  JOIN public.conversations c ON c.id = me.conversation_id
  WHERE me.user_id = auth.uid()
    AND me.status IN ('active', 'request')
    AND c.conversation_type IN ('direct', 'group')
    AND NOT public.blocked_in_conversation(c.id)
  ORDER BY coalesce(c.last_message_at, c.created_at) DESC NULLS LAST;
$$;

-- The tab badge, from the server only (CHAT-13): unread chats (not muted, not
-- hidden-and-quiet), message requests with at least one message, friend
-- requests, and community-chat unread.
CREATE OR REPLACE FUNCTION public.messages_badge()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH inbox AS (
    SELECT * FROM public.inbox_summary()
  ), comm AS (
    SELECT coalesce(sum(u.unread), 0)::int AS n
    FROM public.community_channel_unread(ARRAY(
      SELECT community_id FROM public.community_members WHERE user_id = auth.uid()
    )) u
  )
  SELECT jsonb_build_object(
    'chats', (SELECT coalesce(sum(unread), 0)::int FROM inbox
               WHERE my_status = 'active'
                 AND (muted_until IS NULL OR muted_until <= now())
                 AND (hidden_at IS NULL OR last_message_at > hidden_at)),
    'message_requests', (SELECT count(*)::int FROM inbox
                          WHERE my_status = 'request' AND last_message IS NOT NULL),
    'friend_requests', (SELECT count(*)::int FROM public.friendships
                         WHERE addressee_id = auth.uid() AND status = 'pending'),
    'communities', (SELECT n FROM comm)
  );
$$;

-- CHAT-09: moderators can remove (and ban) members below their rank.
CREATE OR REPLACE FUNCTION public.remove_community_member(p_community uuid, p_user uuid, p_ban boolean DEFAULT false, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_staff    boolean := public.is_roxy_staff();
  v_my_role  text;
  v_their    text;
  v_rank_me  int;
  v_rank_her int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_user IS NULL OR p_user = v_me THEN
    RAISE EXCEPTION 'pick someone else' USING ERRCODE = '22023';
  END IF;
  IF NOT v_staff AND NOT public.is_community_moderator(p_community) THEN
    RAISE EXCEPTION 'only moderators can remove members' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_my_role FROM public.community_members WHERE community_id = p_community AND user_id = v_me;
  SELECT role INTO v_their FROM public.community_members WHERE community_id = p_community AND user_id = p_user;
  IF v_their IS NULL AND NOT p_ban THEN
    RAISE EXCEPTION 'that person is not a member' USING ERRCODE = 'P0002';
  END IF;
  v_rank_me := CASE v_my_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'moderator' THEN 2 WHEN 'border_patrol' THEN 1 ELSE 0 END;
  v_rank_her := CASE v_their WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'moderator' THEN 2 WHEN 'border_patrol' THEN 1 ELSE 0 END;
  IF NOT v_staff AND v_rank_her >= v_rank_me THEN
    RAISE EXCEPTION 'you cannot remove someone at your level or above' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.community_members WHERE community_id = p_community AND user_id = p_user;
  IF p_ban THEN
    INSERT INTO public.community_bans (community_id, user_id, banned_by, reason)
    VALUES (p_community, p_user, v_me, left(p_reason, 500))
    ON CONFLICT (community_id, user_id) DO UPDATE
      SET banned_by = excluded.banned_by, reason = excluded.reason, created_at = now(), expires_at = NULL;
    -- A ban also closes any open request or invite she has here.
    UPDATE public.community_join_requests
       SET status = 'declined', decided_by = v_me, decided_at = now()
     WHERE community_id = p_community AND user_id = p_user AND status = 'pending';
  END IF;
  INSERT INTO public.community_role_changes (community_id, user_id, old_role, new_role, changed_by)
  VALUES (p_community, p_user, v_their, CASE WHEN p_ban THEN 'banned' ELSE 'removed' END, v_me);
END $$;

CREATE OR REPLACE FUNCTION public.unban_community_member(p_community uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_roxy_staff() AND NOT public.is_community_moderator(p_community) THEN
    RAISE EXCEPTION 'only moderators can lift a ban' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.community_bans WHERE community_id = p_community AND user_id = p_user;
  INSERT INTO public.community_role_changes (community_id, user_id, old_role, new_role, changed_by)
  VALUES (p_community, p_user, 'banned', 'unbanned', auth.uid());
END $$;

-- CHAT-09: joining. A public community opens at once; a private one takes a
-- request a moderator approves, or a moderator's invite she accepts. A ban
-- closes both doors. Returns 'joined' | 'requested' | 'member'.
CREATE OR REPLACE FUNCTION public.request_to_join_community(p_community uuid, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me      uuid := public.chat_require_member();
  v_private boolean;
  v_row     public.community_join_requests%ROWTYPE;
BEGIN
  SELECT coalesce(is_private, false) INTO v_private FROM public.communities WHERE id = p_community;
  IF NOT FOUND THEN RAISE EXCEPTION 'community not found' USING ERRCODE = 'P0002'; END IF;
  IF public.is_banned_from_community(p_community, v_me) THEN
    RAISE EXCEPTION 'you can''t join this community' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.community_members WHERE community_id = p_community AND user_id = v_me) THEN
    RETURN 'member';
  END IF;

  SELECT * INTO v_row FROM public.community_join_requests
   WHERE community_id = p_community AND user_id = v_me FOR UPDATE;

  -- Asked in already: saying yes to her invite is the same as joining.
  IF NOT v_private OR (v_row.kind = 'invite' AND v_row.status = 'pending') THEN
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (p_community, v_me, 'member') ON CONFLICT DO NOTHING;
    UPDATE public.community_join_requests SET status = 'approved', decided_at = now()
     WHERE community_id = p_community AND user_id = v_me AND status = 'pending';
    RETURN 'joined';
  END IF;

  IF v_row.status = 'pending' THEN RETURN 'requested'; END IF;
  -- A declined request can be asked again after a week, not hammered.
  IF v_row.status = 'declined' AND v_row.decided_at > now() - interval '7 days' THEN
    RAISE EXCEPTION 'you can ask to join again in a few days' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.community_join_requests (community_id, user_id, kind, status, note)
  VALUES (p_community, v_me, 'request', 'pending', left(nullif(btrim(coalesce(p_note, '')), ''), 300))
  ON CONFLICT (community_id, user_id) DO UPDATE
    SET kind = 'request', status = 'pending', note = excluded.note, invited_by = NULL,
        decided_by = NULL, decided_at = NULL, created_at = now();
  RETURN 'requested';
END $$;

-- A moderator answers a request. Approving adds her as a member.
CREATE OR REPLACE FUNCTION public.respond_join_request(p_community uuid, p_user uuid, p_approve boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_roxy_staff() AND NOT public.is_community_moderator(p_community) THEN
    RAISE EXCEPTION 'only moderators can answer join requests' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_join_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
         decided_by = v_me, decided_at = now()
   WHERE community_id = p_community AND user_id = p_user AND kind = 'request' AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'that request is no longer open' USING ERRCODE = 'P0002'; END IF;
  IF p_approve THEN
    IF public.is_banned_from_community(p_community, p_user) THEN
      RAISE EXCEPTION 'that person is banned from this community' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (p_community, p_user, 'member') ON CONFLICT DO NOTHING;
    INSERT INTO public.community_role_changes (community_id, user_id, old_role, new_role, changed_by)
    VALUES (p_community, p_user, 'requested', 'member', v_me);
  END IF;
END $$;

-- A moderator invites an approved member who is not banned or block-paired
-- with her. Returns 'invited', or 'joined' when that person had already asked.
CREATE OR REPLACE FUNCTION public.invite_to_community(p_community uuid, p_user uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.chat_require_member();
BEGIN
  IF NOT public.is_roxy_staff() AND NOT public.is_community_moderator(p_community) THEN
    RAISE EXCEPTION 'only moderators can invite people' USING ERRCODE = '42501';
  END IF;
  IF p_user IS NULL OR p_user = v_me THEN RAISE EXCEPTION 'pick someone else' USING ERRCODE = '22023'; END IF;
  IF public.blocked_pair(v_me, p_user)
     OR public.is_banned_from_community(p_community, p_user)
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user AND coalesce(p.is_active, true)
                     AND p.vetting_status = 'approved') THEN
    RAISE EXCEPTION 'that person can''t be invited' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.community_members WHERE community_id = p_community AND user_id = p_user) THEN
    RETURN 'member';
  END IF;
  -- She already asked: an invite from a moderator is a yes.
  IF EXISTS (SELECT 1 FROM public.community_join_requests
              WHERE community_id = p_community AND user_id = p_user AND kind = 'request' AND status = 'pending') THEN
    PERFORM public.respond_join_request(p_community, p_user, true);
    RETURN 'joined';
  END IF;
  INSERT INTO public.community_join_requests (community_id, user_id, kind, status, invited_by)
  VALUES (p_community, p_user, 'invite', 'pending', v_me)
  ON CONFLICT (community_id, user_id) DO UPDATE
    SET kind = 'invite', status = 'pending', invited_by = v_me, note = NULL,
        decided_by = NULL, decided_at = NULL, created_at = now();
  RETURN 'invited';
END $$;

-- The invitee says yes or no. No is private: the inviter is not told.
CREATE OR REPLACE FUNCTION public.respond_community_invite(p_community uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.chat_require_member();
BEGIN
  UPDATE public.community_join_requests
     SET status = CASE WHEN p_accept THEN 'approved' ELSE 'declined' END, decided_by = v_me, decided_at = now()
   WHERE community_id = p_community AND user_id = v_me AND kind = 'invite' AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'that invite is no longer open' USING ERRCODE = 'P0002'; END IF;
  IF p_accept THEN
    IF public.is_banned_from_community(p_community, v_me) THEN
      RAISE EXCEPTION 'you can''t join this community' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (p_community, v_me, 'member') ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ── 9. Function privileges ───────────────────────────────────────────────

REVOKE ALL ON FUNCTION
  public.is_conversation_member(uuid),
  public.has_conversation_member_row(uuid),
  public.can_read_message(uuid, uuid, timestamptz),
  public.can_read_message_id(uuid),
  public.can_send_message(uuid),
  public.is_allowed_chat_media(text, uuid),
  public.chat_new_conversation_allowed(),
  public.chat_check_message_insert(uuid, text, text),
  public.chat_record_revision(uuid, text),
  public.chat_can_add_to_group(uuid, uuid, uuid),
  public.chat_display_name(uuid),
  public.is_banned_from_community(uuid, uuid),
  public.realtime_conversation_topic_ok(text),
  public.can_read_channel_message(uuid),
  public.realtime_channel_topic_ok(text),
  public.chat_require_member(),
  public.friendships_promote_requests(),
  public.chat_system_message(uuid, uuid, text),
  public.chat_my_group_role(uuid),
  public.conversations_guard_insert(),
  public.conversations_seed_members(),
  public.messages_guard_insert(),
  public.messages_guard_update(),
  public.channel_messages_guard_insert(),
  public.notify_direct_message(),
  public.notify_channel_message(),
  public.start_direct(uuid),
  public.respond_message_request(uuid, boolean),
  public.create_group(text, uuid[], text),
  public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid),
  public.leave_group(uuid),
  public.set_group_role(uuid, uuid, text),
  public.rename_group(uuid, text, text),
  public.mute_conversation(uuid, timestamptz),
  public.hide_conversation(uuid),
  public.set_chat_settings(boolean, text),
  public.mark_conversation_read(uuid),
  public.inbox_summary(),
  public.messages_badge(),
  public.remove_community_member(uuid, uuid, boolean, text),
  public.unban_community_member(uuid, uuid),
  public.create_community(text, text, text, text, boolean),
  public.has_community_invite(uuid),
  public.request_to_join_community(uuid, text),
  public.respond_join_request(uuid, uuid, boolean),
  public.invite_to_community(uuid, uuid),
  public.respond_community_invite(uuid, boolean)
FROM PUBLIC, anon;

-- Trigger functions and internals are nobody's to call directly.
REVOKE ALL ON FUNCTION
  public.chat_system_message(uuid, uuid, text),
  public.conversations_guard_insert(),
  public.conversations_seed_members(),
  public.messages_guard_insert(),
  public.messages_guard_update(),
  public.channel_messages_guard_insert(),
  public.notify_direct_message(),
  public.notify_channel_message(),
  public.friendships_promote_requests(),
  public.chat_require_member()
FROM authenticated;

-- Policy helpers run as the caller's role inside RLS, so authenticated needs them.
GRANT EXECUTE ON FUNCTION
  public.is_conversation_member(uuid),
  public.has_conversation_member_row(uuid),
  public.can_read_message(uuid, uuid, timestamptz),
  public.can_read_message_id(uuid),
  public.can_send_message(uuid),
  public.is_allowed_chat_media(text, uuid),
  public.chat_new_conversation_allowed(),
  public.chat_check_message_insert(uuid, text, text),
  public.chat_record_revision(uuid, text),
  public.chat_can_add_to_group(uuid, uuid, uuid),
  public.chat_display_name(uuid),
  public.is_banned_from_community(uuid, uuid),
  public.realtime_conversation_topic_ok(text),
  public.can_read_channel_message(uuid),
  public.realtime_channel_topic_ok(text),
  public.chat_my_group_role(uuid),
  public.start_direct(uuid),
  public.respond_message_request(uuid, boolean),
  public.create_group(text, uuid[], text),
  public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid),
  public.leave_group(uuid),
  public.set_group_role(uuid, uuid, text),
  public.rename_group(uuid, text, text),
  public.mute_conversation(uuid, timestamptz),
  public.hide_conversation(uuid),
  public.set_chat_settings(boolean, text),
  public.mark_conversation_read(uuid),
  public.inbox_summary(),
  public.messages_badge(),
  public.remove_community_member(uuid, uuid, boolean, text),
  public.unban_community_member(uuid, uuid),
  public.create_community(text, text, text, text, boolean),
  public.has_community_invite(uuid),
  public.request_to_join_community(uuid, text),
  public.respond_join_request(uuid, uuid, boolean),
  public.invite_to_community(uuid, uuid),
  public.respond_community_invite(uuid, boolean)
TO authenticated;
