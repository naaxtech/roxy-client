-- 136 down — reverses 136_post_reaction_members.sql.
-- Run only inside a transaction you have backed up. Drops every member's own
-- reaction row; the tallies in posts.reaction_counts stay as they are (they
-- were kept in step by set_post_reaction), so the counts on screen survive.
-- Legacy likes that set_post_reaction folded into a reaction are NOT restored.
-- destructive-ok: down file

DROP TRIGGER IF EXISTS trg_notify_post_reaction_member ON public.post_reaction_members;
DROP FUNCTION IF EXISTS public.set_post_reaction(uuid, text);
DROP TABLE IF EXISTS public.post_reaction_members;

-- notify_post_reaction exactly as 133 left it (title with the ✿).
CREATE OR REPLACE FUNCTION public.notify_post_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author uuid;
  v_type   text;
  v_link   text;
  v_name   text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.notifications
     WHERE type = 'post_reaction'
       AND actor_id = OLD.user_id
       AND read_at IS NULL
       AND link_path LIKE '%/' || OLD.post_id::text;
    RETURN NULL;
  END IF;

  SELECT author_id, post_type INTO v_author, v_type
  FROM public.posts WHERE id = NEW.post_id AND deleted_at IS NULL;
  IF NOT public.notify_allowed(v_author, NEW.user_id) THEN RETURN NULL; END IF;

  v_link := CASE WHEN v_type = 'video' THEN '/community/video/' ELSE '/community/post/' END
            || NEW.post_id::text;

  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = v_author AND actor_id = NEW.user_id
      AND type = 'post_reaction' AND link_path = v_link
  ) THEN
    RETURN NULL;
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE id = NEW.user_id;
  INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
  VALUES (v_author, NEW.user_id, 'post_reaction',
          left(COALESCE(v_name, 'Someone'), 150) || ' sent your post a ✿', NULL, v_link);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_post_reaction failed: %', SQLERRM;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.notify_post_reaction() FROM PUBLIC, anon, authenticated;
