-- supabase/migrations/007_seed_data.sql
-- Comprehensive seed data: fake users, profiles, community memberships,
-- posts, events, and friendships. Safe to re-run (ON CONFLICT DO NOTHING).

-- pgcrypto is required for crypt() / gen_salt() used in auth.users password hashing
-- In Supabase Cloud, pgcrypto functions live in the extensions schema
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path TO public, extensions;

-- ─── Fake auth users ─────────────────────────────────────────────────────────
-- Migrations run as postgres (superuser), so direct auth.users inserts are allowed.
-- instance_id is required by GoTrue schema; use the zero UUID as convention.

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'maya@seed.roxy.app',
    crypt('seed-password', gen_salt('bf')),
    now(),
    '{"display_name": "Maya Chen"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'zoe@seed.roxy.app',
    crypt('seed-password', gen_salt('bf')),
    now(),
    '{"display_name": "Zoe Williams"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'river@seed.roxy.app',
    crypt('seed-password', gen_salt('bf')),
    now(),
    '{"display_name": "River Okafor"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-0000-0000-0000-000000000004',
    'authenticated',
    'authenticated',
    'cam@seed.roxy.app',
    crypt('seed-password', gen_salt('bf')),
    now(),
    '{"display_name": "Cam Reyes"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-0000-0000-0000-000000000005',
    'authenticated',
    'authenticated',
    'sky@seed.roxy.app',
    crypt('seed-password', gen_salt('bf')),
    now(),
    '{"display_name": "Sky Nakamura"}',
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Profiles ────────────────────────────────────────────────────────────────

INSERT INTO public.profiles (
  id,
  username,
  display_name,
  bio,
  pronouns,
  identity_labels,
  location_city,
  location_country,
  is_dating_mode,
  gamification_points
) VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'maya_chen',
    'Maya Chen',
    'Soft butch, lover of dim sum and hiking trails. Building community one brunch at a time. She/they energy forever 🌿',
    ARRAY['she/her', 'they/them'],
    ARRAY['lesbian', 'queer', 'wlw'],
    'London',
    'UK',
    true,
    320
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000002',
    'zoe_williams',
    'Zoe Williams',
    'Bi woman navigating London with too many book recommendations and a very opinionated cat. Always down for coffee or co-working.',
    ARRAY['she/her'],
    ARRAY['bisexual', 'bi+', 'wlw'],
    'London',
    'UK',
    false,
    185
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000003',
    'river_okafor',
    'River Okafor',
    'Non-binary, queer, and perpetually overcommitted to video games and mutual aid projects. Currently: manifesting a cozy gaming setup.',
    ARRAY['they/them'],
    ARRAY['non-binary', 'queer', 'wlw', 'trans'],
    'Manchester',
    'UK',
    true,
    510
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000004',
    'cam_reyes',
    'Cam Reyes',
    'Pansexual entrepreneur building ethical fashion brands. Coffee snob, occasional skater. Looking for collaborators and good vibes.',
    ARRAY['she/they'],
    ARRAY['pansexual', 'bi+', 'queer', 'wlw'],
    'London',
    'UK',
    true,
    275
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000005',
    'sky_nakamura',
    'Sky Nakamura',
    'Trans lesbian, game dev by day, DnD forever by night. Passionate about trans joy and creating safe spaces in gaming communities.',
    ARRAY['she/her'],
    ARRAY['lesbian', 'trans', 'wlw', 'queer'],
    'London',
    'UK',
    false,
    440
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Community memberships ───────────────────────────────────────────────────
-- Join fake users into the 4 target communities using slug lookup.

