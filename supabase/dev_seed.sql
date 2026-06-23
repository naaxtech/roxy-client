-- ============================================================
-- ROXY DEV SEED — paste into Supabase Dashboard > SQL Editor
-- No destructive operations. Safe to re-run.
-- ============================================================

DO $$
DECLARE
  u1 uuid; u2 uuid; u3 uuid; u4 uuid;
  c1 uuid; c2 uuid; c3 uuid;
BEGIN

-- ── Auth users (WHERE NOT EXISTS avoids constraint issues) ────
-- instance_id/aud + the empty-string token columns are required: GoTrue's Go struct
-- scan fails with a generic 500 ("Database error querying schema") if these are NULL.
INSERT INTO auth.users (
  id, instance_id, aud, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, role,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', t.email,
       crypt('Password123!', gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{}'::jsonb, false, 'authenticated',
       '', '', '', '', '', '', '', ''
FROM (VALUES
  ('alex@roxy.dev'),
  ('jamie@roxy.dev'),
  ('river@roxy.dev'),
  ('morgan@roxy.dev')
) AS t(email)
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = t.email);

-- ── Auth identities ───────────────────────────────────────────
INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
SELECT gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email', u.email, now(), now(), now()
FROM auth.users u
WHERE u.email IN ('alex@roxy.dev','jamie@roxy.dev','river@roxy.dev','morgan@roxy.dev')
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = u.id AND i.provider = 'email'
  );

-- ── Read actual UUIDs ─────────────────────────────────────────
SELECT id INTO u1 FROM auth.users WHERE email = 'alex@roxy.dev';
SELECT id INTO u2 FROM auth.users WHERE email = 'jamie@roxy.dev';
SELECT id INTO u3 FROM auth.users WHERE email = 'river@roxy.dev';
SELECT id INTO u4 FROM auth.users WHERE email = 'morgan@roxy.dev';

-- ── Profiles ──────────────────────────────────────────────────
INSERT INTO profiles (
  id, username, display_name, bio, pronouns, identity_labels,
  location_city, location_country, is_dating_mode, is_active, gamification_points
)
VALUES
  (u1, 'alex_wlw',   'Alex',   'Bookworm, dog mum, sunset chaser 🌅', ARRAY['she/her'],       ARRAY['lesbian'],   'London',     'UK', true,  true, 420),
  (u2, 'jamie_star', 'Jamie',  'Musician & community organiser 🎸',   ARRAY['they/them'],     ARRAY['queer'],     'Manchester', 'UK', true,  true, 280),
  (u3, 'river_sky',  'River',  'Artist, nature lover, cat parent 🐱', ARRAY['she/they'],      ARRAY['bisexual'],  'London',     'UK', false, true, 150),
  (u4, 'morgan_jay', 'Morgan', 'Chef & proud WLW 🍳',                 ARRAY['she/her','any'], ARRAY['pansexual'], 'Bristol',    'UK', true,  true, 90)
ON CONFLICT DO NOTHING;

-- ── Communities ───────────────────────────────────────────────
INSERT INTO communities (name, slug, description, category, member_count, is_private, created_by)
VALUES
  ('WLW London',        'wlw-london',        'Social community for women who love women in London',       'location', 42, false, u1),
  ('Queer Book Club',   'queer-book-club',   'Monthly reads, big feelings, great company 📚',             'interest', 18, false, u2),
  ('WLW Entrepreneurs', 'wlw-entrepreneurs', 'Business owners, freelancers & side-hustlers who are WLW', 'interest', 27, false, u4)
ON CONFLICT (slug) DO NOTHING;

SELECT id INTO c1 FROM communities WHERE slug = 'wlw-london';
SELECT id INTO c2 FROM communities WHERE slug = 'queer-book-club';
SELECT id INTO c3 FROM communities WHERE slug = 'wlw-entrepreneurs';

-- ── Community members ─────────────────────────────────────────
INSERT INTO community_members (community_id, user_id, role)
VALUES
  (c1, u1, 'admin'),  (c1, u2, 'member'), (c1, u3, 'member'), (c1, u4, 'member'),
  (c2, u2, 'admin'),  (c2, u1, 'member'), (c2, u3, 'member'),
  (c3, u4, 'admin'),  (c3, u1, 'member')
ON CONFLICT DO NOTHING;

-- ── Posts ─────────────────────────────────────────────────────
INSERT INTO posts (author_id, community_id, content, post_type, reaction_counts, comment_count)
SELECT * FROM (VALUES
  (u1, c1, 'Just hit 12 days of daily journaling. Feels so good to have a habit that''s actually sticking 🌱', 'standard', '{"heart":14}'::jsonb, 3),
  (u2, c2, 'Anyone else find that the queer community makes every hobby 10x better? 💜',                       'standard', '{"heart":22}'::jsonb, 7),
  (u3, c1, 'Finished my first painting in months. Depression is real but so is getting back up 🎨',           'standard', '{"heart":31}'::jsonb, 11),
  (u4, c3, 'Cooked a full Sunday roast for 8 people. Hosting is my love language 🍗',                         'standard', '{"heart":8}'::jsonb,  2),
  (u1, c3, 'Just launched my freelance writing site! WLW creatives — let''s support each other 🚀',           'standard', '{"heart":19}'::jsonb, 5),
  (u4, c3, 'Looking for WLW-owned suppliers for my catering business. Drop your recs below 👇',               'standard', '{"heart":6}'::jsonb,  9)
) AS v(author_id, community_id, content, post_type, reaction_counts, comment_count)
WHERE NOT EXISTS (
  SELECT 1 FROM posts WHERE author_id = v.author_id AND content = v.content
);

