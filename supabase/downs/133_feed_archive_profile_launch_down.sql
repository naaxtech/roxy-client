-- 133 down — reverses 133_feed_archive_profile_launch.sql.
-- Run only inside a transaction you have backed up. Drops member data in
-- hidden_posts, archive_note_flags, profile_prompts and archive_shelf.
-- destructive-ok: down file

-- 9
DROP FUNCTION IF EXISTS public.follow_counts(uuid);
DROP FUNCTION IF EXISTS public.set_archive_shelf(uuid[]);
DROP TABLE IF EXISTS public.archive_shelf;
DROP TABLE IF EXISTS public.profile_prompts;

-- 8
DROP TRIGGER IF EXISTS trg_notify_archive_revision ON public.archive_revisions;
DROP FUNCTION IF EXISTS public.notify_archive_revision();
DROP TRIGGER IF EXISTS trg_notify_follow ON public.follows;
DROP FUNCTION IF EXISTS public.notify_follow();
DROP TRIGGER IF EXISTS trg_notify_comment ON public.comments;
DROP FUNCTION IF EXISTS public.notify_comment();
DROP TRIGGER IF EXISTS trg_notify_post_reaction ON public.post_likes;
DROP FUNCTION IF EXISTS public.notify_post_reaction();
DROP FUNCTION IF EXISTS public.notify_allowed(uuid, uuid);
ALTER TABLE public.notification_settings DROP COLUMN IF EXISTS activity;
DELETE FROM public.notifications
 WHERE type IN ('post_reaction', 'comment', 'follow', 'archive_revision');
DO $$
DECLARE
  v_def   text;
  v_types text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_types
  FROM (SELECT (regexp_matches(COALESCE(v_def, ''), '''([a-z_]+)''', 'g'))[1] AS t) s
  WHERE t NOT IN ('post_reaction', 'comment', 'follow', 'archive_revision');
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))',
    v_types
  );
END $$;

-- 7
DROP TRIGGER IF EXISTS profiles_guard_display_name ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_guard_display_name();
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_display_name_len;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_bio_len;

-- 6
REVOKE UPDATE (status) ON public.archive_content_notes FROM authenticated;
GRANT UPDATE ON public.archive_content_notes TO authenticated;
DROP POLICY IF EXISTS archive_notes_update_staff ON public.archive_content_notes;
DROP TRIGGER IF EXISTS archive_note_flag_threshold ON public.archive_note_flags;
DROP FUNCTION IF EXISTS public.archive_note_flag_threshold();
DROP TABLE IF EXISTS public.archive_note_flags;

-- 5 (096 forms)
DROP POLICY IF EXISTS archive_votes_update_own ON public.archive_votes;
CREATE POLICY archive_votes_update_own ON public.archive_votes
  FOR UPDATE TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());
DROP POLICY IF EXISTS archive_votes_insert_own ON public.archive_votes;
CREATE POLICY archive_votes_insert_own ON public.archive_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.archive_entries e
      WHERE e.id = archive_votes.entry_id AND e.status = 'published'
    )
  );
DROP FUNCTION IF EXISTS public.archive_vote_allowed();
ALTER TABLE public.archive_votes DROP CONSTRAINT IF EXISTS archive_vote_value_matches_stars;
DROP TRIGGER IF EXISTS archive_votes_derive_value ON public.archive_votes;
DROP FUNCTION IF EXISTS public.archive_votes_derive_value();

-- 4 (096 form)
DROP POLICY IF EXISTS archive_reviews_select_published ON public.archive_reviews;
CREATE POLICY archive_reviews_select_published ON public.archive_reviews
  FOR SELECT TO authenticated
  USING (status = 'published' OR author_id = auth.uid() OR public.is_roxy_staff());

-- 3, 2
DROP FUNCTION IF EXISTS public.wall_feed_page(uuid[], integer, double precision, timestamptz, uuid, boolean);
DROP FUNCTION IF EXISTS public.feed_rank_page(integer, timestamptz, double precision, timestamptz, uuid);

-- announcement_feed back to its 118 body (no hidden/mute exclusions).
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
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT
    p.id,
    owner.official_community_id,
    (public.interest_overlap(p.post_tags, me.interests) * 8.0)
      + p.feed_score
      + GREATEST(-30.0, -0.5 * EXTRACT(EPOCH FROM (now() - p.created_at)) / 86400.0)
      + CASE WHEN f.followed_id IS NOT NULL THEN 4.0 ELSE 0.0 END
      AS rank,
    p.created_at
  FROM public.posts p
  CROSS JOIN LATERAL (
    SELECT interests FROM public.profiles WHERE id = auth.uid()
  ) me
  LEFT JOIN public.profiles owner ON owner.id = p.author_id
  LEFT JOIN public.follows f
    ON f.follower_id = auth.uid()
   AND f.followed_id = p.author_id
  WHERE p.deleted_at IS NULL
    AND p.community_id IS NULL
    AND p.posted_as_community = false
    AND (p_before IS NULL OR p.created_at < p_before)
  ORDER BY rank DESC, p.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

-- 1
DROP TABLE IF EXISTS public.hidden_posts;
