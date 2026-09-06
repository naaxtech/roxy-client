-- ============================================================
-- ROXY DEV SEED — paste into Supabase Dashboard > SQL Editor
-- Account-owned posts. Official communities are special profiles.
-- Login: maya@seed.roxy.app / seed-password
-- Official: official@seed.roxy.app / seed-password
-- Safe to re-run. Does not delete real members.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  maya uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  zoe uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  cam uuid := 'aaaaaaaa-0000-0000-0000-000000000004';
  sky uuid := 'aaaaaaaa-0000-0000-0000-000000000005';
  roxy uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  lol uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  books uuid := 'bbbbbbbb-0000-0000-0000-000000000003';
  c_roxy uuid;
  c_lol uuid;
  c_books uuid;
BEGIN

INSERT INTO auth.users (
  id, instance_id, aud, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, role,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
SELECT v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', v.email,
       extensions.crypt('seed-password', extensions.gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', v.display_name),
       false, 'authenticated',
       '', '', '', '', '', '', '', ''
FROM (VALUES
  (maya, 'maya@seed.roxy.app', 'Maya Chen'),
  (zoe, 'zoe@seed.roxy.app', 'Zoe Williams'),
  (cam, 'cam@seed.roxy.app', 'Cam Reyes'),
  (sky, 'sky@seed.roxy.app', 'Sky Nakamura'),
  (roxy, 'official@seed.roxy.app', 'Roxy Official'),
  (lol, 'london@seed.roxy.app', 'Lesbians of London'),
  (books, 'books@seed.roxy.app', 'Queer Book Club')
) AS v(id, email, display_name)
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v.id OR email = v.email);

INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
SELECT gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email', u.email, now(), now(), now()
FROM auth.users u
WHERE u.id IN (maya, zoe, cam, sky, roxy, lol, books)
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = u.id AND i.provider = 'email'
  );

INSERT INTO public.communities (name, slug, description, category, is_private, created_by)
VALUES
  ('Roxy Official', 'roxy-official', 'News and chat with the Roxy team.', 'support', false, roxy),
  ('Lesbians of London', 'lesbians-of-london', 'Socials, walks, and a standing invitation.', 'location', false, lol),
  ('Queer Book Club', 'queer-book-club', 'Monthly reads, big feelings.', 'interest', false, books)
ON CONFLICT (slug) DO NOTHING;

SELECT id INTO c_roxy FROM public.communities WHERE slug = 'roxy-official';
SELECT id INTO c_lol FROM public.communities WHERE slug = 'lesbians-of-london';
SELECT id INTO c_books FROM public.communities WHERE slug = 'queer-book-club';

INSERT INTO public.profiles (
  id, username, display_name, bio, pronouns, identity_labels, interests, custom_tags,
  location_city, location_country, vetting_status, access_tier, admitted_at,
  onboarding_completed, is_community_owner, official_community_id,
  can_create_room, can_submit_game, is_active
)
VALUES
  (maya, 'maya_chen', 'Maya Chen',
   'Soft butch, dim sum, hiking. Building community one brunch at a time.',
   ARRAY['she/her','they/them'], ARRAY['lesbian','queer','wlw'],
   ARRAY['outdoors','food','community'], ARRAY['brunch'],
   'London', 'UK', 'approved', 'beta', now(), true, false, NULL, false, false, true),
  (zoe, 'zoe_williams', 'Zoe Williams',
   'Bi woman, too many books, a very opinionated cat.',
   ARRAY['she/her'], ARRAY['bisexual','bi+','wlw'],
   ARRAY['books','coffee'], ARRAY['cat mum'],
   'London', 'UK', 'approved', 'beta', now(), true, false, NULL, false, false, true),
  (cam, 'cam_reyes', 'Cam Reyes',
   'Pansexual founder. Ethical fashion and better collaborators.',
   ARRAY['she/they'], ARRAY['pansexual','queer','wlw'],
   ARRAY['fashion','business'], ARRAY['founder'],
   'London', 'UK', 'approved', 'beta', now(), true, false, NULL, false, false, true),
  (sky, 'sky_nakamura', 'Sky Nakamura',
   'Trans lesbian, game dev by day, DnD forever by night.',
   ARRAY['she/her'], ARRAY['lesbian','trans','wlw'],
   ARRAY['games','tech'], ARRAY['game dev'],
   'London', 'UK', 'approved', 'beta', now(), true, false, NULL, false, false, true),
  (roxy, 'roxy_official', 'Roxy Official',
   'News, updates, and chat with the Roxy team.',
   ARRAY['they/them'], ARRAY['queer','wlw'],
   ARRAY['community','news'], ARRAY['official'],
   'London', 'UK', 'approved', 'beta', now(), true, true, c_roxy, true, true, true),
  (lol, 'lesbians_of_london', 'Lesbians of London',
   'Socials, walks, and a standing invitation to show up as yourself.',
   ARRAY['she/her','they/them'], ARRAY['lesbian','wlw'],
   ARRAY['community','outdoors'], ARRAY['official'],
   'London', 'UK', 'approved', 'beta', now(), true, true, c_lol, true, true, true),
  (books, 'queer_book_club', 'Queer Book Club',
   'Monthly reads, big feelings, great company.',
   ARRAY['they/them'], ARRAY['queer','wlw'],
   ARRAY['books'], ARRAY['official'],
   'London', 'UK', 'approved', 'beta', now(), true, true, c_books, true, true, true)
