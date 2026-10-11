-- 133 — Feed, Archive and Profile: launch fixes and the creator loop
--
-- Lane: feed (audit-archive-profile-feed.md). One migration, nine parts:
--
--   1. hidden_posts            FEED-01  "Hide" / "Not for me" survive a relaunch
--   2. feed_rank_page          FEED-01/02/05/08  For You keyset paging on
--                              (rank, created_at, id) at a fixed clock, minus
--                              hidden posts, muted authors and dead video
--   3. wall_feed_page          FEED-01/02/05  Following / community walls, same
--                              keyset on (feed_score, created_at, id)
--   4. archive_reviews select  ARC-03  a blocked author's reviews are not served
--   5. archive_votes           ARC-11  value is derived from stars; rejected
--                              profiles cannot vote
--   6. content notes           ARC-10  staff can pull a note; three member
--                              flags pull it automatically
--   7. profiles                PRO-04  bio length CHECK; display-name length
--                              CHECK + reserved names on rename
--   8. notifications           delight #3 + ARC-09  post_reaction, comment,
--                              follow, archive_revision — rows written by
--                              triggers that never fail the member's write
--   9. profile glow-up         delight #6  profile_prompts, archive_shelf
--                              (top four), follow_counts()
--  10. comments                FEED-04  'comment' is a report type;
--                              delete_my_comment() keeps other women's replies
--
-- Every new function: REVOKE ALL FROM PUBLIC, anon; explicit GRANT.
-- Every new policy: TO authenticated.

-- ── 1. hidden_posts ─────────────────────────────────────────────────────────
--
-- `seen_posts` was written on every swipe and read by nothing, and the safety
-- sheet called that "durable". A watched post and a hidden post are different
-- facts: watching is not a judgement, hiding is. Separate table so the feed
-- RPCs can exclude one without the other.

