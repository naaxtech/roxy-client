-- supabase/migrations/048_seed_feed_v2_content.sql
-- Re-seeds dev content covering all feed v2 post types + fresh future events
-- + community_games speed dating toggle for every community.
--
-- Safe to re-run: community_games uses ON CONFLICT DO NOTHING.
-- Events are re-created fresh (seed host_ids only — never touches real users).
-- Posts use ON CONFLICT DO NOTHING (no PK conflict possible, guard is comment).

-- ── 1. Speed Dating toggle: enabled for every community ───────────────────────
INSERT INTO public.community_games (community_id, game_id, enabled_by)
SELECT c.id, g.id, NULL
FROM   public.communities c
CROSS  JOIN public.games g
WHERE  g.name = 'Speed Dating'
ON CONFLICT (community_id, game_id) DO NOTHING;

-- ── 2. Refresh seed events (delete stale → re-insert with future dates) ───────
-- Only touches rows from seed author UUIDs — safe.
DELETE FROM public.events
WHERE host_id IN (
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000005'::uuid
);

INSERT INTO public.events (
  community_id, host_id, title, description, event_type,
  starts_at, ends_at, location_text, max_attendees
)
SELECT c.id, e.host_id, e.title, e.description, e.event_type,
       e.starts_at, e.ends_at, e.location_text, e.max_attendees
FROM (VALUES
  -- ── lesbians-of-london ──────────────────────────────────────────────────────
  ('lesbians-of-london',
   'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'Lesbians of London Spring Social',
   'Casual drinks and meetup. All lesbians, wlw, and friends welcome. Newbies especially encouraged!',
   'in_person', now() + interval '5 days',  now() + interval '5 days'  + interval '3 hours',
   'The Royal Vauxhall Tavern, London', 60),

  ('lesbians-of-london',
   'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'Sapphic Cinema Night',
   'Two classic wlw films back-to-back. Discussion after. Popcorn provided.',
   'in_person', now() + interval '14 days', now() + interval '14 days' + interval '4 hours',
   'Rio Cinema, Dalston, London', 80),

  ('lesbians-of-london',
   'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'South Downs Hike & Picnic',
   'Easy to moderate hike with a scenic picnic stop. All fitness levels welcome.',
   'in_person', now() + interval '22 days', now() + interval '22 days' + interval '6 hours',
   'Brighton Station, Brighton', 25),

  -- ── bi-collective ───────────────────────────────────────────────────────────
  ('bi-collective',
   'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Bi+ Visibility Coffee Morning',
   'Relaxed bi+ social — just us, good coffee, and good conversation.',
   'in_person', now() + interval '8 days',  now() + interval '8 days'  + interval '2 hours',
   'Redemption Roasters, Bethnal Green, London', 20),

  ('bi-collective',
   'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'Bi+ Book Club: The Price of Salt',
   'Monthly virtual book club. This month: Patricia Highsmith''s seminal classic.',
   'online',    now() + interval '16 days', now() + interval '16 days' + interval '90 minutes',
   NULL, NULL),

  ('bi-collective',
   'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Navigating Identity: Panel & Q+A',
   'Community panel — bi+, pan, and fluid speakers. Open Q&A. All welcome.',
   'hybrid',    now() + interval '29 days', now() + interval '29 days' + interval '2 hours',
   'Queer Britain Museum, London + Livestream', 50),

  -- ── queer-gamers ────────────────────────────────────────────────────────────
  ('queer-gamers',
   'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Queer Gamers Weekly: BG3 Campaign Finale',
   'Finishing our Baldur''s Gate 3 Dark Urge campaign! Voice + video, open to spectators.',
   'online',    now() + interval '3 days',  now() + interval '3 days'  + interval '4 hours',
   NULL, NULL),

  ('queer-gamers',
   'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'Queer Visual Novel Showcase',
   'Community devs share WIP demos. Feedback with supportive vibes only.',
   'online',    now() + interval '19 days', now() + interval '19 days' + interval '3 hours',
   NULL, 30),

  ('queer-gamers',
   'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'IRL Gaming Café Night — London',
   'Bring your Switch, your laptop, or just your competitive spirit. Limited spots!',
   'in_person', now() + interval '26 days', now() + interval '26 days' + interval '3 hours',
   'Loading Bar, Stoke Newington, London', 15),

  -- ── wlw-entrepreneurs ───────────────────────────────────────────────────────
  ('wlw-entrepreneurs',
   'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'From £800 to £100k: Building an Ethical Fashion Brand',
   'Cam shares the full story — sourcing, pricing, marketing, every mistake. No filter.',
   'in_person', now() + interval '11 days', now() + interval '11 days' + interval '2 hours',
   'Shoreditch Works, London', 40),

  ('wlw-entrepreneurs',
   'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'WLW Co-Founder Speed Round',
   'Five-minute speed intros with potential co-founders. Bring a 2-min pitch.',
   'online',    now() + interval '18 days', now() + interval '18 days' + interval '90 minutes',
   NULL, 50),

  ('wlw-entrepreneurs',
   'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Freelance Queer Creatives: Rates & Boundaries',
   'Workshop on rate-setting, client limits, and navigating visible queerness in freelance work.',
   'online',    now() + interval '31 days', now() + interval '31 days' + interval '2 hours',
   NULL, NULL),

  -- ── trans-nb-support ────────────────────────────────────────────────────────
  ('trans-nb-support',
   'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Trans Joy Hangout',
   'Monthly low-key video hangout. No agenda, just vibes and community.',
   'online',    now() + interval '9 days',  now() + interval '9 days'  + interval '90 minutes',
   NULL, NULL),

  ('trans-nb-support',
   'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'Resources & Rights: Knowing Your Options in 2026',
   'Panel covering healthcare pathways, legal name/gender changes, and community resources in the UK.',
   'hybrid',    now() + interval '24 days', now() + interval '24 days' + interval '2 hours',
   'Online + London venue TBC', 100)
) AS e(slug, host_id, title, description, event_type, starts_at, ends_at, location_text, max_attendees)
JOIN public.communities c ON c.slug = e.slug;