ON CONFLICT (id) DO UPDATE SET
  official_community_id = EXCLUDED.official_community_id,
  is_community_owner = EXCLUDED.is_community_owner,
  vetting_status = 'approved',
  access_tier = 'beta';

INSERT INTO public.community_members (community_id, user_id, role)
VALUES
  (c_roxy, roxy, 'admin'), (c_lol, lol, 'admin'), (c_books, books, 'admin'),
  (c_roxy, maya, 'member'), (c_lol, maya, 'member'), (c_books, zoe, 'member')
ON CONFLICT DO NOTHING;

INSERT INTO public.community_channels (community_id, slug, name, topic, position, is_default, created_by)
VALUES
  (c_roxy, 'general', 'general', 'Official updates and chat.', 0, true, roxy),
  (c_lol, 'general', 'general', 'Community chat.', 0, true, lol),
  (c_books, 'general', 'general', 'Community chat.', 0, true, books)
ON CONFLICT (community_id, slug) DO NOTHING;

INSERT INTO public.follows (follower_id, followed_id)
VALUES
  (maya, zoe), (maya, sky), (maya, lol), (maya, roxy),
  (zoe, maya), (zoe, books), (sky, maya), (cam, zoe)
ON CONFLICT DO NOTHING;

INSERT INTO public.posts (author_id, content, post_type, post_tags, video_url, video_thumbnail_url, video_duration_secs, video_aspect_ratio, like_count, feed_score)
SELECT * FROM (VALUES
  (maya, 'Community walk vlog. Muddy boots, good company.', 'video',
   ARRAY['outdoors','community'],
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
   'https://picsum.photos/seed/walk-vlog/800/450', 90, '16:9', 42, 88),
  (sky, 'Dev log — queer visual novel.', 'video',
   ARRAY['games','tech'],
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
   'https://picsum.photos/seed/devlog-thumb/800/450', 60, '16:9', 67, 94),
  (roxy, 'Posts live on your profile now. Follow someone and they show up here.', 'video',
   ARRAY['news','community'],
   'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
   'https://picsum.photos/seed/roxy-update/800/450', 40, '16:9', 88, 99)
) AS v(author_id, content, post_type, post_tags, video_url, thumb, dur, ratio, likes, score)
WHERE NOT EXISTS (
  SELECT 1 FROM public.posts p WHERE p.author_id = v.author_id AND p.content = v.content
);

INSERT INTO public.posts (author_id, content, post_type, post_tags, like_count, feed_score)
SELECT * FROM (VALUES
  (zoe, 'October pick is Fingersmith. Bring your feelings and a pastry.', 'standard', ARRAY['books'], 28, 64),
  (lol, 'Sunday walk, same route, new faces. Come as you are.', 'standard', ARRAY['outdoors'], 54, 81),
  (books, 'This month we are reading something that will ruin you in the best way.', 'standard', ARRAY['books'], 22, 58)
) AS v(author_id, content, post_type, post_tags, likes, score)
WHERE NOT EXISTS (
  SELECT 1 FROM public.posts p WHERE p.author_id = v.author_id AND p.content = v.content
);

DELETE FROM public.events WHERE title IN (
  'Sunday community walk', 'Book Club: Fingersmith', 'Roxy house update'
);
INSERT INTO public.events (host_id, community_id, title, description, event_type, starts_at, location_text, max_attendees, status)
VALUES
  (roxy, c_roxy, 'Roxy house update', 'What shipped this week.', 'online', now() + interval '3 days', NULL, 80, 'active'),
  (lol, c_lol, 'Sunday community walk', 'Hampstead, slow pace, coffee after.', 'in_person', now() + interval '5 days', 'Hampstead Heath, London', 30, 'active'),
  (books, c_books, 'Book Club: Fingersmith', 'Bring the book and a pastry.', 'in_person', now() + interval '10 days', 'Foyles Café, London', 12, 'active');

RAISE NOTICE 'Seed complete. Login: maya@seed.roxy.app / seed-password';

END $$;