CREATE TABLE IF NOT EXISTS public.hidden_posts (
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  reason     text NOT NULL DEFAULT 'hide' CHECK (reason IN ('hide', 'not_for_me')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

ALTER TABLE public.hidden_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hidden_posts_select_own ON public.hidden_posts;
CREATE POLICY hidden_posts_select_own ON public.hidden_posts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS hidden_posts_insert_own ON public.hidden_posts;
CREATE POLICY hidden_posts_insert_own ON public.hidden_posts
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS hidden_posts_delete_own ON public.hidden_posts;
CREATE POLICY hidden_posts_delete_own ON public.hidden_posts
  FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.hidden_posts FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.hidden_posts TO authenticated;

-- ── 2. For You: keyset paging at a fixed clock ──────────────────────────────
--
-- `announcement_feed` orders by rank but the client paged on created_at, so a
-- high-ranked old post on page 1 made every newer, lower-ranked post
-- unreachable. Rank also decays with now(), so it moves between two calls.
-- This takes the clock from the first page (`p_as_of`) and a composite cursor;
-- ties break on created_at, then id, so equal ranks cannot be skipped.
--
-- SECURITY INVOKER: `posts_select` (blocks, approval) still applies.

CREATE OR REPLACE FUNCTION public.feed_rank_page(
  p_limit             integer          DEFAULT 20,
  p_as_of             timestamptz      DEFAULT NULL,
  p_cursor_rank       double precision DEFAULT NULL,
  p_cursor_created_at timestamptz      DEFAULT NULL,
  p_cursor_id         uuid             DEFAULT NULL
)
RETURNS TABLE (
  post_id      uuid,
  community_id uuid,
  rank         double precision,
  created_at   timestamptz,
  as_of        timestamptz
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  WITH clock AS (
    SELECT COALESCE(p_as_of, now()) AS t
  ),
  ranked AS (
    SELECT
      p.id,
      owner.official_community_id AS community_id,
      (
        (public.interest_overlap(p.post_tags, me.interests) * 8.0)
        + p.feed_score
        + GREATEST(-30.0, -0.5 * EXTRACT(EPOCH FROM (clock.t - p.created_at)) / 86400.0)
        + CASE WHEN f.followed_id IS NOT NULL THEN 4.0 ELSE 0.0 END
      )::double precision AS rank,
      p.created_at
    FROM public.posts p
    CROSS JOIN clock
    LEFT JOIN LATERAL (
      SELECT pr.interests FROM public.profiles pr WHERE pr.id = auth.uid()
    ) me ON true
    LEFT JOIN public.profiles owner ON owner.id = p.author_id
    LEFT JOIN public.follows f
      ON f.follower_id = auth.uid()
     AND f.followed_id = p.author_id
    WHERE p.deleted_at IS NULL
      AND p.community_id IS NULL
      AND p.posted_as_community = false
      -- Posts newer than the clock belong to the next refresh, not to page 7.
      AND p.created_at <= clock.t
      AND NOT EXISTS (
        SELECT 1 FROM public.hidden_posts h
        WHERE h.user_id = auth.uid() AND h.post_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.mutes m
        WHERE m.user_id = auth.uid() AND m.muted_user_id = p.author_id
      )
      -- A video whose upload never finished renders "Video unavailable" to
      -- everyone. Only its author sees it (as processing).
      AND (p.post_type <> 'video' OR p.video_url IS NOT NULL OR p.author_id = auth.uid())
  )
  SELECT r.id, r.community_id, r.rank, r.created_at, clock.t
  FROM ranked r
  CROSS JOIN clock
  WHERE p_cursor_rank IS NULL
     OR (r.rank, r.created_at, r.id) < (p_cursor_rank, p_cursor_created_at, p_cursor_id)
  ORDER BY r.rank DESC, r.created_at DESC, r.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
$$;

COMMENT ON FUNCTION public.feed_rank_page(integer, timestamptz, double precision, timestamptz, uuid) IS
  'For You, one page. Keyset on (rank, created_at, id) at the clock of the first page. Excludes her hidden posts, authors she muted, and unfinished videos (except her own).';

REVOKE ALL ON FUNCTION public.feed_rank_page(integer, timestamptz, double precision, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feed_rank_page(integer, timestamptz, double precision, timestamptz, uuid) TO authenticated;

-- The 118 RPC stays for installed builds (expand, then contract), and gains
-- the same exclusions so "Hide" holds there too.
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
    AND NOT EXISTS (
      SELECT 1 FROM public.hidden_posts h
      WHERE h.user_id = auth.uid() AND h.post_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.mutes m
      WHERE m.user_id = auth.uid() AND m.muted_user_id = p.author_id
    )
  ORDER BY rank DESC, p.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

COMMENT ON FUNCTION public.announcement_feed(integer, timestamptz) IS
  'Superseded by feed_rank_page (133) — kept for installed builds. Excludes hidden posts and muted authors since 133.';

-- ── 3. Following / community walls ──────────────────────────────────────────
--
-- `.lt('feed_score', cursor)` skipped every post tied with the last one on the
-- page (prod: 24 posts at score 0). Composite keyset instead. `p_skip_muted`
-- is false only where she opened that person's profile on purpose.

CREATE OR REPLACE FUNCTION public.wall_feed_page(
  p_author_ids        uuid[],
  p_limit             integer          DEFAULT 10,
  p_cursor_score      double precision DEFAULT NULL,
  p_cursor_created_at timestamptz      DEFAULT NULL,
  p_cursor_id         uuid             DEFAULT NULL,
  p_skip_muted        boolean          DEFAULT true
)
RETURNS TABLE (
  post_id    uuid,
  feed_score double precision,
  created_at timestamptz
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.feed_score, p.created_at
  FROM public.posts p
  WHERE p.author_id = ANY (COALESCE(p_author_ids, '{}'::uuid[]))
    AND p.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.hidden_posts h
      WHERE h.user_id = auth.uid() AND h.post_id = p.id
    )
    AND (
      NOT COALESCE(p_skip_muted, true)
      OR NOT EXISTS (
        SELECT 1 FROM public.mutes m
        WHERE m.user_id = auth.uid() AND m.muted_user_id = p.author_id
      )
    )
    AND (p.post_type <> 'video' OR p.video_url IS NOT NULL OR p.author_id = auth.uid())
    AND (
      p_cursor_score IS NULL
      OR (p.feed_score, p.created_at, p.id) < (p_cursor_score, p_cursor_created_at, p_cursor_id)
    )
  ORDER BY p.feed_score DESC, p.created_at DESC, p.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
$$;

COMMENT ON FUNCTION public.wall_feed_page(uuid[], integer, double precision, timestamptz, uuid, boolean) IS
  'Following / community walls, one page. Keyset on (feed_score, created_at, id). Excludes hidden posts, muted authors (unless p_skip_muted=false) and unfinished videos (except her own).';

REVOKE ALL ON FUNCTION public.wall_feed_page(uuid[], integer, double precision, timestamptz, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wall_feed_page(uuid[], integer, double precision, timestamptz, uuid, boolean) TO authenticated;

-- ── 4. Archive reviews: blocks apply ────────────────────────────────────────

DROP POLICY IF EXISTS archive_reviews_select_published ON public.archive_reviews;
CREATE POLICY archive_reviews_select_published ON public.archive_reviews
  FOR SELECT TO authenticated
  USING (
    (status = 'published' AND NOT public.blocked_pair(auth.uid(), author_id))
    OR author_id = auth.uid()
    OR public.is_roxy_staff()
  );

-- ── 5. Archive votes: one truth, and no votes from rejected profiles ────────

CREATE OR REPLACE FUNCTION public.archive_votes_derive_value()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- 4★ and 5★ are a recommend (120). Derived, so a PATCH of {value:true,
  -- stars:1} cannot inflate up_count.
  NEW.value := NEW.stars >= 4;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.archive_votes_derive_value() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS archive_votes_derive_value ON public.archive_votes;
CREATE TRIGGER archive_votes_derive_value
  BEFORE INSERT OR UPDATE OF value, stars ON public.archive_votes
  FOR EACH ROW EXECUTE FUNCTION public.archive_votes_derive_value();

ALTER TABLE public.archive_votes DROP CONSTRAINT IF EXISTS archive_vote_value_matches_stars;
ALTER TABLE public.archive_votes
  ADD CONSTRAINT archive_vote_value_matches_stars CHECK (value = (stars >= 4)) NOT VALID;
ALTER TABLE public.archive_votes VALIDATE CONSTRAINT archive_vote_value_matches_stars;

CREATE OR REPLACE FUNCTION public.archive_vote_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Pending members may vote by design (096). Rejected ones may not.
  SELECT auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND vetting_status = 'rejected'
     );
$$;

REVOKE ALL ON FUNCTION public.archive_vote_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_vote_allowed() TO authenticated;

DROP POLICY IF EXISTS archive_votes_insert_own ON public.archive_votes;
CREATE POLICY archive_votes_insert_own ON public.archive_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    AND public.archive_vote_allowed()
    AND EXISTS (
      SELECT 1 FROM public.archive_entries e
      WHERE e.id = archive_votes.entry_id AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS archive_votes_update_own ON public.archive_votes;
CREATE POLICY archive_votes_update_own ON public.archive_votes
  FOR UPDATE TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid() AND public.archive_vote_allowed());

-- ── 6. Content notes: visible by default, pulled by reports ─────────────────
--
-- The 3-agree gate hid all 95 seeded notes forever (ARC-01, client side).
-- The rule is now: a note shows until it is reported. Three member flags pull
-- it; staff can pull or restore one directly.

CREATE TABLE IF NOT EXISTS public.archive_note_flags (
  note_id    uuid NOT NULL REFERENCES public.archive_content_notes(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason     text NOT NULL CHECK (reason IN ('spoiler', 'wrong', 'abuse')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, profile_id)
);

ALTER TABLE public.archive_note_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS archive_note_flags_insert_own ON public.archive_note_flags;
CREATE POLICY archive_note_flags_insert_own ON public.archive_note_flags
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid() AND public.is_approved_member());
DROP POLICY IF EXISTS archive_note_flags_select_own ON public.archive_note_flags;
CREATE POLICY archive_note_flags_select_own ON public.archive_note_flags
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_roxy_staff());

REVOKE ALL ON public.archive_note_flags FROM anon, authenticated;
GRANT SELECT, INSERT ON public.archive_note_flags TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_note_flag_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.archive_note_flags WHERE note_id = NEW.note_id) >= 3 THEN
    UPDATE public.archive_content_notes
       SET status = 'removed'
     WHERE id = NEW.note_id AND status = 'visible';
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'archive_note_flag_threshold failed: %', SQLERRM;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.archive_note_flag_threshold() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS archive_note_flag_threshold ON public.archive_note_flags;
CREATE TRIGGER archive_note_flag_threshold
  AFTER INSERT ON public.archive_note_flags
  FOR EACH ROW EXECUTE FUNCTION public.archive_note_flag_threshold();

DROP POLICY IF EXISTS archive_notes_update_staff ON public.archive_content_notes;
CREATE POLICY archive_notes_update_staff ON public.archive_content_notes
  FOR UPDATE TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff());

-- Staff change the status, nothing else: the label is the member's words.
REVOKE UPDATE ON public.archive_content_notes FROM anon, authenticated;
GRANT UPDATE (status) ON public.archive_content_notes TO authenticated;

-- ── 7. Profiles: bio and display-name rules ─────────────────────────────────
--
-- Prod maxima (2026-10-10): bio 73, display_name 26, trimmed min 3.
-- The client caps the bio at 160 with a counter; the DB allows 300 so a
-- legacy or web client is not refused mid-sentence.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_bio_len;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_bio_len CHECK (bio IS NULL OR char_length(bio) <= 300) NOT VALID;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_bio_len;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_display_name_len;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_len
  CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 50) NOT VALID;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_display_name_len;