INSERT INTO public.community_members (community_id, user_id, role)
SELECT c.id, u.uid, u.role
FROM (
  VALUES
    -- lesbians-of-london
    ('lesbians-of-london',  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'member'),
    ('lesbians-of-london',  'aaaaaaaa-0000-0000-0000-000000000005'::uuid, 'member'),
    ('lesbians-of-london',  'aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'member'),
    -- bi-collective
    ('bi-collective',       'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'member'),
    ('bi-collective',       'aaaaaaaa-0000-0000-0000-000000000004'::uuid, 'member'),
    ('bi-collective',       'aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'member'),
    -- queer-gamers
    ('queer-gamers',        'aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'admin'),
    ('queer-gamers',        'aaaaaaaa-0000-0000-0000-000000000005'::uuid, 'moderator'),
    ('queer-gamers',        'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'member'),
    ('queer-gamers',        'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'member'),
    -- wlw-entrepreneurs
    ('wlw-entrepreneurs',   'aaaaaaaa-0000-0000-0000-000000000004'::uuid, 'admin'),
    ('wlw-entrepreneurs',   'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'member'),
    ('wlw-entrepreneurs',   'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'member')
) AS u(slug, uid, role)
JOIN public.communities c ON c.slug = u.slug
ON CONFLICT (community_id, user_id) DO NOTHING;

-- ─── Posts ───────────────────────────────────────────────────────────────────
-- 5-8 posts per active community from different fake users.
-- community_id resolved inline via subquery on slug.

INSERT INTO public.posts (author_id, community_id, content, post_type)
SELECT p.author_id, c.id, p.content, 'standard'
FROM (
  VALUES
    -- lesbians-of-london (6 posts)
    (
      'lesbians-of-london',
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Anyone else think we need a monthly Lesbians of London hike? Thinking something in the South Downs — easy pace, lots of stops for snacks and photos. Drop a 🙋 if you''d come!'
    ),
    (
      'lesbians-of-london',
      'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
      'Just moved to Hackney from Manchester and honestly the queer scene here has already welcomed me so warmly. Thank you to everyone in this community — it means everything. 🏳️‍🌈'
    ),
    (
      'lesbians-of-london',
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
      'Hot take: the best lesbian bars in London are actually the ones that nobody outside the community knows about. Not gatekeeping, just appreciating. Share your favourite hidden gem below (DMs open too).'
    ),
    (
      'lesbians-of-london',
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'PSA: The Vault closed last weekend and I''m still processing it. That place was so important to so many of us. Sending love to everyone who found community there 💜'
    ),
    (
      'lesbians-of-london',
      'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
      'Looking for a flatmate in Dalston — ideally queer, cat-friendly and okay with someone who has very strong opinions about video games. DM me if interested or know anyone!'
    ),
    (
      'lesbians-of-london',
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
      'Reminder that Pride in London is coming up and the community float is looking for volunteers. Link in the community description. Last year was incredible — let''s make this one even better.'
    ),

    -- bi-collective (7 posts)
    (
      'bi-collective',
      'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
      'Real talk: bi erasure is exhausting. Someone told me today I''m "basically straight now" because I''m dating a woman. As if my identity shifted when I found love. Still bi. Always bi. 💗💜💙'
    ),
    (
      'bi-collective',
      'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
      'Starting a thread: what''s the best bi+ representation you''ve seen in media recently? I''ll go first — Rosa Diaz in Brooklyn Nine-Nine still lives in my head rent free.'
    ),
    (
      'bi-collective',
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
      'Gentle reminder that the bi+ umbrella includes bisexual, pansexual, omnisexual, fluid, queer and more. All of you belong here. No gatekeeping, no gold stars, just community 💜'
    ),
    (
      'bi-collective',
      'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
      'Anyone else navigate coming out as bi multiple times depending on who you''re dating? The assumption that I''m straight when I''m with a man / gay when I''m with a woman is... a lot. We really do live in a binary world sometimes.'
    ),
    (
      'bi-collective',
      'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
      'I organised my first bi+ social last month and it was genuinely one of the best nights of my life. We need more spaces like this. Who wants to help me make it a regular thing? Drop your interest below!'
    ),
    (
      'bi-collective',
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
      'Book recommendation for the bi+ girlies: "She''s Not There" by Jennifer Finney Boylan, and "The Argonauts" by Maggie Nelson. Both destroyed me in the best possible way. 📚'
    ),
    (
      'bi-collective',
      'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
      'Celebrating 1 year since I stopped apologising for my identity. No more "I''m bi but I''m with a woman so—". Just: I''m bi. Full stop. It feels so good. Thank you to this community for holding me while I got here 💙'
    ),

    -- queer-gamers (8 posts)
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
      'Weekly game night this Friday — we''re finishing our Baldur''s Gate 3 campaign (Dark Urge playthrough, no spoilers in comments please 🙏). Voice chat link in the pinned post!'
    ),
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
      'I finished writing the queer companion for our homebrew DnD campaign and I''m so proud of her. Lesbian paladin with a complicated relationship with her deity and a found family arc. If anyone wants to play, we have one spot open!'
    ),
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Genuinely cannot believe how well Celeste handled Madeline''s trans identity. It didn''t need to say a single word and yet it said everything. What games have hit you like that — where the queer coding just *got* you?'
    ),
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
      'Hello fellow queer gamers, I''m new here! Mostly play cozy games (Stardew, Animal Crossing, A Short Hike) but I''m trying to branch out. Any recommendations for games with good wlw rep?'
    ),
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
      'Game dev update: the prototype for my queer visual novel is almost playable. The main character is a non-binary archaeologist who falls for her rival. Very enemies-to-lovers, very gay. Testers wanted — DM me!'
    ),
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
      'Can we talk about how Hades has normalised polyamory and queerness in mainstream gaming with absolutely zero fanfare? Zagreus can date multiple people of various genders and nobody makes it weird. That''s the energy.'
    ),
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Reminder that we have a code of conduct in this community. No homophobia, transphobia, or biphobia — even as "jokes". This is a safe space for all queer gamers. Report anything that feels off to the mods 💜'
    ),
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
      'Monthly recommendation thread! Drop your current top game + one queer thing you love about it. I''ll start: Disco Elysium — it takes mental illness seriously in a way I''ve never seen in a game before, and the politics are unapologetically leftist.'
    ),

    -- wlw-entrepreneurs (6 posts)
    (
      'wlw-entrepreneurs',
      'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
      'The most common question I get is "how do you find queer-friendly investors?". Honest answer: you often can''t filter for it, but you can filter *out* red flags. A quick "we prioritise inclusive workplaces" in the pitch deck surfaces a lot. Happy to share the full deck template — just ask.'
    ),
    (
      'wlw-entrepreneurs',
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Looking for a co-founder for a community-led wellness app specifically for queer women. Technical background preferred but not required if you have strong ops/community experience. DM me if curious — I have a pitch deck and a lot of passion.'
    ),
    (
      'wlw-entrepreneurs',
      'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
      'Freelance editors, designers, and copywriters — raise your hand! I''m building a little directory of queer wlw creatives so we can refer each other work instead of defaulting to platforms that take 20%. Comment with your niche and rate range if you''re interested.'
    ),
    (
      'wlw-entrepreneurs',
      'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
      'Two years ago I launched my ethical fashion brand with £800 and a sewing machine in my spare room. Today we hit £100k in revenue. I''m sharing everything I know at next month''s meetup — numbers, mistakes, sourcing suppliers, all of it. Come ready with questions.'
    ),
    (
      'wlw-entrepreneurs',
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Quick win of the week: I finally automated my client onboarding using Notion + Zapier. Cut my admin time by about 4 hours a week. Happy to share the template in the resources channel if anyone wants it!'
    ),
    (
      'wlw-entrepreneurs',
      'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
      'Accountability thread for March goals! Drop what you''re working on this month. I''ll go first: launch my Substack, pitch to 3 new clients, and actually take a weekend off. Holding myself to it publicly 😅'
    )
) AS p(slug, author_id, content)
JOIN public.communities c ON c.slug = p.slug
ON CONFLICT DO NOTHING;

