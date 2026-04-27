-- ── 1. Extend posts ─────────────────────────────────────────────────────────
ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_post_type_check,
  ADD CONSTRAINT posts_post_type_check CHECK (
    post_type IN ('standard','event','poll','resource','photo','gallery','video','roxy_link')
  ),
  ADD COLUMN IF NOT EXISTS video_url              text,
  ADD COLUMN IF NOT EXISTS video_thumbnail_url    text,
  ADD COLUMN IF NOT EXISTS video_duration_secs    integer,
  ADD COLUMN IF NOT EXISTS video_aspect_ratio     text
    CHECK (video_aspect_ratio IN ('4:5','16:9','1:1')),
  ADD COLUMN IF NOT EXISTS link_type              text
    CHECK (link_type IN ('game','room','event')),
  ADD COLUMN IF NOT EXISTS link_entity_id         uuid,
  ADD COLUMN IF NOT EXISTS link_community_id      uuid
    REFERENCES public.communities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS like_count             integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS save_count             integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feed_score             float   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS community_resonance    float   NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS blurhash               text,
  ADD COLUMN IF NOT EXISTS deleted_at             timestamptz,
  ADD COLUMN IF NOT EXISTS post_tags              text[]  DEFAULT '{}';

-- Soft-delete index
CREATE INDEX IF NOT EXISTS idx_posts_deleted
  ON public.posts(deleted_at) WHERE deleted_at IS NOT NULL;

-- Feed score index
CREATE INDEX IF NOT EXISTS idx_posts_feed_score
  ON public.posts(community_id, feed_score DESC)
  WHERE deleted_at IS NULL;

-- ── 2. Extend comments ───────────────────────────────────────────────────────
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_id  uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS like_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_url  text,
  ADD COLUMN IF NOT EXISTS gif_url    text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Allow null content when media/gif present
ALTER TABLE public.comments
  DROP CONSTRAINT IF EXISTS comments_content_check;
ALTER TABLE public.comments
  ADD CONSTRAINT comments_content_check CHECK (
    (content IS NULL OR char_length(content) <= 1000) AND
    (content IS NOT NULL OR media_url IS NOT NULL OR gif_url IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON public.comments(parent_id) WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comments_post_top
  ON public.comments(post_id, created_at)
  WHERE parent_id IS NULL AND deleted_at IS NULL;

-- ── 3. post_likes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.post_likes (
  post_id    uuid NOT NULL REFERENCES public.posts(id)    ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_select" ON public.post_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_insert" ON public.post_likes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "pl_delete" ON public.post_likes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.sync_post_like_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE public.posts SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_post_like_count ON public.post_likes;
CREATE TRIGGER trg_post_like_count
  AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_like_count();

-- ── 4. post_saves ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.post_saves (
  post_id    uuid NOT NULL REFERENCES public.posts(id)    ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
ALTER TABLE public.post_saves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps_select" ON public.post_saves FOR SELECT TO authenticated USING (true);
CREATE POLICY "ps_insert" ON public.post_saves FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "ps_delete" ON public.post_saves FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.sync_post_save_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET save_count = save_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE public.posts SET save_count = GREATEST(0, save_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_post_save_count ON public.post_saves;
CREATE TRIGGER trg_post_save_count
  AFTER INSERT OR DELETE ON public.post_saves
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_save_count();

-- ── 5. comment_likes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comment_likes (
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cl_select" ON public.comment_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "cl_insert" ON public.comment_likes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "cl_delete" ON public.comment_likes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.sync_comment_like_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.comments SET like_count = like_count + 1 WHERE id = NEW.comment_id;
  ELSE
    UPDATE public.comments SET like_count = GREATEST(0, like_count - 1)
      WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_comment_like_count ON public.comment_likes;
CREATE TRIGGER trg_comment_like_count
  AFTER INSERT OR DELETE ON public.comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_comment_like_count();

-- ── 6. seen_posts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seen_posts (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES public.posts(id)    ON DELETE CASCADE,
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
ALTER TABLE public.seen_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp_own" ON public.seen_posts FOR ALL TO authenticated
  USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_seen_posts_user
  ON public.seen_posts(user_id, seen_at DESC);

-- ── 7. Feed score function ───────────────────────────────────────────────────
-- NOTE: VOLATILE (not IMMUTABLE) — uses now() internally
CREATE OR REPLACE FUNCTION public.compute_feed_score(
  p_likes    integer,
  p_comments integer,
  p_saves    integer,
  p_created  timestamptz
) RETURNS float LANGUAGE sql VOLATILE AS $$
  SELECT
    (p_likes * 1.0 + p_comments * 4.0 + p_saves * 3.0)
    * exp(-0.0578 * EXTRACT(EPOCH FROM (now() - p_created)) / 3600.0);
$$;

-- ── 8. profiles — behavioural consent ───────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS behavioural_consent boolean NOT NULL DEFAULT false;

-- ── 9. post-media storage bucket ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-media', 'post-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "post_media_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'post-media');

CREATE POLICY "post_media_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'post-media' AND
    auth.uid()::text = (storage.foldername(objects.name))[1]
  );

CREATE POLICY "post_media_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'post-media' AND
    auth.uid()::text = (storage.foldername(objects.name))[1]
  );