-- display_name is UPDATE-granted (080), so the "contact support" label was
-- never true. Renames are allowed; renaming yourself to a staff-sounding name
-- is not. Mirrors RESERVED_DISPLAY_NAMES in apps/mobile/lib/profileRules.ts.
CREATE OR REPLACE FUNCTION public.profiles_guard_display_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text := lower(regexp_replace(COALESCE(NEW.display_name, ''), '[^a-zA-Z0-9]', '', 'g'));
BEGIN
  IF NEW.display_name IS DISTINCT FROM OLD.display_name
     AND auth.uid() IS NOT NULL
     AND NOT public.is_roxy_staff()
     AND v_norm IN (
       'roxy', 'roxyteam', 'teamroxy', 'roxysupport', 'roxystaff', 'roxyofficial',
       'roxyhq', 'sister', 'support', 'admin', 'administrator', 'moderator', 'mod',
       'staff', 'official', 'thinqer', 'naaxtech'
     )
  THEN
    RAISE EXCEPTION 'That name is reserved' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.profiles_guard_display_name() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_display_name ON public.profiles;
CREATE TRIGGER profiles_guard_display_name
  BEFORE UPDATE OF display_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_display_name();

-- ── 8. Notifications: the creator loop ──────────────────────────────────────
--
-- The type list is merged with whatever earlier migrations (incl. other
-- launch lanes, 130–132) allowed, so this cannot drop someone else's type.

