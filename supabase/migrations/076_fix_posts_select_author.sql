-- ============================================================
-- 076_fix_posts_select_author.sql
--
-- 073 made posts_select stricter than posts_insert, and the gap between the
-- two breaks every insert that asks for its own row back.
--
--   posts_insert  WITH CHECK   can_read_community_content(community_id)
--                              -> true for ANY public community
--   posts_select  USING        is_community_member(community_id)
--                              -> false unless you have joined it
--
-- Postgres applies SELECT policies to the rows a RETURNING clause hands back,
-- and PostgREST emits RETURNING for any request that asks for a representation
-- -- which is exactly what `.insert().select()` compiles to. So posting into a
-- public community you have not joined now fails with
--
--   42501: new row violates row-level security policy for table "posts"
--
-- even though the row was perfectly acceptable to the INSERT policy. The row
-- goes in and is then thrown away, because the author is not allowed to read
-- what they just wrote. Reproduced against production, same row both times:
--
--   INSERT ... (no RETURNING)   -> OK
--   INSERT ... RETURNING id     -> 42501
--
-- That is a real user-facing break, not a theoretical one: the video composer
-- needs the new post's id to tag the Cloudflare Stream upload session, so it
-- is the one write path in the app that always uses RETURNING.
--   apps/mobile/app/(tabs)/discover/community/create-post.tsx -- .select('id').single()
--
-- FIX: let an author read their own post. Smallest change that closes the gap,
-- and it widens visibility for exactly one person -- the author, about a row
-- they wrote themselves. No other member's content becomes readable to anyone,
-- so 073's "what members say to each other is not public" still holds exactly
-- as written. It also fixes a smaller wrong: before this, leaving a community
-- made your own posts invisible to you.
--
-- Deliberately NOT done here: tightening posts_insert to require membership.
-- That is the other way to make the two agree, but it is a product decision --
-- it would end posting into a public community you are only browsing -- and it
-- does not belong inside a fix for a broken write path.
--
-- Retry-safe: idempotent.
-- ============================================================

DROP POLICY IF EXISTS "posts_select" ON public.posts;

CREATE POLICY "posts_select" ON public.posts
  FOR SELECT TO authenticated
  USING (
    public.is_approved_member()
    AND (
      -- New in 076. Everything below this line is 073 unchanged.
      author_id = auth.uid()
      OR community_id IS NULL
      OR posted_as_community = true
      OR public.is_community_member(community_id)
    )
  );

COMMENT ON POLICY "posts_select" ON public.posts IS
  'Announcements reach every approved member; member posts require membership; an author can always read their own post. Dropping that last clause breaks INSERT ... RETURNING for any community the author has not joined.';