-- ── 3. Seed all feed v2 post types ───────────────────────────────────────────
-- Covers: standard, photo, gallery, video, poll, resource, roxy_link
-- Spread across all 5 communities from multiple seed users.

-- ── standard posts (community narrative / text) ──────────────────────────────
INSERT INTO public.posts (author_id, community_id, content, post_type)
SELECT p.author_id, c.id, p.content, 'standard'
FROM (VALUES
  -- lesbians-of-london
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'Anyone else think we need a monthly Lesbians of London hike? Thinking something in the South Downs — easy pace, lots of snack stops. Drop a 🙋 if you''d come!'),
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'Just moved to Hackney and the queer scene here has already welcomed me so warmly. Thank you to everyone in this community. It means everything. 🏳️‍🌈'),
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Hot take: the best lesbian bars in London are the ones nobody outside the community knows about. Not gatekeeping — just appreciating. Share your hidden gem below 🌸'),
  -- bi-collective
  ('bi-collective', 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Real talk: bi erasure is exhausting. Someone told me today I''m "basically straight now" because I''m dating a woman. Still bi. Always bi. 💗💜💙'),
  ('bi-collective', 'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'Starting a thread: best bi+ representation in media recently? I''ll go first — Rosa Diaz in Brooklyn Nine-Nine still lives in my head rent-free.'),
  ('bi-collective', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Gentle reminder that the bi+ umbrella includes bisexual, pansexual, omnisexual, fluid, queer, and more. All of you belong here. No gatekeeping, no gold stars 💜'),
  -- queer-gamers
  ('queer-gamers', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Weekly game night this Friday — finishing our BG3 Dark Urge campaign 🎮 Voice chat link in pinned post. No spoilers in comments please 🙏'),
  ('queer-gamers', 'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'Cannot believe how well Celeste handled Madeline''s identity. Didn''t say a word and yet said everything. What games hit you like that — where the queer coding just *got* you?'),
  ('queer-gamers', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'Hades normalised polyamory and queerness in mainstream gaming with zero fanfare. Zagreus can date multiple people of various genders and nobody makes it weird. That''s the energy.'),
  -- wlw-entrepreneurs
  ('wlw-entrepreneurs', 'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'Most common question I get: "how do you find queer-friendly investors?" Honest answer: filter out red flags. One line in the deck — "we prioritise inclusive workplaces" — surfaces a lot. Happy to share the full template.'),
  ('wlw-entrepreneurs', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'Looking for a co-founder for a community-led wellness app specifically for queer women. Technical background preferred. DM me — I have a deck and a lot of passion.'),
  ('wlw-entrepreneurs', 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Accountability thread for this month! Drop what you''re working on. I''ll start: launch my Substack, pitch 3 new clients, and actually take a weekend off. Holding myself to it publicly 😅'),
  -- trans-nb-support
  ('trans-nb-support', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'This community exists to hold space for trans and non-binary WLW at every stage of their journey. You are welcome here exactly as you are. 🏳️‍⚧️'),
  ('trans-nb-support', 'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'Trans joy is political, radical, and absolutely necessary. Sharing a reminder that your existence is an act of resistance. So proud of everyone in this space. 💜')
) AS p(slug, author_id, content)
JOIN public.communities c ON c.slug = p.slug;

-- ── photo posts ──────────────────────────────────────────────────────────────
INSERT INTO public.posts (author_id, community_id, content, post_type, media_urls)
SELECT p.author_id, c.id, p.content, 'photo', p.media_urls
FROM (VALUES
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'Last weekend''s South Downs recce walk was everything ☀️ Scouting the perfect route for our community hike next month. Who''s in?',
   ARRAY['https://picsum.photos/seed/roxy-hike/800/600']),
  ('bi-collective', 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Bi+ coffee morning was so good 🫶 So many brilliant humans in one room. See you all at the next one!',
   ARRAY['https://picsum.photos/seed/roxy-coffee/800/600']),
  ('queer-gamers', 'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'My new gaming setup is DONE and I am never leaving this chair. Trans flag art print by @queerpixels 🎮🏳️‍⚧️',
   ARRAY['https://picsum.photos/seed/roxy-gaming/800/600']),
  ('wlw-entrepreneurs', 'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'New collection dropped today 🌿 Every piece ethically sourced, every supplier a living wage employer. This one took 18 months. So proud.',
   ARRAY['https://picsum.photos/seed/roxy-fashion/800/1000']),
  ('trans-nb-support', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Trans Joy Day irl 🌈 Wore my favourite fit today just because I could. Took me years to feel this comfortable. Still feels surreal.',
   ARRAY['https://picsum.photos/seed/roxy-joy/600/800'])
) AS p(slug, author_id, content, media_urls)
JOIN public.communities c ON c.slug = p.slug;

-- ── gallery posts (3+ images) ─────────────────────────────────────────────────
INSERT INTO public.posts (author_id, community_id, content, post_type, media_urls)
SELECT p.author_id, c.id, p.content, 'gallery', p.media_urls
FROM (VALUES
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Lesbians of London at Pride last year 🏳️‍🌈 I cannot pick a favourite photo so you get all of them. Save the date — we''re doing it bigger this year.',
   ARRAY[
     'https://picsum.photos/seed/pride1/800/600',
     'https://picsum.photos/seed/pride2/800/600',
     'https://picsum.photos/seed/pride3/800/600',
     'https://picsum.photos/seed/pride4/800/600'
   ]),
  ('bi-collective', 'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'Bi+ panel photos from last month''s event 📸 Such a brilliant evening. Thank you to our speakers and everyone who came.',
   ARRAY[
     'https://picsum.photos/seed/panel1/800/600',
     'https://picsum.photos/seed/panel2/800/600',
     'https://picsum.photos/seed/panel3/800/600'
   ]),
  ('queer-gamers', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'IRL gaming café night recap 🎮 The vibes were immaculate. Already planning the next one!',
   ARRAY[
     'https://picsum.photos/seed/cafe1/800/600',
     'https://picsum.photos/seed/cafe2/800/600',
     'https://picsum.photos/seed/cafe3/800/600'
   ])
) AS p(slug, author_id, content, media_urls)
JOIN public.communities c ON c.slug = p.slug;

-- ── video posts ───────────────────────────────────────────────────────────────
INSERT INTO public.posts (
  author_id, community_id, content, post_type,
  video_url, video_thumbnail_url, video_duration_secs, video_aspect_ratio
)
SELECT p.author_id, c.id, p.content, 'video',
       p.video_url, p.video_thumbnail_url, p.video_duration_secs, p.video_aspect_ratio
FROM (VALUES
  ('queer-gamers', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'Dev log #3 for my queer visual novel 🎮 Showing off the new dialogue system and the enemies-to-lovers route I''ve been building. Feedback welcome!',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
   'https://picsum.photos/seed/devlog-thumb/800/450',
   60, '16:9'),
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'Little vlog from our last community walk 🌿 Turned out so wholesome. Adding a full walk series to the community calendar.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
   'https://picsum.photos/seed/walk-vlog/800/450',
   90, '16:9'),
  ('wlw-entrepreneurs', 'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'Quick 60-second tour of our studio and production floor 🧵 Every item you see is made here, by hand, by our small team.',
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
   'https://picsum.photos/seed/studio-tour/800/450',
   58, '16:9')
) AS p(slug, author_id, content, video_url, video_thumbnail_url, video_duration_secs, video_aspect_ratio)
JOIN public.communities c ON c.slug = p.slug;

-- ── poll posts ────────────────────────────────────────────────────────────────
-- No separate poll_options table yet — content holds the question + options as text.
INSERT INTO public.posts (author_id, community_id, content, post_type)
SELECT p.author_id, c.id, p.content, 'poll'
FROM (VALUES
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'What should our next community event be? 🗳️
• 🎬 Film night
• 🥾 Day hike
• 🍹 Rooftop social
• 🎨 Queer art workshop'),
  ('bi-collective', 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Best bi+ rep in fiction right now? 🗳️
• 📺 Rosa Diaz (Brooklyn 99)
• 📚 Villanelle (Killing Eve)
• 🎬 Darryl Whitefeather (Crazy Ex-Girlfriend)
• ✍️ Write your own in comments!'),
  ('queer-gamers', 'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'What game should we play at next month''s community night? 🗳️
• 🗡️ Baldur''s Gate 3
• 🌾 Stardew Valley co-op
• 🃏 Jackbox party games
• 🎮 Let the mods decide'),
  ('wlw-entrepreneurs', 'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
   'Biggest challenge running a queer business right now? 🗳️
• 💸 Finding queer-friendly investors
• 📣 Marketing to community without tokenism
• 🤝 Building a queer supply chain
• 😤 Customer education / allyship fatigue'),
  ('trans-nb-support', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'What kind of content helps you most in this community? 🗳️
• 📋 Practical resources (healthcare, legal)
• 🫂 Emotional support threads
• 🎉 Trans joy / celebration posts
• 🗣️ Lived experience stories')
) AS p(slug, author_id, content)
JOIN public.communities c ON c.slug = p.slug;

-- ── resource posts ────────────────────────────────────────────────────────────
INSERT INTO public.posts (author_id, community_id, content, post_type)
SELECT p.author_id, c.id, p.content, 'resource'
FROM (VALUES
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   '📚 Resource drop: best WLW fiction published this year.
1. "The Maid''s Version" — Cassandra Clarke
2. "Girl, Woman, Other" — Bernardine Evaristo (re-read worthy)
3. "Detransition, Baby" — Torrey Peters
4. "Long Live the Tribe of Fatherless Girls" — T Kira Madden
Drop your recs in the comments — I''m building a community reading list!'),
  ('bi-collective', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   '🔗 Resources for bi+ visibility month:
• BiUK — community, support, and events: https://bi.org.uk
• The Bi Podcast — brilliant interviews
• Bisexual Wellbeing report 2024 (PDF pinned in community description)
Sharing because visibility isn''t just one day. It''s every day 💗💜💙'),
  ('wlw-entrepreneurs', 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   '💼 Freelance rate benchmark for queer creatives in the UK (2026 edition):
• Designer (brand/UI): £350–600/day
• Copywriter: £300–500/day
• Illustrator: £250–450/day
• Photographer: £400–800/day
These are real ranges from our community survey (n=47). Use them to negotiate. You are worth it.'),
  ('trans-nb-support', 'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   '📋 UK Trans Healthcare Pathway Overview (2026):
• NHS Gender Identity Clinics — waiting times, referral process
• GenderGP and other informed consent options
• Name change: Deed poll vs. statutory declaration (both free)
• Passport / driving licence / NI record updates
Full guide linked in the community description. Pinning this for new members 🏳️‍⚧️')
) AS p(slug, author_id, content)
JOIN public.communities c ON c.slug = p.slug;

-- ── roxy_link posts (link to Speed Dating game) ───────────────────────────────
INSERT INTO public.posts (
  author_id, community_id, content, post_type,
  link_type, link_entity_id, link_community_id
)
SELECT
  p.author_id,
  c.id,
  p.content,
  'roxy_link',
  'game',
  (SELECT id FROM public.games WHERE name = 'Speed Dating' LIMIT 1),
  c.id
FROM (VALUES
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
   'Speed Dating is live in our community! 💫 5 minutes, one person, see if the spark is there. I''ve had three amazing convos already. Go try it 👇'),
  ('queer-gamers', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
   'PSA: Speed Dating is now enabled in Queer Gamers 🎮❤️ Match with a fellow queer gamer. First question mandatory: BG3 or Stardew? 😂'),
  ('bi-collective', 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
   'Speed Dating is available in our community now! 💜 WLW, bi+, queer — connect with someone new in 5 minutes. No pressure, just vibes. Give it a go 💗')
) AS p(slug, author_id, content)
JOIN public.communities c ON c.slug = p.slug;

-- ── Feed score: back-fill all seeded posts ────────────────────────────────────
-- Apply compute_feed_score so the feed ordering is sensible from day one.
UPDATE public.posts
SET feed_score = public.compute_feed_score(like_count, comment_count, save_count, created_at)
WHERE author_id IN (
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000005'::uuid
);