DO $$
DECLARE
  v_def   text;
  v_types text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';

  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_types
  FROM (
    SELECT (regexp_matches(COALESCE(v_def, ''), '''([a-z_]+)''', 'g'))[1] AS t
    UNION
    SELECT unnest(ARRAY[
      'friend_request', 'friend_accept', 'community_event', 'message', 'channel_message',
      'post_reaction', 'comment', 'follow', 'archive_revision'
    ])
  ) s;

  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))',
    v_types
  );
END $$;

-- Her activity switch for likes, comments and follows. Every type ON by
-- default (Nicole, 2026-10-04), so this defaults to true like its siblings.
ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS activity boolean NOT NULL DEFAULT true;

-- Shared guard: never notify yourself, someone who muted you, or across a block.
CREATE OR REPLACE FUNCTION public.notify_allowed(p_recipient uuid, p_actor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_recipient IS NOT NULL
     AND p_actor IS NOT NULL
     AND p_recipient <> p_actor
     AND NOT public.blocked_pair(p_recipient, p_actor)
     AND NOT EXISTS (
       SELECT 1 FROM public.mutes m
       WHERE m.user_id = p_recipient AND m.muted_user_id = p_actor
     );
$$;

REVOKE ALL ON FUNCTION public.notify_allowed(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 8a. ✿ on a post (post_likes). One row per (liker, post), ever: unlike and
-- like again does not ring twice. An unread row goes away on unlike.
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

DROP TRIGGER IF EXISTS trg_notify_post_reaction ON public.post_likes;
CREATE TRIGGER trg_notify_post_reaction
  AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_post_reaction();

-- 8b. Comments. The post's author, and on a reply the parent's author too.
-- The link carries the comment id so a deleted comment takes its
-- notification (and its words) with it.
CREATE OR REPLACE FUNCTION public.notify_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_author   uuid;
  v_post_type     text;
  v_parent_author uuid;
  v_link          text;
  v_name          text;
  v_body          text;
BEGIN
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    DELETE FROM public.notifications
     WHERE type = 'comment'
       AND actor_id = OLD.author_id
       AND link_path LIKE '%?comment=' || OLD.id::text;
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN RETURN NULL; END IF;

  SELECT author_id, post_type INTO v_post_author, v_post_type
  FROM public.posts WHERE id = NEW.post_id AND deleted_at IS NULL;
  IF v_post_author IS NULL THEN RETURN NULL; END IF;

  v_link := CASE WHEN v_post_type = 'video' THEN '/community/video/' ELSE '/community/post/' END
            || NEW.post_id::text || '?comment=' || NEW.id::text;
  SELECT display_name INTO v_name FROM public.profiles WHERE id = NEW.author_id;
  v_name := left(COALESCE(v_name, 'Someone'), 150);
  v_body := COALESCE(left(NULLIF(btrim(NEW.content), ''), 120),
                     CASE WHEN NEW.gif_url IS NOT NULL THEN 'Sent a GIF' ELSE 'Sent a photo' END);

  IF public.notify_allowed(v_post_author, NEW.author_id) THEN
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
    VALUES (v_post_author, NEW.author_id, 'comment', v_name || ' commented on your post', v_body, v_link);
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT author_id INTO v_parent_author FROM public.comments WHERE id = NEW.parent_id;
    IF v_parent_author IS DISTINCT FROM v_post_author
       AND public.notify_allowed(v_parent_author, NEW.author_id) THEN
      INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
      VALUES (v_parent_author, NEW.author_id, 'comment', v_name || ' replied to your comment', v_body, v_link);
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_comment failed: %', SQLERRM;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.notify_comment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_comment ON public.comments;
CREATE TRIGGER trg_notify_comment
  AFTER INSERT OR DELETE OR UPDATE OF deleted_at ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_comment();

-- 8c. Follows. One row per follower, ever; an unread one goes on unfollow.
CREATE OR REPLACE FUNCTION public.notify_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.notifications
     WHERE type = 'follow' AND user_id = OLD.followed_id
       AND actor_id = OLD.follower_id AND read_at IS NULL;
    RETURN NULL;
  END IF;

  IF NOT public.notify_allowed(NEW.followed_id, NEW.follower_id) THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = NEW.followed_id AND actor_id = NEW.follower_id AND type = 'follow'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE id = NEW.follower_id;
  INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
  VALUES (NEW.followed_id, NEW.follower_id, 'follow',
          left(COALESCE(v_name, 'Someone'), 150) || ' started following you', NULL,
          '/user/' || NEW.follower_id::text);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_follow failed: %', SQLERRM;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.notify_follow() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_follow ON public.follows;
CREATE TRIGGER trg_notify_follow
  AFTER INSERT OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.notify_follow();

-- 8d. ARC-09: the edit screen promised "you'll get a notification either
-- way" and nothing sent one. In-app only (pushCore has no category for it).
CREATE OR REPLACE FUNCTION public.notify_archive_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    -- Opens the entry she suggested an edit to; a brand-new entry that was
    -- not accepted has no page, so it opens the Archive.
    SELECT e.slug INTO v_slug
    FROM public.archive_entries e
    WHERE e.id = NEW.entry_id AND e.status = 'published';
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
    VALUES (
      NEW.submitted_by,
      NULL,
      'archive_revision',
      CASE WHEN NEW.status = 'approved'
           THEN 'Your Archive suggestion is live ✿'
           ELSE 'Your Archive suggestion was not accepted' END,
      left(NULLIF(btrim(NEW.review_note), ''), 300),
      CASE WHEN v_slug IS NULL THEN '/archive' ELSE '/archive/' || v_slug END
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_archive_revision failed: %', SQLERRM;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.notify_archive_revision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_archive_revision ON public.archive_revisions;
CREATE TRIGGER trg_notify_archive_revision
  AFTER UPDATE OF status ON public.archive_revisions
  FOR EACH ROW EXECUTE FUNCTION public.notify_archive_revision();

-- ── 9. Profile glow-up ──────────────────────────────────────────────────────

-- 9a. Prompts: an easy thing to fill in, and a conversation starter.
CREATE TABLE IF NOT EXISTS public.profile_prompts (
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  prompt_key text NOT NULL CHECK (prompt_key IN (
    'comfort_show', 'ask_me_about', 'perfect_sunday',
    'currently_obsessed', 'green_flag', 'find_me_at'
  )),
  answer     text NOT NULL CHECK (char_length(btrim(answer)) BETWEEN 1 AND 150),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, prompt_key)
);

ALTER TABLE public.profile_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_prompts_select ON public.profile_prompts;
CREATE POLICY profile_prompts_select ON public.profile_prompts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (public.is_approved_member() AND NOT public.blocked_pair(auth.uid(), user_id))
  );
DROP POLICY IF EXISTS profile_prompts_insert_own ON public.profile_prompts;
CREATE POLICY profile_prompts_insert_own ON public.profile_prompts
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS profile_prompts_update_own ON public.profile_prompts;
CREATE POLICY profile_prompts_update_own ON public.profile_prompts
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS profile_prompts_delete_own ON public.profile_prompts;
CREATE POLICY profile_prompts_delete_own ON public.profile_prompts
  FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.profile_prompts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_prompts TO authenticated;

-- 9b. Archive shelf: her top four, Letterboxd-style.
CREATE TABLE IF NOT EXISTS public.archive_shelf (
  profile_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  slot       smallint NOT NULL CHECK (slot BETWEEN 1 AND 4),
  entry_id   uuid NOT NULL REFERENCES public.archive_entries(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, slot),
  UNIQUE (profile_id, entry_id)
);

ALTER TABLE public.archive_shelf ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS archive_shelf_select ON public.archive_shelf;
CREATE POLICY archive_shelf_select ON public.archive_shelf
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR (public.is_approved_member() AND NOT public.blocked_pair(auth.uid(), profile_id))
  );
