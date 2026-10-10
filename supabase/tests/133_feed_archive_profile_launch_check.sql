-- Behaviour proof for 133_feed_archive_profile_launch.sql on a LOCAL database.
-- Runs inside one transaction that the runner ROLLS BACK (migration-proof.cjs);
-- it leaves nothing behind. Every block RAISEs on a failed expectation.
\set ON_ERROR_STOP on

DO $$
DECLARE
  a uuid; b uuid; c uuid; d uuid;
  e1 uuid; n1 uuid;
  p_a uuid; p_dead uuid; p_hide uuid;
  cm_b uuid; cm_c uuid;
  rev uuid;
  ids uuid[];
  shelf uuid[];
  r record;
  as_of timestamptz; cr double precision; cc timestamptz; ci uuid;
  got uuid[] := '{}';
  full_ids uuid[];
  wall_ids uuid[];
  n int; cnt int; v boolean; t text;
BEGIN
  SELECT id INTO a FROM public.profiles ORDER BY created_at, id LIMIT 1;
  SELECT id INTO b FROM public.profiles WHERE id <> a ORDER BY created_at, id LIMIT 1;
  SELECT id INTO c FROM public.profiles WHERE id NOT IN (a, b) ORDER BY created_at, id LIMIT 1;
  SELECT id INTO d FROM public.profiles WHERE id NOT IN (a, b, c) ORDER BY created_at, id LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'need 4 profiles in the local db'; END IF;
  UPDATE public.profiles SET vetting_status = 'approved', is_staff = false WHERE id IN (a, b, c, d);
  DELETE FROM public.friendships WHERE requester_id IN (a, b, c, d) AND addressee_id IN (a, b, c, d);
  DELETE FROM public.mutes WHERE user_id IN (a, b, c, d);
  DELETE FROM public.follows WHERE follower_id IN (a, b, c, d) AND followed_id IN (a, b, c, d);

  -- Fixture: 15 posts by d tied at feed_score 0 and one timestamp (prod has
  -- 24 posts tied at 0), one finished-upload-less video, one post by a.
  -- Cleared first so the check can run twice in one transaction (--cycle).
  DELETE FROM public.posts WHERE author_id IN (a, d) AND content IN ('processing', 'mine');
  DELETE FROM public.posts WHERE author_id = d AND content LIKE 'tie %';
  INSERT INTO public.posts (author_id, content, post_type, feed_score, created_at)
  SELECT d, 'tie ' || g, 'standard', 0, now() - interval '2 hours'
  FROM generate_series(1, 15) g;
  INSERT INTO public.posts (author_id, content, post_type, video_url)
  VALUES (d, 'processing', 'video', NULL) RETURNING id INTO p_dead;
  INSERT INTO public.posts (author_id, content, post_type)
  VALUES (a, 'mine', 'standard') RETURNING id INTO p_a;

  -- ── T1 FEED-02: walls page on (feed_score, created_at, id) with no gaps ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  cr := NULL; cc := NULL; ci := NULL;
  LOOP
    n := 0;
    FOR r IN SELECT * FROM public.wall_feed_page(ARRAY[d], 4, cr, cc, ci) LOOP
      n := n + 1; got := got || r.post_id; cr := r.feed_score; cc := r.created_at; ci := r.post_id;
    END LOOP;
    EXIT WHEN n < 4;
  END LOOP;
  SELECT array_agg(post_id ORDER BY feed_score DESC, created_at DESC, post_id DESC) INTO wall_ids
  FROM public.wall_feed_page(ARRAY[d], 50);
  IF got IS DISTINCT FROM wall_ids THEN
    RAISE EXCEPTION 'T1 wall paging: paged % rows, single page % rows', cardinality(got), cardinality(wall_ids);
  END IF;
  SELECT count(*) INTO cnt FROM unnest(got) x JOIN public.posts p ON p.id = x WHERE p.content LIKE 'tie %';
  IF cnt <> 15 THEN RAISE EXCEPTION 'T1 wall paging: % of 15 tied posts reached', cnt; END IF;
  IF p_dead = ANY (got) THEN RAISE EXCEPTION 'T1 dead video served to a non-author'; END IF;

  -- ── T2 FEED-02: For You pages at a fixed clock and covers the full list ──
  SELECT array_agg(post_id ORDER BY rank DESC, created_at DESC, post_id DESC) INTO full_ids
  FROM public.feed_rank_page(50);
  got := '{}'; as_of := NULL; cr := NULL; cc := NULL; ci := NULL;
  LOOP
    n := 0;
    FOR r IN SELECT * FROM public.feed_rank_page(3, as_of, cr, cc, ci) LOOP
      n := n + 1; got := got || r.post_id;
      as_of := r.as_of; cr := r.rank; cc := r.created_at; ci := r.post_id;
    END LOOP;
    EXIT WHEN n < 3;
  END LOOP;
  IF got IS DISTINCT FROM full_ids THEN
    RAISE EXCEPTION 'T2 for-you paging: paged % rows, single page % rows', cardinality(got), cardinality(full_ids);
  END IF;
  IF p_dead = ANY (full_ids) THEN RAISE EXCEPTION 'T2 dead video served in For You'; END IF;
  RESET ROLE;

  -- The author still sees her own processing video.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF NOT EXISTS (SELECT 1 FROM public.wall_feed_page(ARRAY[d], 50) WHERE post_id = p_dead) THEN
    RAISE EXCEPTION 'T2b author cannot see her own processing video';
  END IF;
  RESET ROLE;

  -- ── T3 FEED-01: a hidden post stays hidden, in every scope, for her only ─
  p_hide := wall_ids[1];
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.hidden_posts (post_id, reason) VALUES (p_hide, 'not_for_me');
  IF EXISTS (SELECT 1 FROM public.feed_rank_page(50) WHERE post_id = p_hide) THEN
    RAISE EXCEPTION 'T3 hidden post still in feed_rank_page';
  END IF;
  IF EXISTS (SELECT 1 FROM public.announcement_feed(50, NULL) WHERE post_id = p_hide) THEN
    RAISE EXCEPTION 'T3 hidden post still in announcement_feed (installed builds)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wall_feed_page(ARRAY[d, a], 50) WHERE post_id = p_hide) THEN
    RAISE EXCEPTION 'T3 hidden post still in wall_feed_page';
  END IF;
  BEGIN
    INSERT INTO public.hidden_posts (user_id, post_id) VALUES (b, p_a);
    RAISE EXCEPTION 'T3 RLS: hid a post on someone else''s behalf';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO cnt FROM public.hidden_posts;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T3 RLS: b reads a''s hidden posts (%)', cnt; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feed_rank_page(50) WHERE post_id = p_hide) THEN
    RAISE EXCEPTION 'T3 a''s hide removed the post for b too';
  END IF;
  RESET ROLE;

  -- ── T4 FEED-05: muting an author drops her from For You and walls ───────
  INSERT INTO public.mutes (user_id, muted_user_id) VALUES (a, d);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO cnt FROM public.feed_rank_page(50) f JOIN public.posts p ON p.id = f.post_id WHERE p.author_id = d;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T4 muted author in For You: % rows', cnt; END IF;
  SELECT count(*) INTO cnt FROM public.announcement_feed(50, NULL) f JOIN public.posts p ON p.id = f.post_id WHERE p.author_id = d;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T4 muted author in announcement_feed: % rows', cnt; END IF;
  SELECT count(*) INTO cnt FROM public.wall_feed_page(ARRAY[d], 50);
  IF cnt <> 0 THEN RAISE EXCEPTION 'T4 muted author on following wall: % rows', cnt; END IF;
  SELECT count(*) INTO cnt FROM public.wall_feed_page(ARRAY[d], 50, NULL, NULL, NULL, false);
  IF cnt <> cardinality(wall_ids) - 1 THEN
    RAISE EXCEPTION 'T4 opened her profile on purpose: expected %, got %', cardinality(wall_ids) - 1, cnt;
  END IF;
  RESET ROLE;
  DELETE FROM public.mutes WHERE user_id = a AND muted_user_id = d;

  -- anon cannot call the new feed functions
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.feed_rank_page(5);
    RAISE EXCEPTION 'T4b anon executed feed_rank_page';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.follow_counts(a);
    RAISE EXCEPTION 'T4b anon executed follow_counts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- ── T5 ARC-03: a blocked author's review is not served ──────────────────
  SELECT id INTO e1 FROM public.archive_entries WHERE status = 'published' ORDER BY slug LIMIT 1;
  DELETE FROM public.archive_reviews WHERE entry_id = e1 AND author_id IN (a, b, c, d);
  INSERT INTO public.archive_reviews (entry_id, author_id, body, is_recommend, no_spoilers_ack)
  VALUES (e1, b, 'a review', true, true);
  INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES (a, b, 'blocked');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO cnt FROM public.archive_reviews WHERE entry_id = e1 AND author_id = b;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T5 blocker still reads the blocked author''s review'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO cnt FROM public.archive_reviews WHERE entry_id = e1 AND author_id = b;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T5 a bystander lost the review (%)', cnt; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO cnt FROM public.archive_reviews WHERE entry_id = e1 AND author_id = b;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T5 the author lost her own review'; END IF;
  RESET ROLE;
  DELETE FROM public.friendships WHERE requester_id = a AND addressee_id = b;

  -- ── T6 ARC-11: value follows stars; rejected profiles cannot vote ───────
  DELETE FROM public.archive_votes WHERE entry_id = e1 AND profile_id IN (a, b, c, d);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.archive_votes (entry_id, profile_id, value, stars) VALUES (e1, a, true, 1);
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'T6 insert {value:true, stars:1} was refused instead of derived';
  END;
  SELECT value INTO v FROM public.archive_votes WHERE entry_id = e1 AND profile_id = a;
  IF v THEN RAISE EXCEPTION 'T6 insert {value:true, stars:1} stored a recommend'; END IF;
  UPDATE public.archive_votes SET value = true WHERE entry_id = e1 AND profile_id = a;
  SELECT value INTO v FROM public.archive_votes WHERE entry_id = e1 AND profile_id = a;
  IF v THEN RAISE EXCEPTION 'T6 PATCH value:true on a 1-star vote inflated up_count'; END IF;
  UPDATE public.archive_votes SET stars = 5 WHERE entry_id = e1 AND profile_id = a;
  SELECT value INTO v FROM public.archive_votes WHERE entry_id = e1 AND profile_id = a;
  IF NOT v THEN RAISE EXCEPTION 'T6 5 stars is not a recommend'; END IF;
  RESET ROLE;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'archive_vote_value_matches_stars' AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%value = (stars >= 4)%'
  ) THEN
    RAISE EXCEPTION 'T6 archive_vote_value_matches_stars missing or not validated';
  END IF;
  UPDATE public.profiles SET vetting_status = 'rejected' WHERE id = c;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.archive_votes (entry_id, profile_id, value, stars) VALUES (e1, c, true, 5);
    RAISE EXCEPTION 'T6 a rejected profile voted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  UPDATE public.profiles SET vetting_status = 'approved' WHERE id = c;

  -- ── T7 ARC-10: three flags pull a note; staff restore; members cannot ───
  SELECT id INTO n1 FROM public.archive_content_notes WHERE status = 'visible' ORDER BY id LIMIT 1;
  DELETE FROM public.archive_note_flags WHERE note_id = n1;
  FOREACH ci IN ARRAY ARRAY[a, b] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', ci, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.archive_note_flags (note_id, reason) VALUES (n1, 'spoiler');
    RESET ROLE;
  END LOOP;
  SELECT status INTO t FROM public.archive_content_notes WHERE id = n1;
  IF t <> 'visible' THEN RAISE EXCEPTION 'T7 two flags already pulled the note'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.archive_note_flags (note_id, reason) VALUES (n1, 'abuse');
  RESET ROLE;
  SELECT status INTO t FROM public.archive_content_notes WHERE id = n1;
  IF t <> 'removed' THEN RAISE EXCEPTION 'T7 three flags did not pull the note (status %)', t; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.archive_content_notes SET status = 'visible' WHERE id = n1;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T7 a member restored a pulled note'; END IF;
  BEGIN
    UPDATE public.archive_content_notes SET label = 'rewritten' WHERE entry_id = e1;
    RAISE EXCEPTION 'T7 a member could write a note label';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  UPDATE public.profiles SET is_staff = true WHERE id = d;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.archive_content_notes SET status = 'visible' WHERE id = n1;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T7 staff could not restore a note'; END IF;
  RESET ROLE;
  UPDATE public.profiles SET is_staff = false WHERE id = d;

  -- ── T8 PRO-04: bio and display-name rules ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET bio = repeat('x', 5000) WHERE id = a;
    RAISE EXCEPTION 'T8 a 5000-character bio was saved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.profiles SET bio = repeat('x', 160) WHERE id = a;
  BEGIN
    UPDATE public.profiles SET display_name = 'Roxy Team' WHERE id = a;
    RAISE EXCEPTION 'T8 a member renamed herself to a staff name';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.profiles SET display_name = '   ' WHERE id = a;
    RAISE EXCEPTION 'T8 a blank display name was saved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.profiles SET display_name = 'Maya R' WHERE id = a;
  RESET ROLE;

  -- ── T9 notifications: ✿, comments, follows — and nobody else's ──────────
  DELETE FROM public.notifications WHERE user_id IN (a, b, c, d) AND type IN ('post_reaction', 'comment', 'follow', 'archive_revision');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.post_likes (post_id) VALUES (p_a);
  RESET ROLE;
  SELECT count(*) INTO cnt FROM public.notifications
   WHERE user_id = a AND actor_id = b AND type = 'post_reaction' AND link_path = '/community/post/' || p_a;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T9 ✿ did not notify the author (%)', cnt; END IF;
  SELECT count(*) INTO cnt FROM public.push_outbox o JOIN public.notifications n ON n.id = o.notification_id
   WHERE n.user_id = a AND n.type = 'post_reaction';
  IF cnt <> 1 THEN RAISE EXCEPTION 'T9 ✿ notification was not queued for push (%)', cnt; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.post_likes WHERE post_id = p_a;
  RESET ROLE;
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = a AND type = 'post_reaction';
  IF cnt <> 0 THEN RAISE EXCEPTION 'T9 unread ✿ survived the unlike'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.post_likes (post_id) VALUES (p_a);
  RESET ROLE;
  UPDATE public.notifications SET read_at = now() WHERE user_id = a AND type = 'post_reaction';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.post_likes WHERE post_id = p_a;
  INSERT INTO public.post_likes (post_id) VALUES (p_a);
  RESET ROLE;
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = a AND type = 'post_reaction';
  IF cnt <> 1 THEN RAISE EXCEPTION 'T9 like-unlike-like rang % times', cnt; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.post_likes (post_id) VALUES (p_a);
  RESET ROLE;
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = a AND actor_id = a;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T9 she was notified about her own ✿'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.comments (post_id, author_id, content) VALUES (p_a, b, 'lovely') RETURNING id INTO cm_b;
  RESET ROLE;
  SELECT count(*) INTO cnt FROM public.notifications
   WHERE user_id = a AND actor_id = b AND type = 'comment' AND body = 'lovely'
     AND link_path = '/community/post/' || p_a || '?comment=' || cm_b;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T9 comment did not notify the author (%)', cnt; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.comments (post_id, author_id, content, parent_id) VALUES (p_a, c, 'agreed', cm_b) RETURNING id INTO cm_c;
  RESET ROLE;
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = b AND actor_id = c AND type = 'comment';
  IF cnt <> 1 THEN RAISE EXCEPTION 'T9 a reply did not notify the parent''s author'; END IF;
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = a AND actor_id = c AND type = 'comment';
  IF cnt <> 1 THEN RAISE EXCEPTION 'T9 a reply did not notify the post''s author'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.comments WHERE id = cm_c;
  RESET ROLE;
  SELECT count(*) INTO cnt FROM public.notifications WHERE actor_id = c AND type = 'comment';
  IF cnt <> 0 THEN RAISE EXCEPTION 'T9 a deleted comment left % notifications with its words', cnt; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.follows (follower_id, followed_id) VALUES (b, a);
  RESET ROLE;
  SELECT count(*) INTO cnt FROM public.notifications
   WHERE user_id = a AND actor_id = b AND type = 'follow' AND link_path = '/user/' || b;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T9 follow did not notify (%)', cnt; END IF;

  -- Muted: c's follow and ✿ ring nothing for a.
  INSERT INTO public.mutes (user_id, muted_user_id) VALUES (a, c);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.follows (follower_id, followed_id) VALUES (c, a);
  INSERT INTO public.post_likes (post_id) VALUES (p_a);
  RESET ROLE;
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = a AND actor_id = c;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T9 a muted member still rings her (% rows)', cnt; END IF;
  DELETE FROM public.mutes WHERE user_id = a AND muted_user_id = c;

  -- An existing type still inserts (the type list was merged, not replaced).
  INSERT INTO public.notifications (user_id, actor_id, type, title) VALUES (a, b, 'channel_message', 'x');
  BEGIN
    INSERT INTO public.notifications (user_id, actor_id, type, title) VALUES (a, b, 'nonsense', 'x');
    RAISE EXCEPTION 'T9 notifications_type_check accepted an unknown type';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'notification_settings' AND column_name = 'activity'
                    AND column_default = 'true') THEN
    RAISE EXCEPTION 'T9 notification_settings.activity missing or not default-on';
  END IF;

  -- ARC-09: a decided Archive suggestion tells her.
  INSERT INTO public.archive_revisions (entry_id, submitted_by, patch, kind)
  VALUES (e1, a, '{"summary":"x"}'::jsonb, 'edit') RETURNING id INTO rev;
  UPDATE public.archive_revisions SET status = 'approved', reviewed_at = now(), reviewed_by = d WHERE id = rev;
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = a AND type = 'archive_revision';
  IF cnt <> 1 THEN RAISE EXCEPTION 'T9 decided suggestion did not notify (%)', cnt; END IF;

  -- ── T10 delight #6: prompts, shelf, follow counts ───────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.profile_prompts (prompt_key, answer) VALUES ('comfort_show', 'Carol');
  BEGIN
    INSERT INTO public.profile_prompts (prompt_key, answer) VALUES ('ask_me_about', repeat('y', 151));
    RAISE EXCEPTION 'T10 a 151-character prompt answer was saved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.profile_prompts (user_id, prompt_key, answer) VALUES (b, 'green_flag', 'x');
    RAISE EXCEPTION 'T10 wrote a prompt on someone else''s profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT array_agg(id ORDER BY slug) INTO ids FROM (
    SELECT id, slug FROM public.archive_entries WHERE status = 'published' ORDER BY slug LIMIT 5
  ) s;
  PERFORM public.set_archive_shelf(ids[1:4]);
  PERFORM public.set_archive_shelf(ARRAY[ids[4], ids[3], ids[2], ids[1]]);
  SELECT array_agg(entry_id ORDER BY slot) INTO shelf FROM public.archive_shelf WHERE profile_id = a;
  IF shelf IS DISTINCT FROM ARRAY[ids[4], ids[3], ids[2], ids[1]] THEN
    RAISE EXCEPTION 'T10 reordering the shelf did not stick';
  END IF;
  BEGIN
    PERFORM public.set_archive_shelf(ids);
    RAISE EXCEPTION 'T10 a shelf took five';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  SELECT * INTO r FROM public.follow_counts(b);
  IF NOT r.follows_you THEN RAISE EXCEPTION 'T10 follow_counts: b follows a but follows_you is false'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO cnt FROM public.profile_prompts WHERE user_id = a;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T10 a member cannot read another''s prompt'; END IF;
  SELECT count(*) INTO cnt FROM public.archive_shelf WHERE profile_id = a;
  IF cnt <> 4 THEN RAISE EXCEPTION 'T10 a member cannot read another''s shelf (%)', cnt; END IF;
  SELECT * INTO r FROM public.follow_counts(a);
  IF r.followers < 2 THEN RAISE EXCEPTION 'T10 follow_counts followers %, expected >= 2', r.followers; END IF;
  RESET ROLE;
  INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES (a, c, 'blocked');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO cnt FROM public.profile_prompts WHERE user_id = a;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T10 a blocked member reads her prompts'; END IF;
  SELECT count(*) INTO cnt FROM public.follow_counts(a);
  IF cnt <> 0 THEN RAISE EXCEPTION 'T10 a blocked member reads her follow counts'; END IF;
  RESET ROLE;

  RAISE NOTICE '133 feed/archive/profile check PASS';
END $$;
