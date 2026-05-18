-- Refresh feed demo content: fix empty media_urls, re-seed all post types, join all users to public communities.
-- Spec: docs/superpowers/specs/2026-04-24-content-feed-design.md

-- ── 1. Every profile → every public community (Connect feed requires memberships) ──
INSERT INTO public.community_members (community_id, user_id, role)
SELECT c.id, p.id, 'member'
FROM   public.communities c
CROSS  JOIN public.profiles p
WHERE  c.is_private = false
ON CONFLICT (community_id, user_id) DO NOTHING;

-- ── 2. Remove broken rows (photo/gallery without media) ─────────────────────────
DELETE FROM public.posts
WHERE post_type IN ('photo', 'gallery')
  AND (media_urls IS NULL OR media_urls = '{}');

-- ── 3. Re-seed seed-author posts (idempotent) ─────────────────────────────────
DELETE FROM public.posts
WHERE author_id IN (
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000005'::uuid
);

-- standard
INSERT INTO public.posts (author_id, community_id, content, post_type, like_count, comment_count)
SELECT p.author_id, c.id, p.content, 'standard', p.likes, p.comments
FROM (VALUES
  ('lesbians-of-london','aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'Anyone else think we need a monthly Lesbians of London hike? South Downs — easy pace, snack stops. Drop a 🙋 if you''d come!', 12, 3),
  ('bi-collective','aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Real talk: bi erasure is exhausting. Still bi. Always bi. 💗💜💙', 8, 2),
  ('queer-gamers','aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Weekly game night this Friday — BG3 Dark Urge campaign 🎮 No spoilers please 🙏', 15, 5),
  ('wlw-entrepreneurs','aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'Looking for a co-founder for a queer wellness app. Technical background preferred. DM me!', 6, 1),
  ('trans-nb-support','aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'You are welcome here exactly as you are. This space is for trans and non-binary WLW 🏳️‍⚧️', 20, 4)
) AS p(slug, author_id, content, likes, comments)
JOIN public.communities c ON c.slug = p.slug;

-- photo (external URLs — render without Supabase storage)
INSERT INTO public.posts (author_id, community_id, content, post_type, media_urls, like_count, comment_count)
SELECT p.author_id, c.id, p.content, 'photo', p.media_urls, p.likes, p.comments
FROM (VALUES
  ('lesbians-of-london','aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'South Downs recce walk ☀️ Scouting our community hike route. Who''s in?',
   ARRAY['https://picsum.photos/seed/roxy-hike/800/600']::text[], 42, 8),
  ('bi-collective','aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Bi+ coffee morning was so good 🫶 See you at the next one!',
   ARRAY['https://picsum.photos/seed/roxy-coffee/800/600']::text[], 35, 6),
  ('queer-gamers','aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'New gaming setup is DONE 🎮🏳️‍⚧️ Never leaving this chair.',
   ARRAY['https://picsum.photos/seed/roxy-gaming/800/600']::text[], 51, 12),
  ('wlw-entrepreneurs','aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'New collection dropped 🌿 Ethically sourced. 18 months in the making.',
   ARRAY['https://picsum.photos/seed/roxy-fashion/800/1000']::text[], 28, 4),
  ('trans-nb-support','aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Trans Joy Day irl 🌈 Wore my favourite fit today just because I could.',
   ARRAY['https://picsum.photos/seed/roxy-joy/600/800']::text[], 67, 15)
) AS p(slug, author_id, content, media_urls, likes, comments)
JOIN public.communities c ON c.slug = p.slug;

-- gallery
INSERT INTO public.posts (author_id, community_id, content, post_type, media_urls, like_count, comment_count)
SELECT p.author_id, c.id, p.content, 'gallery', p.media_urls, p.likes, p.comments
FROM (VALUES
  ('lesbians-of-london','aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Pride last year 🏳️‍🌈 Could not pick one favourite — swipe through!',
   ARRAY[
     'https://picsum.photos/seed/pride1/800/600',
     'https://picsum.photos/seed/pride2/800/600',
     'https://picsum.photos/seed/pride3/800/600',
     'https://picsum.photos/seed/pride4/800/600'
   ]::text[], 88, 22),
  ('bi-collective','aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'Bi+ panel night 📸 Thank you to all our speakers.',
   ARRAY[
     'https://picsum.photos/seed/panel1/800/600',
     'https://picsum.photos/seed/panel2/800/600',
     'https://picsum.photos/seed/panel3/800/600'
   ]::text[], 45, 9),
  ('queer-gamers','aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'IRL gaming café recap 🎮 Vibes were immaculate.',
   ARRAY[
     'https://picsum.photos/seed/cafe1/800/600',
     'https://picsum.photos/seed/cafe2/800/600',
     'https://picsum.photos/seed/cafe3/800/600'
   ]::text[], 62, 14)
) AS p(slug, author_id, content, media_urls, likes, comments)
JOIN public.communities c ON c.slug = p.slug;

-- video
INSERT INTO public.posts (
  author_id, community_id, content, post_type,
  video_url, video_thumbnail_url, video_duration_secs, video_aspect_ratio,
  like_count, comment_count
)
SELECT p.author_id, c.id, p.content, 'video',
       p.video_url, p.thumb, p.dur, p.ratio, p.likes, p.comments
FROM (VALUES
  ('queer-gamers','aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Dev log #3 — queer visual novel 🎮 New dialogue system + enemies-to-lovers route!',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
   'https://picsum.photos/seed/devlog-thumb/800/450', 60, '16:9', 120, 28),
  ('lesbians-of-london','aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'Community walk vlog 🌿 So wholesome. Full series coming to the calendar.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
   'https://picsum.photos/seed/walk-vlog/800/450', 90, '16:9', 95, 18),
  ('wlw-entrepreneurs','aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'Studio tour 🧵 Every piece made here by our small team.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
   'https://picsum.photos/seed/studio-tour/800/450', 58, '16:9', 78, 11)
) AS p(slug, author_id, content, video_url, thumb, dur, ratio, likes, comments)
JOIN public.communities c ON c.slug = p.slug;

-- poll
INSERT INTO public.posts (author_id, community_id, content, post_type, like_count, comment_count)
SELECT p.author_id, c.id, p.content, 'poll', p.likes, p.comments
FROM (VALUES
  ('lesbians-of-london','aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'What should our next event be? 🗳️
• 🎬 Film night
• 🥾 Day hike
• 🍹 Rooftop social
• 🎨 Queer art workshop', 24, 31),
  ('bi-collective','aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Best bi+ rep in fiction? 🗳️
• Rosa Diaz (Brooklyn 99)
• Villanelle (Killing Eve)
• Darryl Whitefeather
• Write your own!', 18, 25),
  ('queer-gamers','aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'Next community game night? 🗳️
• Baldur''s Gate 3
• Stardew co-op
• Jackbox
• Mods decide', 33, 40)
) AS p(slug, author_id, content, likes, comments)
JOIN public.communities c ON c.slug = p.slug;

-- resource
INSERT INTO public.posts (author_id, community_id, content, post_type, like_count, comment_count)
SELECT p.author_id, c.id, p.content, 'resource', p.likes, p.comments
FROM (VALUES
  ('lesbians-of-london','aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   '📚 WLW fiction picks:
1. Girl, Woman, Other — Evaristo
2. Detransition, Baby — Peters
3. Fingersmith — Waters
Add yours in comments!', 30, 12),
  ('bi-collective','aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   '🔗 UK bi+ resources: BiUK, Stonewall bi+ hub, wellbeing report 2024 💗💜💙', 22, 7),
  ('trans-nb-support','aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   '📋 UK trans healthcare: GIC referrals, informed consent clinics, deed poll name change guide 🏳️‍⚧️', 41, 16)
) AS p(slug, author_id, content, likes, comments)
JOIN public.communities c ON c.slug = p.slug;

-- roxy_link → Speed Dating
INSERT INTO public.posts (
  author_id, community_id, content, post_type,
  link_type, link_entity_id, link_community_id,
  like_count, comment_count
)
SELECT
  p.author_id, c.id, p.content, 'roxy_link',
  'game',
  (SELECT id FROM public.games WHERE name = 'Speed Dating' LIMIT 1),
  c.id,
  p.likes, p.comments
FROM (VALUES
  ('lesbians-of-london','aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'Speed Dating is live! 💫 5 minutes, one person — see if the spark is there 👇', 55, 19),
  ('queer-gamers','aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Speed Dating in Queer Gamers 🎮❤️ First question: BG3 or Stardew? 😂', 48, 14),
  ('bi-collective','aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Speed Dating just dropped 💜 Connect in 5 minutes. No pressure, just vibes.', 39, 11)
) AS p(slug, author_id, content, likes, comments)
JOIN public.communities c ON c.slug = p.slug;

-- ── 4. Feed scores (visual types rank higher in Discover FYP) ─────────────────
UPDATE public.posts
SET feed_score = public.compute_feed_score(like_count, comment_count, save_count, created_at)
  + CASE post_type
      WHEN 'video'     THEN 50
      WHEN 'gallery'   THEN 40
      WHEN 'photo'     THEN 35
      WHEN 'roxy_link' THEN 30
      WHEN 'poll'      THEN 15
      WHEN 'resource'  THEN 15
      ELSE 0
    END
WHERE author_id IN (
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000005'::uuid
);