DROP POLICY IF EXISTS archive_shelf_insert_own ON public.archive_shelf;
CREATE POLICY archive_shelf_insert_own ON public.archive_shelf
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.archive_entries e
      WHERE e.id = archive_shelf.entry_id AND e.status = 'published'
    )
  );
DROP POLICY IF EXISTS archive_shelf_delete_own ON public.archive_shelf;
CREATE POLICY archive_shelf_delete_own ON public.archive_shelf
  FOR DELETE TO authenticated USING (profile_id = auth.uid());

REVOKE ALL ON public.archive_shelf FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.archive_shelf TO authenticated;

-- Replace the whole shelf in one statement: slots are positional, and two
-- separate writes would trip the (profile_id, entry_id) unique on a reorder.
CREATE OR REPLACE FUNCTION public.set_archive_shelf(p_entry_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_entry_ids), 0) > 4 THEN
    RAISE EXCEPTION 'a shelf holds four' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.archive_shelf WHERE profile_id = auth.uid();
  INSERT INTO public.archive_shelf (profile_id, slot, entry_id)
  SELECT auth.uid(), x.ord::smallint, x.id
  FROM unnest(COALESCE(p_entry_ids, '{}'::uuid[])) WITH ORDINALITY AS x(id, ord);
END $$;

REVOKE ALL ON FUNCTION public.set_archive_shelf(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_archive_shelf(uuid[]) TO authenticated;

-- 9c. Follower counts + "follows you". follows_select_own (116) only shows
-- rows that involve the caller, so counts need a definer function. Counts are
-- withheld across a block and from unapproved callers.
CREATE OR REPLACE FUNCTION public.follow_counts(p_user_id uuid)
RETURNS TABLE (followers bigint, following bigint, follows_you boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.follows f WHERE f.followed_id = p_user_id),
    (SELECT count(*) FROM public.follows f WHERE f.follower_id = p_user_id),
    EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = p_user_id AND f.followed_id = auth.uid()
    )
  WHERE auth.uid() IS NOT NULL
    AND (p_user_id = auth.uid() OR public.is_approved_member())
    AND NOT public.blocked_pair(auth.uid(), p_user_id);
