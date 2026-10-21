-- 136 — per-member post reactions (Roxy v2 Feed, lane feed).
--
-- Why: the v2 rail shows HER reaction (her emoji on a pinkContainer disc) and
-- the post's total. `posts.reaction_counts` is a tally, not a ballot
-- (`increment_reaction`, 010/131), so after a reload nobody knew which emoji
-- she had given and the rail fell back to the empty "add reaction" glyph.
--
-- What:
--   1. `post_reaction_members` — one row per (post, member): her ONE reaction
--      from POST_REACTIONS (apps/mobile/lib/postReactions.ts). RLS: she reads
--      only her own rows (no "who reacted" list, by design); nobody writes
--      directly — writes go through (2).
--   2. `set_post_reaction(post, emoji | NULL)` — set, switch or clear her
--      reaction and keep the tally in step, atomically, under a row lock on the
--      post. Her legacy v0 like (`post_likes`, the heart) is folded in: it read
--      as her ❤️ until now, so the first reaction (or a clear) removes it and
--      she is counted exactly once (rail total = like_count + emoji tallies).
--   3. `notify_post_reaction` loses the ✿ (Nicole 2026-10-21: no flower
--      anywhere) and also fires for (1), so a reaction still tells the author.
--
-- Expand only: `posts.reaction_counts`, `post_likes`, `like_count` and
-- `increment_reaction` are untouched, so installed builds keep working.
-- Down: supabase/downs/136_post_reaction_members_down.sql.
-- Proof: supabase/tests/136_post_reaction_members_check.sql.

-- ── 1. her reaction, one per post ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.post_reaction_members (
  post_id    uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT post_reaction_members_emoji_check CHECK (
    emoji = ANY (ARRAY[U&'\2764\FE0F', U&'\+01F602', U&'\+01F62E',
                       U&'\+01F622', U&'\+01F621', U&'\+01F49C'])
  )
);

-- The rail asks "which of these posts did I react to": her id first.
CREATE INDEX IF NOT EXISTS post_reaction_members_user_idx
  ON public.post_reaction_members (user_id, post_id);

ALTER TABLE public.post_reaction_members ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges hand anon and authenticated ALL on a new
-- table. Members read their own rows; every write goes through the RPC.
REVOKE ALL ON TABLE public.post_reaction_members FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.post_reaction_members FROM authenticated;
GRANT SELECT ON TABLE public.post_reaction_members TO authenticated;

DROP POLICY IF EXISTS prm_select_own ON public.post_reaction_members;
CREATE POLICY prm_select_own ON public.post_reaction_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.post_reaction_members IS
  'Her own reaction to a post (one of POST_REACTIONS). Read: own rows only. Write: set_post_reaction(). The tally stays in posts.reaction_counts.';

-- ── 2. set, switch or clear her reaction ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_post_reaction(p_post_id uuid, p_emoji text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_counts jsonb;
  v_old    text;
  v_likes  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to react' USING ERRCODE = '42501';
  END IF;
  IF p_emoji IS NOT NULL AND NOT (
       p_emoji = ANY (ARRAY[U&'\2764\FE0F', U&'\+01F602', U&'\+01F62E',
                            U&'\+01F622', U&'\+01F621', U&'\+01F49C'])
     ) THEN
    RAISE EXCEPTION 'That is not a reaction' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(public.can_read_post(p_post_id), false) THEN
    RAISE EXCEPTION 'Post not found' USING ERRCODE = '42501';
  END IF;

  -- The row lock serialises two taps (hers on two phones, or two women at
  -- once): the tally is read-modify-write here.
  SELECT coalesce(reaction_counts, '{}'::jsonb) INTO v_counts
  FROM public.posts
  WHERE id = p_post_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found' USING ERRCODE = '42501';
  END IF;

  SELECT emoji INTO v_old
  FROM public.post_reaction_members
  WHERE post_id = p_post_id AND user_id = v_uid
  FOR UPDATE;

  -- Her v0 like was her ❤️. Any answer from her now replaces it, so she is
  -- counted once: like_count drops by one (trg_post_like_count) as the tally
  -- takes her reaction.
  DELETE FROM public.post_likes WHERE post_id = p_post_id AND user_id = v_uid;

  IF v_old IS DISTINCT FROM p_emoji THEN
    IF v_old IS NOT NULL THEN
      v_counts := jsonb_set(v_counts, ARRAY[v_old],
        to_jsonb(greatest(coalesce((v_counts->>v_old)::int, 0) - 1, 0)));
    END IF;

    IF p_emoji IS NOT NULL THEN
      v_counts := jsonb_set(v_counts, ARRAY[p_emoji],
        to_jsonb(coalesce((v_counts->>p_emoji)::int, 0) + 1));
      INSERT INTO public.post_reaction_members (post_id, user_id, emoji)
      VALUES (p_post_id, v_uid, p_emoji)
      ON CONFLICT (post_id, user_id)
      DO UPDATE SET emoji = EXCLUDED.emoji, updated_at = now();
    ELSE
      DELETE FROM public.post_reaction_members
      WHERE post_id = p_post_id AND user_id = v_uid;
    END IF;

    UPDATE public.posts SET reaction_counts = v_counts WHERE id = p_post_id;
  END IF;

  SELECT like_count INTO v_likes FROM public.posts WHERE id = p_post_id;
  RETURN jsonb_build_object('mine', p_emoji, 'counts', v_counts, 'like_count', v_likes);
END $$;

REVOKE ALL ON FUNCTION public.set_post_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_post_reaction(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.set_post_reaction(uuid, text) IS
  'Set (emoji), switch or clear (NULL) the caller''s reaction to a post; keeps posts.reaction_counts in step and folds in her legacy post_likes row. Returns {mine, counts, like_count}.';

-- ── 3. the author hears about it, without a flower ─────────────────────────
-- Same body as 133 except the title. Fires for post_likes (installed builds)
-- and post_reaction_members (v2); both tables carry post_id + user_id.
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
          left(COALESCE(v_name, 'Someone'), 150) || ' reacted to your post', NULL, v_link);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_post_reaction failed: %', SQLERRM;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.notify_post_reaction() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_post_reaction_member ON public.post_reaction_members;
CREATE TRIGGER trg_notify_post_reaction_member
  AFTER INSERT OR DELETE ON public.post_reaction_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_post_reaction();
