-- ============================================================
-- 073_community_announcements.sql
--
-- Communities get a public voice, and "join to see inside" becomes real.
--
-- Two things change:
--
--   1. A community can publish AS ITSELF -- the byline is the community's name
--      and avatar, not the admin who happened to type it. One per community per
--      day, enforced by a unique index rather than a policy document.
--
--   2. Announcements are public; everything else inside a community requires
--      membership. Until now a public community's entire post history was
--      readable by any authenticated account, which is what made the old
--      "browse before joining" behaviour possible. That is exactly the
--      behaviour we are deliberately ending: the announcement wall is the
--      public face, and what members say to each other is not.
--
-- Depends on 069 (helpers), 072 (is_approved_member).
-- Retry-safe: idempotent throughout.
-- ============================================================

-- ── 1. Columns ──────────────────────────────────────────────────────────────

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS posted_as_community boolean NOT NULL DEFAULT false,
  -- Set by trigger, not generated: an expression over created_at is only
  -- STABLE (timezone conversion depends on session settings), and Postgres
  -- refuses to index or generate from anything short of IMMUTABLE.
  ADD COLUMN IF NOT EXISTS announced_on date;

-- One announcement per community per UTC day. A cap that lives in an index
-- cannot be argued with, forgotten by a new write path, or bypassed by a client
-- that skips the RPC.
CREATE OR REPLACE FUNCTION public.set_announced_on()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.announced_on := CASE
    WHEN NEW.posted_as_community THEN (now() AT TIME ZONE 'UTC')::date
    ELSE NULL
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_announced_on ON public.posts;
CREATE TRIGGER trg_set_announced_on
  BEFORE INSERT OR UPDATE OF posted_as_community ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.set_announced_on();

CREATE UNIQUE INDEX IF NOT EXISTS uq_community_announcement_per_day
  ON public.posts (community_id, announced_on)
  WHERE posted_as_community = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_announcements
  ON public.posts (created_at DESC)
  WHERE posted_as_community = true AND deleted_at IS NULL;

-- ── 2. Visibility ───────────────────────────────────────────────────────────
-- Replaces the 069/072 posts_select. Announcements reach everyone approved;
-- member posts reach members.

DROP POLICY IF EXISTS "posts_select" ON public.posts;
CREATE POLICY "posts_select" ON public.posts
  FOR SELECT TO authenticated
  USING (
    public.is_approved_member()
    AND (
      community_id IS NULL
      OR posted_as_community = true
      OR public.is_community_member(community_id)
    )
  );

-- Posting as the community is an admin capability. Without this clause any
-- member could publish under the community's name and avatar, which is a
-- more convincing impersonation than any display-name trick.
DROP POLICY IF EXISTS "posts_insert" ON public.posts;
CREATE POLICY "posts_insert" ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.can_read_community_content(community_id)
    AND (
      posted_as_community = false
      OR EXISTS (
        SELECT 1 FROM public.community_members m
        WHERE m.community_id = posts.community_id
          AND m.user_id = auth.uid()
          AND m.role IN ('admin','border_patrol')
      )
    )
  );

-- An author may edit their own post but may not promote it to an announcement
-- afterwards -- that would route around both the admin check and the daily cap.
DROP POLICY IF EXISTS "posts_update" ON public.posts;
CREATE POLICY "posts_update" ON public.posts
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (
    author_id = auth.uid()
    AND (
      posted_as_community = false
      OR EXISTS (
        SELECT 1 FROM public.community_members m
        WHERE m.community_id = posts.community_id
          AND m.user_id = auth.uid()
          AND m.role IN ('admin','border_patrol')
      )
    )
  );

-- Comments follow their post: an announcement is public, so its replies are too.
-- can_read_post already delegates to the post's own visibility, so nothing
-- changes there -- it inherits the policy above automatically.

-- ── 3. Interest ranking ─────────────────────────────────────────────────────
-- With a handful of communities, recency is enough. With hundreds, an
-- unweighted announcement feed is just whoever posted most recently. This
-- ranks by overlap between a post's tags and the reader's stated interests,
-- so growth makes the feed more relevant rather than noisier.

CREATE OR REPLACE FUNCTION public.interest_overlap(p_tags text[], p_interests text[])
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(cardinality(ARRAY(
    SELECT unnest(COALESCE(p_tags, '{}'))
    INTERSECT
    SELECT unnest(COALESCE(p_interests, '{}'))
  )), 0);
$$;

/**
 * The announcement feed.
 *
 * Ranking, in order of weight:
 *   - interest overlap  x 8   (why the reader would care)
 *   - feed_score        x 1   (how the post is performing)
 *   - recency decay     -0.5/day, floored at -30
 *
 * Membership is a tiebreak rather than a filter: announcements from a community
 * you have already joined surface slightly higher, but the whole point is that
 * discovery works for communities you have not.
 */
CREATE OR REPLACE FUNCTION public.announcement_feed(
  p_limit  integer DEFAULT 20,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  post_id      uuid,
  community_id uuid,
  rank         double precision,
  created_at   timestamptz
)
LANGUAGE sql
SECURITY INVOKER          -- runs as the caller so posts RLS still applies
STABLE
SET search_path = public
AS $$
  SELECT
    p.id,
    p.community_id,
    (public.interest_overlap(p.post_tags, me.interests) * 8.0)
      + p.feed_score
      + GREATEST(-30.0, -0.5 * EXTRACT(EPOCH FROM (now() - p.created_at)) / 86400.0)
      + CASE WHEN public.is_community_member(p.community_id) THEN 2.0 ELSE 0.0 END
      AS rank,
    p.created_at
  FROM public.posts p
  CROSS JOIN LATERAL (
    SELECT interests FROM public.profiles WHERE id = auth.uid()
  ) me
  WHERE p.posted_as_community = true
    AND p.deleted_at IS NULL
    AND (p_before IS NULL OR p.created_at < p_before)
  ORDER BY rank DESC, p.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.announcement_feed(integer, timestamptz) TO authenticated;

-- ── 4. Friendly failure for the daily cap ───────────────────────────────────
-- A raw unique-violation reaches the client as "duplicate key value violates
-- unique constraint uq_community_announcement_per_day", which is not something
-- to show a community organiser.

CREATE OR REPLACE FUNCTION public.announcement_slot_used(p_community_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.posts
    WHERE community_id = p_community_id
      AND posted_as_community = true
      AND deleted_at IS NULL
      AND announced_on = (now() AT TIME ZONE 'UTC')::date
  );
$$;

GRANT EXECUTE ON FUNCTION public.announcement_slot_used(uuid) TO authenticated;