$$;

REVOKE ALL ON FUNCTION public.follow_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.follow_counts(uuid) TO authenticated;

-- ── 10. Comments: reportable, and hers to take back ─────────────────────────
--
-- FEED-04. Comments are where harassment lands and no comment could be
-- reported: `reports.content_type` had no 'comment'. Widened here (the CHECK
-- keeps every earlier value) together with the submit-report allowlist and
-- lib/reportTargets.ts, which __tests__/lib/reportContentTypes.test.ts keeps
-- in step. The 1000-character cap is already the 045 CHECK
-- (comments_content_check), so the client limit mirrors it; no change here.

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_content_type_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_content_type_check
  CHECK (content_type IN (
    'message', 'post', 'profile', 'room', 'speed_date',
    'archive_entry', 'archive_review', 'comment'
  ));

-- Delete her own comment. A plain DELETE would cascade (parent_id ON DELETE
-- CASCADE) and take other women's replies with it, so a comment that has
-- replies is blanked and marked deleted instead ("This comment was removed.")
-- and one without replies is deleted outright. Either way her words are gone
-- and notify_comment (8b) withdraws the notification. Returns 'deleted',
-- 'removed', or NULL when the comment is not hers / does not exist.
CREATE OR REPLACE FUNCTION public.delete_my_comment(p_comment_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.comments
    WHERE id = p_comment_id AND author_id = v_me AND deleted_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.comments WHERE parent_id = p_comment_id) THEN
    UPDATE public.comments
       SET deleted_at = now(), content = '', media_url = NULL, gif_url = NULL
     WHERE id = p_comment_id AND author_id = v_me;
    RETURN 'removed';
  END IF;
  DELETE FROM public.comments WHERE id = p_comment_id AND author_id = v_me;
  RETURN 'deleted';
END $$;

REVOKE ALL ON FUNCTION public.delete_my_comment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_comment(uuid) TO authenticated;