-- ── Events ────────────────────────────────────────────────────
-- starts_at is relative to whenever this script runs, so a stale row from a
-- previous run would otherwise sit in the past forever — delete by title
-- before inserting so re-running always refreshes these to be upcoming.
DELETE FROM events WHERE title IN (
  'WLW London Autumn Social', 'Book Club: October Pick',
  'WLW Biz Networking Brunch', 'Online Queer Crafting Night'
);
INSERT INTO events (host_id, community_id, title, description, event_type, starts_at, location_text, max_attendees)
VALUES
  (u1, c1, 'WLW London Autumn Social',    'Casual drinks and good vibes at The Chameleon Bar',           'in_person', now() + interval '5 days',  'The Chameleon Bar, Soho', 30),
  (u2, c2, 'Book Club: October Pick',     'Discussing "Fingersmith" by Sarah Waters — bring your feels', 'in_person', now() + interval '10 days', 'Foyles Café, London',     12),
  (u4, c3, 'WLW Biz Networking Brunch',   'Pitch your idea, meet your next collab partner',              'in_person', now() + interval '14 days', 'Brew & Co, Brixton',      20),
  (u3, c1, 'Online Queer Crafting Night', 'Bring your WIP, chat, create. Zoom link on join.',            'online',    now() + interval '3 days',  NULL::text,                50);

-- ── Businesses ────────────────────────────────────────────────
INSERT INTO businesses (owner_id, name, description, category, location_city, is_wlw_owned, is_verified)
SELECT * FROM (VALUES
  (u4, 'Morgan''s Kitchen',   'Private chef & catering for events, hen dos, celebrations', 'food',     'Bristol',    true, true),
  (u1, 'Alex Writes',         'Copywriting & content strategy for purpose-led brands',     'creative', 'London',     true, false),
  (u2, 'Queer Sounds Studio', 'Music production and vocal coaching for queer artists',     'creative', 'Manchester', true, true)
) AS v(owner_id, name, description, category, location_city, is_wlw_owned, is_verified)
WHERE NOT EXISTS (
  SELECT 1 FROM businesses WHERE owner_id = v.owner_id AND name = v.name
);

-- ── Impact projects ───────────────────────────────────────────
INSERT INTO impact_projects (creator_id, title, description, category, supporter_count, status)
SELECT * FROM (VALUES
  (u2, 'Safe Space Fund',        'Emergency hardship fund for queer women in crisis',       'mutual_aid', 34, 'active'),
  (u3, 'Visibility Zine Vol. 2', 'WLW artists & writers — second edition, printed & free', 'mutual_aid', 52, 'active'),
  (u1, 'Queer History Archive',  'Digitising local queer history for future generations',   'mutual_aid',  9, 'active')
) AS v(creator_id, title, description, category, supporter_count, status)
WHERE NOT EXISTS (
  SELECT 1 FROM impact_projects WHERE creator_id = v.creator_id AND title = v.title
);

-- ── Speed date session (only if none upcoming) ────────────────
INSERT INTO speed_date_sessions (scheduled_at, duration_seconds, participant_ids, status, prompts)
SELECT now() + interval '2 minutes', 300, '{}', 'scheduled',
  ARRAY[
    'What''s the most spontaneous thing you''ve ever done?',
    'Describe your perfect Sunday morning.',
    'What''s something you''re proud of that most people don''t know?',
    'If you could live anywhere for a year, where would it be?',
    'What''s a small thing that always makes you smile?'
  ]
WHERE NOT EXISTS (
  SELECT 1 FROM speed_date_sessions
  WHERE status IN ('scheduled', 'active') AND scheduled_at > now()
);

-- ── Conversations ─────────────────────────────────────────────
INSERT INTO conversations (participant_ids, conversation_type, last_message_at)
SELECT * FROM (VALUES
  (ARRAY[u1, u2], 'direct'::text,     (now() - interval '2 hours')::timestamptz),
  (ARRAY[u1, u3], 'direct'::text,     (now() - interval '1 day')::timestamptz),
  (ARRAY[u2, u4], 'speed_date'::text, (now() - interval '3 days')::timestamptz)
) AS v(participant_ids, conversation_type, last_message_at)
WHERE NOT EXISTS (
  SELECT 1 FROM conversations
  WHERE participant_ids = v.participant_ids AND conversation_type = v.conversation_type
);

RAISE NOTICE 'Seed complete. Login: alex@roxy.dev / Password123!';

END $$;
