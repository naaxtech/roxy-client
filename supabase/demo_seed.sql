-- ============================================================
-- demo_seed.sql — richer dummy data so every feature has something to show.
-- Idempotent: safe to re-run. Adds to dev_seed.sql, never deletes real rows.
-- ============================================================

DO $$
DECLARE
  maya  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  zoe   uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  cam   uuid := 'aaaaaaaa-0000-0000-0000-000000000004';
  sky   uuid := 'aaaaaaaa-0000-0000-0000-000000000005';
  roxy  uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  lol   uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  books uuid := 'bbbbbbbb-0000-0000-0000-000000000003';

  c_roxy uuid; c_lol uuid; c_books uuid;
  g_roxy uuid; g_lol uuid; g_books uuid;
  g_events uuid; g_walks uuid; g_month uuid;
  p1 uuid; p2 uuid; p3 uuid;
BEGIN
  SELECT id INTO c_roxy  FROM public.communities WHERE slug = 'roxy-official';
  SELECT id INTO c_lol   FROM public.communities WHERE slug = 'lesbians-of-london';
  SELECT id INTO c_books FROM public.communities WHERE slug = 'queer-book-club';

  -- 1. Everyone is a member everywhere (so group chat and posts are visible)
  INSERT INTO public.community_members (community_id, user_id, role)
  SELECT c.id, u.id, 'member'
  FROM (VALUES (c_roxy),(c_lol),(c_books)) AS c(id)
  CROSS JOIN (VALUES (maya),(zoe),(cam),(sky)) AS u(id)
  ON CONFLICT (community_id, user_id) DO NOTHING;

  -- 2. More channels per community
  INSERT INTO public.community_channels (community_id, slug, name, topic, position, is_default, created_by) VALUES
    (c_roxy,  'announcements',  'announcements',  'What the team shipped.',         1, false, roxy),
    (c_roxy,  'events',         'events',         'Meetups, calls, watch parties.', 2, false, roxy),
    (c_lol,   'walks',          'walks',          'The next walk, and whose boots.', 1, false, lol),
    (c_lol,   'introductions',  'introductions',  'Say hi.',                         2, false, lol),
    (c_books, 'this-month',     'this-month',     'The current pick.',               1, false, books),
    (c_books, 'recommendations','recommendations','What to read next.',              2, false, books)
  ON CONFLICT (community_id, slug) DO NOTHING;

  SELECT id INTO g_roxy   FROM public.community_channels WHERE community_id = c_roxy  AND slug = 'general';
  SELECT id INTO g_lol    FROM public.community_channels WHERE community_id = c_lol   AND slug = 'general';
  SELECT id INTO g_books  FROM public.community_channels WHERE community_id = c_books AND slug = 'general';
  SELECT id INTO g_events FROM public.community_channels WHERE community_id = c_roxy  AND slug = 'events';
  SELECT id INTO g_walks  FROM public.community_channels WHERE community_id = c_lol   AND slug = 'walks';
  SELECT id INTO g_month  FROM public.community_channels WHERE community_id = c_books AND slug = 'this-month';

  -- 3. Channel messages — make the group chat look lived-in
  INSERT INTO public.community_channel_messages (channel_id, sender_id, body, created_at)
  SELECT v.channel_id, v.sender_id, v.body, v.created_at
  FROM (VALUES
    (g_roxy,   maya,  'hi everyone! just landed and the energy in here is great 💜', now() - interval '2 days'),
    (g_roxy,   zoe,   'welcome!! what part of the app should I try first?',         now() - interval '2 days' + interval '4 minutes'),
    (g_roxy,   roxy,  'start with Discover — the feed there is 👌',                 now() - interval '2 days' + interval '9 minutes'),
    (g_roxy,   cam,   'the Archive is my favourite honestly. finally a place to argue about films', now() - interval '1 day'),
    (g_roxy,   sky,   'ok but the reels loop. I lost twenty minutes',               now() - interval '1 day' + interval '3 minutes'),
    (g_roxy,   maya,  'same. whoever seeded those knows what they are doing',       now() - interval '6 hours'),
    (g_events, roxy,  'community call this Thursday 8pm — link in Events 🎉',       now() - interval '5 hours'),
    (g_lol,    lol,   'Sunday walk is ON. Hampstead, 10am, coffee after.',          now() - interval '3 days'),
    (g_lol,    maya,  'I''m in. bringing the good boots this time',                 now() - interval '3 days' + interval '20 minutes'),
    (g_lol,    cam,   'can I join even if I walk slow?',                            now() - interval '2 days'),
    (g_lol,    lol,   'of course. slow pace by design 💜',                           now() - interval '2 days' + interval '5 minutes'),
    (g_walks,  sky,   'weather looks dry for Sunday',                                now() - interval '1 day'),
    (g_books,  books, 'this month we are reading Fingersmith. bring feelings.',     now() - interval '4 days'),
    (g_books,  zoe,   'I read it in one sitting and I have THOUGHTS',               now() - interval '3 days'),
    (g_books,  cam,   'no spoilers! I am halfway',                                  now() - interval '2 days'),
    (g_month,  zoe,   'the twist. that is all.',                                    now() - interval '1 day')
  ) AS v(channel_id, sender_id, body, created_at)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.community_channel_messages m
    WHERE m.channel_id = v.channel_id AND m.sender_id = v.sender_id AND m.body = v.body
  );

  -- 4. Posts (thoughts + a couple of media) with emoji reactions
  INSERT INTO public.posts (author_id, community_id, content, post_type, reaction_counts, like_count, comment_count, feed_score)
  SELECT v.author_id, v.community_id, v.content, v.post_type, v.reaction_counts, v.like_count, v.comment_count, v.feed_score
  FROM (VALUES
    (maya, null::uuid, 'hot take: the best first date is a walk + coffee, not a film. you can actually talk.', 'standard', '{"❤️":12,"💜":7,"😂":2}'::jsonb, 21, 0, 95),
    (zoe,  null::uuid, 'just finished Fingersmith and I need to scream about it with someone',                  'standard', '{"❤️":9,"😮":6,"💜":4}'::jsonb, 18, 0, 90),
    (cam,  null::uuid, 'reminder that rest is productive and your worth is not your output',                    'standard', '{"❤️":15,"💜":9}'::jsonb,       24, 0, 97),
    (sky,  null::uuid, 'shipped the dialogue system on the visual novel today. it finally talks back',          'standard', '{"😂":5,"❤️":11,"😮":3}'::jsonb, 16, 0, 88),
    (roxy, null::uuid, 'you asked for it: GIF replies on thoughts just landed 💜',                              'standard', '{"💜":20,"😮":8,"😂":4}'::jsonb, 30, 0, 99)
  ) AS v(author_id, community_id, content, post_type, reaction_counts, like_count, comment_count, feed_score)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.posts p WHERE p.author_id = v.author_id AND p.content = v.content
  );

  -- 5. Comments / replies on those thoughts (counts auto-bump via trigger)
  SELECT id INTO p1 FROM public.posts WHERE author_id = maya AND content LIKE 'hot take:%'  LIMIT 1;
  SELECT id INTO p2 FROM public.posts WHERE author_id = zoe  AND content LIKE 'just finished Fingersmith%' LIMIT 1;
  SELECT id INTO p3 FROM public.posts WHERE author_id = cam  AND content LIKE 'reminder that rest%' LIMIT 1;

  IF p1 IS NOT NULL THEN
    INSERT INTO public.comments (post_id, author_id, content)
    SELECT v.post_id, v.author_id, v.content
    FROM (VALUES (p1, zoe, 'hard agree. films give you nothing to talk about after'), (p1, cam, 'walk + coffee is elite. plus you see how they treat the barista')) AS v(post_id, author_id, content)
    WHERE NOT EXISTS (SELECT 1 FROM public.comments c WHERE c.post_id = v.post_id AND c.author_id = v.author_id AND c.content = v.content);
  END IF;
  IF p2 IS NOT NULL THEN
    INSERT INTO public.comments (post_id, author_id, content)
    SELECT v.post_id, v.author_id, v.content
    FROM (VALUES (p2, cam, 'no spoilers!!'), (p2, maya, 'meet me in #this-month when you are ready')) AS v(post_id, author_id, content)
    WHERE NOT EXISTS (SELECT 1 FROM public.comments c WHERE c.post_id = v.post_id AND c.author_id = v.author_id AND c.content = v.content);
  END IF;
  IF p3 IS NOT NULL THEN
    INSERT INTO public.comments (post_id, author_id, content)
    SELECT v.post_id, v.author_id, v.content
    FROM (VALUES (p3, sky, 'needed this today'), (p3, zoe, 'saving this')) AS v(post_id, author_id, content)
    WHERE NOT EXISTS (SELECT 1 FROM public.comments c WHERE c.post_id = v.post_id AND c.author_id = v.author_id AND c.content = v.content);
  END IF;

  -- 6. Games + community games
  INSERT INTO public.games (slug, name, description, emoji, category, short_description, publisher_type, status, url) VALUES
    ('two-truths-one-lie', 'Two Truths & One Lie', 'Guess the fib.',      '🤥', 'icebreaker', 'Two truths, one lie. Spot the lie.', 'roxy', 'live', null),
    ('would-you-rather',   'Would You Rather',     'Impossible choices.', '🤔', 'icebreaker', 'Would you rather, wlw edition.',    'roxy', 'live', null),
    ('finish-the-lyric',   'Finish the Lyric',     'Name that tune.',     '🎤', 'trivia',     'Finish the sapphic lyric.',         'roxy', 'live', null)
  ON CONFLICT (slug) DO NOTHING;

  INSERT INTO public.community_games (community_id, game_id)
  SELECT c.id, g.id
  FROM public.communities c
  CROSS JOIN public.games g
  WHERE c.id IN (c_roxy, c_lol, c_books)
    AND g.slug IN ('two-truths-one-lie','would-you-rather','finish-the-lyric')
  ON CONFLICT (community_id, game_id) DO NOTHING;

  -- 7. Archive votes so the catalogue shows real ratings
  INSERT INTO public.archive_votes (entry_id, profile_id, value, stars)
  SELECT e.id, v.pid, v.stars >= 4, v.stars
  FROM (SELECT id FROM public.archive_entries WHERE status = 'published' ORDER BY id LIMIT 20) e
  CROSS JOIN (VALUES (maya,5),(zoe,4),(cam,3),(sky,5),(roxy,4)) AS v(pid, stars)
  ON CONFLICT (entry_id, profile_id) DO NOTHING;

  RAISE NOTICE 'Demo seed complete.';
END $$;