-- ─── Events ──────────────────────────────────────────────────────────────────
-- 2-3 upcoming events per community, using NOW() + INTERVAL for future dates.

INSERT INTO public.events (
  community_id,
  host_id,
  title,
  description,
  event_type,
  starts_at,
  ends_at,
  location_text,
  max_attendees
)
SELECT c.id, e.host_id, e.title, e.description, e.event_type,
       e.starts_at, e.ends_at, e.location_text, e.max_attendees
FROM (
  VALUES
    -- lesbians-of-london
    (
      'lesbians-of-london',
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Lesbians of London Spring Social',
      'Casual drinks and meetup for the community. All lesbians, wlw, and friends welcome. Come as you are — newbies especially encouraged!',
      'in_person',
      now() + interval '5 days',
      now() + interval '5 days' + interval '3 hours',
      'The Royal Vauxhall Tavern, London',
      60
    ),
    (
      'lesbians-of-london',
      'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
      'Queer Women''s Film Night: Classic Sapphic Cinema',
      'Screening of two classic films with sapphic themes. Discussion after. Popcorn provided.',
      'in_person',
      now() + interval '12 days',
      now() + interval '12 days' + interval '4 hours',
      'Rio Cinema, Dalston, London',
      80
    ),
    (
      'lesbians-of-london',
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
      'South Downs Hike & Picnic',
      'Easy to moderate hike with a scenic picnic stop. All fitness levels welcome. Bring good shoes and even better snacks.',
      'in_person',
      now() + interval '21 days',
      now() + interval '21 days' + interval '6 hours',
      'Meeting at Brighton Station',
      25
    ),

    -- bi-collective
    (
      'bi-collective',
      'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
      'Bi+ Visibility Coffee Morning',
      'Relaxed bi+ social — just us, good coffee, and good conversation. A safe space to be unapologetically multi-attracted.',
      'in_person',
      now() + interval '8 days',
      now() + interval '8 days' + interval '2 hours',
      'Redemption Roasters, Bethnal Green, London',
      20
    ),
    (
      'bi-collective',
      'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
      'Bi+ Book Club: The Price of Salt',
      'Monthly virtual book club. This month we''re reading Patricia Highsmith''s seminal bi/lesbian classic. Come ready to discuss!',
      'online',
      now() + interval '15 days',
      now() + interval '15 days' + interval '90 minutes',
      NULL,
      NULL
    ),
    (
      'bi-collective',
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
      'Navigating Identity: Panel & Q+A',
      'Community panel featuring bi+, pan, and fluid speakers sharing their experiences. Q&A session with the audience. Open to all.',
      'hybrid',
      now() + interval '28 days',
      now() + interval '28 days' + interval '2 hours',
      'Queer Britain Museum, London + Livestream',
      50
    ),

    -- queer-gamers
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
      'Queer Gamers Weekly: BG3 Campaign Finale',
      'We''re finishing our Baldur''s Gate 3 Dark Urge campaign! Voice + video session open to community spectators. No spoilers in chat please.',
      'online',
      now() + interval '3 days',
      now() + interval '3 days' + interval '4 hours',
      NULL,
      NULL
    ),
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
      'Queer Visual Novel Showcase',
      'Community members share works-in-progress and demos of queer visual novels. Feedback session with supportive vibes only. 5-min slots available — DM to register.',
      'online',
      now() + interval '18 days',
      now() + interval '18 days' + interval '3 hours',
      NULL,
      30
    ),
    (
      'queer-gamers',
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'IRL Gaming Café Night — London',
      'Bring your Switch, your laptop, or just your competitive spirit. Reserved space at a local gaming café. Limited spots!',
      'in_person',
      now() + interval '25 days',
      now() + interval '25 days' + interval '3 hours',
      'Loading Bar, Stoke Newington, London',
      15
    ),

    -- wlw-entrepreneurs
    (
      'wlw-entrepreneurs',
      'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
      'From £800 to £100k: Building an Ethical Fashion Brand',
      'Cam shares the full story of building her brand — sourcing, pricing, marketing, mistakes. No filter. Bring questions.',
      'in_person',
      now() + interval '10 days',
      now() + interval '10 days' + interval '2 hours',
      'Shoreditch Works, London',
      40
    ),
    (
      'wlw-entrepreneurs',
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'WLW Co-Founder Matching Speed Round',
      'Five-minute speed introductions with potential co-founders and collaborators. Bring a 2-minute pitch for what you''re building and what you need.',
      'online',
      now() + interval '17 days',
      now() + interval '17 days' + interval '90 minutes',
      NULL,
      50
    ),
    (
      'wlw-entrepreneurs',
      'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
      'Freelance Queer Creatives: Rates, Boundaries, and Getting Paid',
      'Workshop on rate-setting, client boundaries, and navigating being visibly queer in freelance work. Real numbers, real talk.',
      'online',
      now() + interval '30 days',
      now() + interval '30 days' + interval '2 hours',
      NULL,
      NULL
    )
) AS e(slug, host_id, title, description, event_type, starts_at, ends_at, location_text, max_attendees)
JOIN public.communities c ON c.slug = e.slug
ON CONFLICT DO NOTHING;

-- ─── Friendships ─────────────────────────────────────────────────────────────
-- A handful of accepted friendships between fake users.

INSERT INTO public.friendships (requester_id, addressee_id, status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000005', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000005', 'accepted'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003', 'pending')
ON CONFLICT (requester_id, addressee_id) DO NOTHING;
