-- ============================================================
-- 069_community_content_visibility_rls.sql
--
-- Security fix: community content was readable by every authenticated user,
-- including content inside is_private communities.
--
--   posts.posts_select                 005_content_feed.sql:52   USING (true)
--   comments.comments_select           013_comments.sql:15       USING (true)
--   post_likes.pl_select               045_feed_v2.sql:66        USING (true)
--   post_saves.ps_select               045_feed_v2.sql:96        USING (true)
--   comment_likes.cl_select            045_feed_v2.sql:126       USING (true)
--
-- Membership was enforced only client-side -- app/(tabs)/connect/index.tsx
-- filters the feed to joined communities, and discover/community/[id].tsx
-- gates the UI on isJoined. Neither is a security boundary: a session token
-- and a single PostgREST call returned every private community's posts,
-- comments, and the user_ids of everyone who liked them.
--
-- On a WLW product that is not a data-hygiene issue. A private community's
-- post list plus its like rows is a membership roster for a queer space, and
-- the people in it did not consent to being enumerable by any account that
-- completed signup.
--
-- Already fixed by earlier migrations, left untouched here:
--   events.events_select               020_event_detail.sql:28
--   event_attendees.ea_select_*        064_event_attendees_select_fix.sql
--
-- SCOPE -- this migration closes the *private* community hole only. Public
-- communities keep their present reach (any authenticated user may read) so
-- that browsing a community before joining still works. Tightening public
-- communities to members-only-plus-announcements is a product change and
-- belongs with the community-brand-post slice, not with a security fix.
--
-- Retry-safe: every statement is idempotent; re-pushing this file is a no-op.
-- ============================================================

-- ── 1. Visibility helpers ───────────────────────────────────────────────────
-- SECURITY DEFINER so the check itself is not subject to RLS on communities /
-- community_members -- the same recursion trap 015_fix_community_rls.sql hit.
-- STABLE so the planner evaluates once per distinct argument per statement.

CREATE OR REPLACE FUNCTION public.can_read_community_content(cid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    -- posts.community_id and events.community_id are nullable: a row with no
    -- community is not community-scoped content and stays visible.
    cid IS NULL
    OR EXISTS (
      SELECT 1 FROM public.communities c
      WHERE c.id = cid AND c.is_private = false
    )
    OR public.is_community_member(cid);
$$;

COMMENT ON FUNCTION public.can_read_community_content(uuid) IS
  'True when the caller may read content scoped to this community: not scoped, public, or the caller is a member. Used by RLS on posts/comments/likes/saves.';

CREATE OR REPLACE FUNCTION public.can_read_post(pid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = pid
      AND public.can_read_community_content(p.community_id)
  );
$$;

COMMENT ON FUNCTION public.can_read_post(uuid) IS
  'True when the caller may read this post. A missing post returns false, so rows that outlive their parent are never exposed.';

CREATE OR REPLACE FUNCTION public.can_read_comment(cmid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.comments c
    WHERE c.id = cmid
      AND public.can_read_post(c.post_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_roxy_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_staff = true
  );
$$;

-- ── 2. posts ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "posts_select"       ON public.posts;
DROP POLICY IF EXISTS "posts_select_staff" ON public.posts;

CREATE POLICY "posts_select" ON public.posts
  FOR SELECT TO authenticated
  USING (public.can_read_community_content(community_id));

-- Moderation surface: the reports queue (008_content_moderation.sql) must be
-- able to render the reported post regardless of where it lives.
CREATE POLICY "posts_select_staff" ON public.posts
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());

-- posts_insert only checked authorship, so any authenticated user could write
-- a row into a private community they had never joined.
DROP POLICY IF EXISTS "posts_insert" ON public.posts;

CREATE POLICY "posts_insert" ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.can_read_community_content(community_id)
  );

-- ── 3. comments ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "comments_select"       ON public.comments;
DROP POLICY IF EXISTS "comments_select_staff" ON public.comments;

CREATE POLICY "comments_select" ON public.comments
  FOR SELECT TO authenticated
  USING (public.can_read_post(post_id));

CREATE POLICY "comments_select_staff" ON public.comments
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());

DROP POLICY IF EXISTS "comments_insert" ON public.comments;

CREATE POLICY "comments_insert" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.can_read_post(post_id)
  );

-- ── 4. Engagement rows ──────────────────────────────────────────────────────
-- These carry user_id, so an open SELECT enumerates who is inside a community
-- even once the post bodies are locked down. Scoping them to "communities you
-- can read" is not enough: a member of a private community could still list
-- every other member from the like rows.
--
-- Own-row is safe because the displayed totals do not come from these tables --
-- posts.like_count / posts.save_count / comments.like_count are denormalised
-- and kept current by the triggers in 045_feed_v2.sql. Verified every read
-- path is already own-row scoped:
--   store/feedStore.ts:67-68                 .eq('user_id', userId)
--   components/grow/MiniWinsCard.tsx:35-36   .eq('user_id', userId)
--   components/profile/SavedPosts.tsx:35-37  .eq('user_id', userId)
--   discover/post/[postId].tsx:137-141       .eq('user_id', user.id)
-- No surface renders "who liked this", so nothing loses data. Same shape as
-- the ea_select_own / ea_select_staff split in 064.

DROP POLICY IF EXISTS "pl_select"       ON public.post_likes;
DROP POLICY IF EXISTS "pl_select_staff" ON public.post_likes;

CREATE POLICY "pl_select" ON public.post_likes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "pl_select_staff" ON public.post_likes
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());

DROP POLICY IF EXISTS "pl_insert" ON public.post_likes;
CREATE POLICY "pl_insert" ON public.post_likes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_read_post(post_id));

-- post_saves are private bookmarks -- no staff read, nobody but the owner has
-- ever had a reason to see them.
DROP POLICY IF EXISTS "ps_select" ON public.post_saves;
CREATE POLICY "ps_select" ON public.post_saves
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ps_insert" ON public.post_saves;
CREATE POLICY "ps_insert" ON public.post_saves
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_read_post(post_id));

DROP POLICY IF EXISTS "cl_select"       ON public.comment_likes;
DROP POLICY IF EXISTS "cl_select_staff" ON public.comment_likes;

CREATE POLICY "cl_select" ON public.comment_likes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "cl_select_staff" ON public.comment_likes
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());

DROP POLICY IF EXISTS "cl_insert" ON public.comment_likes;
CREATE POLICY "cl_insert" ON public.comment_likes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_read_comment(comment_id));

-- ── 5. Supporting index ─────────────────────────────────────────────────────
-- can_read_community_content probes communities by id (PK, covered) and
-- community_members by (community_id, user_id) via is_community_member --
-- covered by the community_members PK. seen_posts is already own-row only.
-- No new index required; this note exists so the next reader does not re-derive it.
