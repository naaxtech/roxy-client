-- 135_chat_notifications.sql
--
-- CHAT-09 follow-up: an invite to a private community, and a request to join
-- one, now reach the right woman. Before this an invite waited silently in
-- Requests until she happened to open it, and moderators learned about a join
-- request only by opening Members.
--
--   community_invite         -> the invitee. Opens Messages with Requests open,
--                               where she answers Join / Not now.
--   community_join_request   -> every owner/admin/moderator of the community.
--                               Opens Members, where the queue is.
--
-- Rows go into public.notifications (the in-app list), so they also reach
-- push_outbox through 129's enqueue_push trigger when 129 is applied. The push
-- words are private (pushCore.ts): no community name and no note unless she
-- turned previews on. They ring on the community channel under the existing
-- 'community_chats' switch, the community category the app already has.
--
-- Safety: nothing is sent between a block-paired pair, to someone who muted
-- the sender, or twice for the same thing within a day (re-inviting or asking
-- again after a "not now" does not ping her again).
--
-- Applies after 133 (feed) and 134 (gate), which also widen
-- notifications_type_check: the constraint is rebuilt from whatever it lists
-- now plus the two new types, so no lane's type is dropped whatever the order.
-- Needs 132 (community_join_requests).

-- ── 1. Types ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_def   text;
  v_types text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';

  -- Every quoted literal in the current definition (IN (...) or = ANY (ARRAY[...])
  -- or a '{a,b}' array literal), plus the base set and the two new types.
  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_types
  FROM (
    SELECT btrim(x, ' "') AS t
    FROM regexp_matches(COALESCE(v_def, ''), '''([^'']*)''', 'g') AS m(lit),
         LATERAL regexp_split_to_table(translate(m.lit[1], '{}', ''), ',') AS x
    UNION
    SELECT unnest(ARRAY[
      'friend_request', 'friend_accept', 'community_event', 'message', 'channel_message',
      'community_invite', 'community_join_request'
    ])
  ) s
  WHERE t ~ '^[a-z_]+$';

  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))',
    v_types
  );
END $$;

-- ── 1b. 'Report conversation' survives 133 ───────────────────────────────
-- 132 added 'conversation' to reports.content_type (the header's "Report
-- conversation"); 133 then rebuilds that CHECK from a literal list written
-- before 132 and drops it, so every conversation report would fail with
-- 23514. Rebuild it as the union of what it allows now plus 'conversation'.
-- (__tests__/lib/reportContentTypes.test.ts reads the ARRAY below.)
DO $$
DECLARE
  v_def   text;
  v_types text[];
  reports_content_type_union text[];
BEGIN
  reports_content_type_union := ARRAY['conversation'];
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.reports'::regclass AND conname = 'reports_content_type_check';

  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_types
  FROM (
    SELECT btrim(x, ' "') AS t
    FROM regexp_matches(COALESCE(v_def, ''), '''([^'']*)''', 'g') AS m(lit),
         LATERAL regexp_split_to_table(translate(m.lit[1], '{}', ''), ',') AS x
    UNION
    SELECT unnest(reports_content_type_union)
  ) s
  WHERE t ~ '^[a-z_]+$';

  ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_content_type_check;
  EXECUTE format(
    'ALTER TABLE public.reports ADD CONSTRAINT reports_content_type_check CHECK (content_type = ANY (%L::text[]))',
    v_types
  );
END $$;

-- ── 2. Fan-out ───────────────────────────────────────────────────────────

-- Fires when a row becomes a pending invite or a pending request: a new row,
-- or a decided row opened again (a fresh invite, asking again after a week).
-- A pending invite re-sent while still pending is not news.
CREATE OR REPLACE FUNCTION public.notify_community_join_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name  text;
  v_actor uuid;
  v_actor_name text;
  v_link  text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND OLD.kind = NEW.kind THEN RETURN NEW; END IF;

  SELECT name INTO v_name FROM public.communities WHERE id = NEW.community_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.kind = 'invite' THEN
    v_actor := NEW.invited_by;
    IF v_actor IS NULL OR v_actor = NEW.user_id THEN RETURN NEW; END IF;
    IF public.blocked_pair(NEW.user_id, v_actor) THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.mutes mu WHERE mu.user_id = NEW.user_id AND mu.muted_user_id = v_actor) THEN
      RETURN NEW;
    END IF;
    v_link := '/messages?requests=1&community=' || NEW.community_id;
    -- Once a day at most for the same community: "not now" stays not now.
    IF EXISTS (SELECT 1 FROM public.notifications n
                WHERE n.user_id = NEW.user_id AND n.type = 'community_invite'
                  AND n.link_path = v_link AND n.created_at > now() - interval '1 day') THEN
      RETURN NEW;
    END IF;
    SELECT display_name INTO v_actor_name FROM public.profiles WHERE id = v_actor;
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
    VALUES (
      NEW.user_id, v_actor, 'community_invite',
      left(COALESCE(v_actor_name, 'A moderator'), 120) || ' invited you to ' || left(v_name, 60),
      'Join or say not now in Requests',
      v_link
    );
    RETURN NEW;
  END IF;

  -- kind = 'request': every moderator of the community hears about it.
  v_actor := NEW.user_id;
  v_link := '/community/members/' || NEW.community_id;
  SELECT display_name INTO v_actor_name FROM public.profiles WHERE id = v_actor;
  INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
  SELECT cm.user_id, v_actor, 'community_join_request',
         left(COALESCE(v_actor_name, 'Someone'), 120) || ' asked to join ' || left(v_name, 60),
         COALESCE(left(NEW.note, 120), 'Answer it in Members'),
         v_link
  FROM public.community_members cm
  WHERE cm.community_id = NEW.community_id
    -- the roles that hold the power, as is_community_moderator() (105) names them
    AND cm.role IN ('owner', 'admin', 'moderator')
    AND cm.user_id <> v_actor
    AND NOT public.blocked_pair(cm.user_id, v_actor)
    AND NOT EXISTS (SELECT 1 FROM public.mutes mu WHERE mu.user_id = cm.user_id AND mu.muted_user_id = v_actor)
    AND NOT EXISTS (SELECT 1 FROM public.notifications n
                     WHERE n.user_id = cm.user_id AND n.type = 'community_join_request'
                       AND n.actor_id = v_actor AND n.link_path = v_link
                       AND n.created_at > now() - interval '1 day');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A notification must never undo the invite or the request itself.
  RAISE WARNING 'notify_community_join_request failed: %', SQLERRM;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notify_community_join_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_join_requests_notify ON public.community_join_requests;
CREATE TRIGGER community_join_requests_notify
  AFTER INSERT OR UPDATE OF status, kind ON public.community_join_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_community_join_request();
