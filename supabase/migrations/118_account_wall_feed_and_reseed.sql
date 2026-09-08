-- 118 — Account-owned posts, official community profiles, honest seed
--
-- Communities are Roxy-granted special accounts, not folders that own posts.
-- This migration locks that rule in the database, points For You at profile
-- walls, attaches each leftover community row to an official profile, and
-- replaces demo users so testers can walk the real flow.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 1. Posts can only live on the author ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.posts_force_profile_wall()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.community_id := NULL;
  NEW.posted_as_community := false;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_force_profile_wall ON public.posts;
CREATE TRIGGER posts_force_profile_wall
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.posts_force_profile_wall();

COMMENT ON FUNCTION public.posts_force_profile_wall() IS
  'Posts belong to the author. Community folders cannot own a post, even if a client still sends community_id.';

UPDATE public.posts
SET community_id = NULL,
    posted_as_community = false
WHERE community_id IS NOT NULL
   OR posted_as_community = true;

-- ── 2. For You ranks profile walls, not community announcements ─────────────
--
-- Same return shape as 073 so the client RPC name and columns stay put.
-- Follow is a bonus, not a filter — a new account still sees the square.

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

COMMENT ON FUNCTION public.announcement_feed(integer, timestamptz) IS
  'For You. Profile-wall posts ranked by interest, follow, score, and recency. community_id is the author''s official grant when they have one.';

-- ── 3. Core can attach an existing community to an approved profile ─────────

CREATE OR REPLACE FUNCTION public.link_official_community(
  p_user_id uuid,
  p_community_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_vetting text;
  v_taken uuid;
BEGIN
  IF NOT public.is_roxy_core() THEN
    RAISE EXCEPTION 'not authorised to link an official community' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_community_id IS NULL THEN
    RAISE EXCEPTION 'user id and community id are required' USING ERRCODE = '22023';
  END IF;

  SELECT staff_role, vetting_status
    INTO v_role, v_vetting
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_role = 'core' THEN
    RAISE EXCEPTION 'cannot tag a core account' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'staff' THEN
    RAISE EXCEPTION 'cannot tag staff' USING ERRCODE = '42501';
  END IF;

  IF v_vetting IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'only approved members can be community owners' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.communities WHERE id = p_community_id) THEN
    RAISE EXCEPTION 'community not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_taken
  FROM public.profiles
  WHERE official_community_id = p_community_id
    AND id <> p_user_id;

  IF v_taken IS NOT NULL THEN
    RAISE EXCEPTION 'community already linked to another profile' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (p_community_id, p_user_id, 'admin')
  ON CONFLICT (community_id, user_id) DO UPDATE SET role = 'admin';

  INSERT INTO public.community_channels (community_id, slug, name, topic, position, is_default, created_by)
  VALUES (p_community_id, 'general', 'general', 'Community chat.', 0, true, p_user_id)
  ON CONFLICT (community_id, slug) DO NOTHING;

  UPDATE public.profiles
  SET is_community_owner = true,
      official_community_id = p_community_id
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_official_community(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.link_official_community(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.link_official_community(uuid, uuid) IS
  'Core-only. Attaches an existing communities row to an approved non-staff profile for join and chat. Does not move posts.';

-- ── 4. Remove old demo accounts (keep real people and the e2e login) ────────

CREATE TEMP TABLE seed_ids (id uuid PRIMARY KEY);

INSERT INTO seed_ids (id)
SELECT u.id
FROM auth.users u
WHERE u.email IN (
  'maya@seed.roxy.app',
  'zoe@seed.roxy.app',
  'river@seed.roxy.app',
  'cam@seed.roxy.app',
  'sky@seed.roxy.app',
  'alex@roxy.dev',
  'jamie@roxy.dev',
  'river@roxy.dev',
  'morgan@roxy.dev',
  'test@test.com',
  'maya@roxy.test',
  'roxy-qa-test-20260728@mailinator.com'
);

DELETE FROM public.carts WHERE buyer_id IN (SELECT id FROM seed_ids);
DELETE FROM public.orders WHERE buyer_id IN (SELECT id FROM seed_ids);
DELETE FROM public.email_queue WHERE recipient_user_id IN (SELECT id FROM seed_ids);
DELETE FROM public.payment_logs
WHERE buyer_id IN (SELECT id FROM seed_ids)
   OR host_id IN (SELECT id FROM seed_ids);

UPDATE public.events
SET cancelled_by = NULL
WHERE cancelled_by IN (SELECT id FROM seed_ids);

UPDATE public.platform_settings
SET updated_by = NULL
WHERE updated_by IN (SELECT id FROM seed_ids);

DELETE FROM public.businesses WHERE owner_id IN (SELECT id FROM seed_ids);
DELETE FROM public.impact_projects WHERE creator_id IN (SELECT id FROM seed_ids);
DELETE FROM public.events WHERE host_id IN (SELECT id FROM seed_ids);
DELETE FROM public.posts WHERE author_id IN (SELECT id FROM seed_ids);

DELETE FROM public.profiles WHERE id IN (SELECT id FROM seed_ids);
DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM seed_ids);
DELETE FROM auth.users WHERE id IN (SELECT id FROM seed_ids);

-- ── 5. New demo people + official community profiles ────────────────────────

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_super_admin,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
SELECT
  v.id,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  v.email,
  extensions.crypt('seed-password', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', v.display_name),
  now(),
  now(),
  false,
  '', '', '', '', '', '', '', ''
FROM (VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'maya@seed.roxy.app',     'Maya Chen'),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'zoe@seed.roxy.app',      'Zoe Williams'),
  ('aaaaaaaa-0000-0000-0000-000000000004'::uuid, 'cam@seed.roxy.app',      'Cam Reyes'),
  ('aaaaaaaa-0000-0000-0000-000000000005'::uuid, 'sky@seed.roxy.app',      'Sky Nakamura'),
  ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'official@seed.roxy.app', 'Roxy Official'),
  ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'london@seed.roxy.app',   'Lesbians of London'),
  ('bbbbbbbb-0000-0000-0000-000000000003'::uuid, 'books@seed.roxy.app',    'Queer Book Club'),
  ('bbbbbbbb-0000-0000-0000-000000000004'::uuid, 'gamers@seed.roxy.app',   'Queer Gamers'),
  ('bbbbbbbb-0000-0000-0000-000000000005'::uuid, 'founders@seed.roxy.app', 'WLW Entrepreneurs'),
  ('bbbbbbbb-0000-0000-0000-000000000006'::uuid, 'trans@seed.roxy.app',    'Trans & Non-binary Support'),
  ('bbbbbbbb-0000-0000-0000-000000000007'::uuid, 'bi@seed.roxy.app',       'Bi+ Collective'),
  ('bbbbbbbb-0000-0000-0000-000000000008'::uuid, 'wlwldn@seed.roxy.app',   'WLW London')
) AS v(id, email, display_name)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  u.email,
  now(),
  now(),
  now()
FROM auth.users u
WHERE u.id IN (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000002',
  'aaaaaaaa-0000-0000-0000-000000000004',
  'aaaaaaaa-0000-0000-0000-000000000005',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000002',
  'bbbbbbbb-0000-0000-0000-000000000003',
  'bbbbbbbb-0000-0000-0000-000000000004',
  'bbbbbbbb-0000-0000-0000-000000000005',
  'bbbbbbbb-0000-0000-0000-000000000006',
  'bbbbbbbb-0000-0000-0000-000000000007',
  'bbbbbbbb-0000-0000-0000-000000000008'
)
AND NOT EXISTS (
  SELECT 1 FROM auth.identities i
  WHERE i.user_id = u.id AND i.provider = 'email'
);

INSERT INTO public.profiles (
  id, username, display_name, bio, pronouns, identity_labels, interests, custom_tags,
  location_city, location_country, vetting_status, access_tier, admitted_at,
  onboarding_completed, is_community_owner, official_community_id,
  can_create_room, can_submit_game, is_active, is_staff, staff_role
)
SELECT
  v.id, v.username, v.display_name, v.bio, v.pronouns, v.identity_labels,
  v.interests, v.custom_tags, v.city, 'UK', 'approved', 'beta', now(),
  true, v.owner, v.community_id, v.owner, v.owner, true, false, NULL
FROM (VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'maya_chen', 'Maya Chen',
    'Soft butch, dim sum, hiking. Building community one brunch at a time.',
    ARRAY['she/her','they/them'], ARRAY['lesbian','queer','wlw'],
    ARRAY['outdoors','food','community'], ARRAY['brunch','soft butch'],
    'London', false, NULL::uuid
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
    'zoe_williams', 'Zoe Williams',
    'Bi woman, too many books, a very opinionated cat. Always down for coffee.',
    ARRAY['she/her'], ARRAY['bisexual','bi+','wlw'],
    ARRAY['books','coffee','writing'], ARRAY['cat mum','book club'],
    'London', false, NULL::uuid
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
    'cam_reyes', 'Cam Reyes',
    'Pansexual founder. Ethical fashion, good coffee, better collaborators.',
    ARRAY['she/they'], ARRAY['pansexual','bi+','queer','wlw'],
    ARRAY['fashion','business','coffee'], ARRAY['founder'],
    'London', false, NULL::uuid
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000005'::uuid,
    'sky_nakamura', 'Sky Nakamura',
    'Trans lesbian, game dev by day, DnD forever by night.',
    ARRAY['she/her'], ARRAY['lesbian','trans','wlw','queer'],
    ARRAY['games','tech','art'], ARRAY['game dev','dnd'],
    'London', false, NULL::uuid
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
    'roxy_official', 'Roxy Official',
    'News, updates, and chat with the Roxy team.',
    ARRAY['they/them'], ARRAY['queer','wlw'],
    ARRAY['community','news'], ARRAY['official'],
    'London', true, (SELECT id FROM public.communities WHERE slug = 'roxy-official')
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
    'lesbians_of_london', 'Lesbians of London',
    'Socials, walks, and a standing invitation to show up as yourself.',
    ARRAY['she/her','they/them'], ARRAY['lesbian','wlw','queer'],
    ARRAY['community','outdoors','socials'], ARRAY['london','official'],
    'London', true, (SELECT id FROM public.communities WHERE slug = 'lesbians-of-london')
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000003'::uuid,
    'queer_book_club', 'Queer Book Club',
    'Monthly reads, big feelings, great company.',
    ARRAY['they/them'], ARRAY['queer','wlw'],
    ARRAY['books','writing'], ARRAY['official'],
    'London', true, (SELECT id FROM public.communities WHERE slug = 'queer-book-club')
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000004'::uuid,
    'queer_gamers', 'Queer Gamers',
    'Co-op nights, visual novels, and voice chat that does not suck.',
    ARRAY['they/them'], ARRAY['queer','wlw'],
    ARRAY['games','tech'], ARRAY['official'],
    'London', true, (SELECT id FROM public.communities WHERE slug = 'queer-gamers')
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000005'::uuid,
    'wlw_entrepreneurs', 'WLW Entrepreneurs',
    'Founders, freelancers, and the people who hire them.',
    ARRAY['she/they'], ARRAY['queer','wlw'],
    ARRAY['business','fashion'], ARRAY['official'],
    'London', true, (SELECT id FROM public.communities WHERE slug = 'wlw-entrepreneurs')
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000006'::uuid,
    'trans_nb_support', 'Trans & Non-binary Support',
    'A quieter room. Resources, check-ins, no homework.',
    ARRAY['they/them'], ARRAY['trans','non-binary','queer','wlw'],
    ARRAY['community','support'], ARRAY['official'],
    'London', true, (SELECT id FROM public.communities WHERE slug = 'trans-nb-support')
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000007'::uuid,
    'bi_collective', 'Bi+ Collective',
    'Bi, pan, and everyone who got tired of picking a smaller word.',
    ARRAY['she/they'], ARRAY['bisexual','bi+','pansexual','wlw'],
    ARRAY['community','socials'], ARRAY['official'],
    'London', true, (SELECT id FROM public.communities WHERE slug = 'bi-collective')
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000008'::uuid,
    'wlw_london', 'WLW London',
    'Nights out, park hangs, and the group chat that actually replies.',
    ARRAY['she/her'], ARRAY['lesbian','wlw','queer'],
    ARRAY['socials','community'], ARRAY['official'],
    'London', true, (SELECT id FROM public.communities WHERE slug = 'wlw-london')
  )
) AS v(
  id, username, display_name, bio, pronouns, identity_labels,
  interests, custom_tags, city, owner, community_id
)
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  bio = EXCLUDED.bio,
  pronouns = EXCLUDED.pronouns,
  identity_labels = EXCLUDED.identity_labels,
  interests = EXCLUDED.interests,
  custom_tags = EXCLUDED.custom_tags,
  location_city = EXCLUDED.location_city,
  location_country = EXCLUDED.location_country,
  vetting_status = 'approved',
  access_tier = 'beta',
  admitted_at = COALESCE(public.profiles.admitted_at, now()),
  onboarding_completed = true,
  is_community_owner = EXCLUDED.is_community_owner,
  official_community_id = EXCLUDED.official_community_id,
  can_create_room = EXCLUDED.can_create_room,
  can_submit_game = EXCLUDED.can_submit_game,
  is_active = true,
  is_staff = false,
  staff_role = NULL;

-- Owner is admin of their own community. People join a few so Join/chat is testable.
INSERT INTO public.community_members (community_id, user_id, role)
SELECT p.official_community_id, p.id, 'admin'
FROM public.profiles p
WHERE p.official_community_id IS NOT NULL
  AND p.id IN (
    'bbbbbbbb-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002',
    'bbbbbbbb-0000-0000-0000-000000000003',
    'bbbbbbbb-0000-0000-0000-000000000004',
    'bbbbbbbb-0000-0000-0000-000000000005',
    'bbbbbbbb-0000-0000-0000-000000000006',
    'bbbbbbbb-0000-0000-0000-000000000007',
    'bbbbbbbb-0000-0000-0000-000000000008'
  )
ON CONFLICT (community_id, user_id) DO UPDATE SET role = 'admin';

INSERT INTO public.community_members (community_id, user_id, role)
SELECT c.id, v.user_id, 'member'
FROM (VALUES
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
  ('lesbians-of-london', 'aaaaaaaa-0000-0000-0000-000000000005'::uuid),
  ('queer-book-club',    'aaaaaaaa-0000-0000-0000-000000000002'::uuid),
  ('queer-gamers',       'aaaaaaaa-0000-0000-0000-000000000005'::uuid),
  ('queer-gamers',       'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
  ('wlw-entrepreneurs',  'aaaaaaaa-0000-0000-0000-000000000004'::uuid),
  ('wlw-entrepreneurs',  'aaaaaaaa-0000-0000-0000-000000000002'::uuid),
  ('bi-collective',      'aaaaaaaa-0000-0000-0000-000000000002'::uuid),
  ('roxy-official',      'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
  ('roxy-official',      'aaaaaaaa-0000-0000-0000-000000000002'::uuid),
  ('roxy-official',      'aaaaaaaa-0000-0000-0000-000000000004'::uuid),
  ('roxy-official',      'aaaaaaaa-0000-0000-0000-000000000005'::uuid)
) AS v(slug, user_id)
JOIN public.communities c ON c.slug = v.slug
ON CONFLICT (community_id, user_id) DO NOTHING;

UPDATE public.communities c
SET created_by = p.id
FROM public.profiles p
WHERE p.official_community_id = c.id;

-- Follow = feed. People follow each other and a couple of official accounts.
INSERT INTO public.follows (follower_id, followed_id)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000005'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000005'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000004')
ON CONFLICT DO NOTHING;

-- ── 6. Posts live on author_id. Trigger will keep community_id null. ────────

INSERT INTO public.posts (
  id, author_id, content, post_type, post_tags, media_urls,
  video_url, video_thumbnail_url, video_duration_secs, video_aspect_ratio,
  like_count, comment_count, feed_score, created_at
)
VALUES
  (
    'cccccccc-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Community walk vlog. Muddy boots, good company.',
    'video', ARRAY['outdoors','community'], '{}',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
    'https://picsum.photos/seed/walk-vlog/800/450', 90, '16:9',
    42, 2, 88, now() - interval '2 hours'
  ),
  (
    'cccccccc-0000-0000-0000-000000000002',
    'aaaaaaaa-0000-0000-0000-000000000005',
    'Dev log — queer visual novel. New dialogue system plus an enemies-to-lovers route.',
    'video', ARRAY['games','tech'], '{}',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    'https://picsum.photos/seed/devlog-thumb/800/450', 60, '16:9',
    67, 1, 94, now() - interval '5 hours'
  ),
  (
    'cccccccc-0000-0000-0000-000000000003',
    'aaaaaaaa-0000-0000-0000-000000000004',
    'Studio tour. Every piece made here by our small team.',
    'video', ARRAY['fashion','business'], '{}',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
    'https://picsum.photos/seed/studio-tour/800/450', 58, '16:9',
    31, 1, 76, now() - interval '1 day'
  ),
  (
    'cccccccc-0000-0000-0000-000000000004',
    'bbbbbbbb-0000-0000-0000-000000000002',
    'Sunday walk, same route, new faces. Come as you are.',
    'video', ARRAY['outdoors','community'], '{}',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    'https://picsum.photos/seed/lol-walk/800/450', 45, '16:9',
    54, 1, 81, now() - interval '8 hours'
  ),
  (
    'cccccccc-0000-0000-0000-000000000005',
    'bbbbbbbb-0000-0000-0000-000000000001',
    'Roxy update: posts live on your profile now. Follow someone and they show up here.',
    'video', ARRAY['news','community'], '{}',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    'https://picsum.photos/seed/roxy-update/800/450', 40, '16:9',
    88, 2, 99, now() - interval '3 hours'
  ),
  (
    'cccccccc-0000-0000-0000-000000000006',
    'aaaaaaaa-0000-0000-0000-000000000002',
    'October pick is Fingersmith. Bring your feelings and a pastry.',
    'photo', ARRAY['books','coffee'],
    ARRAY['https://picsum.photos/seed/roxy-coffee/800/600'],
    NULL, NULL, NULL, NULL,
    28, 2, 64, now() - interval '6 hours'
  ),
  (
    'cccccccc-0000-0000-0000-000000000007',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Dim sum and a hill this weekend if anyone wants in.',
    'standard', ARRAY['food','outdoors'], '{}',
    NULL, NULL, NULL, NULL,
    19, 1, 51, now() - interval '12 hours'
  ),
  (
    'cccccccc-0000-0000-0000-000000000008',
    'bbbbbbbb-0000-0000-0000-000000000003',
    'This month we are reading something that will ruin you in the best way. Details in chat.',
    'standard', ARRAY['books'], '{}',
    NULL, NULL, NULL, NULL,
    22, 1, 58, now() - interval '20 hours'
  ),
  (
    'cccccccc-0000-0000-0000-000000000009',
    'bbbbbbbb-0000-0000-0000-000000000004',
    'Friday night: co-op then voice chat. No ranked, no homework.',
    'standard', ARRAY['games'], '{}',
    NULL, NULL, NULL, NULL,
    36, 0, 70, now() - interval '30 hours'
  ),
  (
    'cccccccc-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-000000000004',
    'Looking for WLW-owned suppliers. Drop a rec, I will actually email them.',
    'standard', ARRAY['business','fashion'], '{}',
    NULL, NULL, NULL, NULL,
    15, 1, 47, now() - interval '2 days'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.comments (id, post_id, author_id, parent_id, content, like_count)
VALUES
  (
    'dddddddd-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000002',
    NULL,
    'The bit with the dogs. I rewound it.',
    4
  ),
  (
    'dddddddd-0000-0000-0000-000000000003',
    'cccccccc-0000-0000-0000-000000000005',
    'aaaaaaaa-0000-0000-0000-000000000005',
    NULL,
    'Finally. I was posting into a folder nobody opened.',
    6
  ),
  (
    'dddddddd-0000-0000-0000-000000000005',
    'cccccccc-0000-0000-0000-000000000006',
    'aaaaaaaa-0000-0000-0000-000000000001',
    NULL,
    'I am in. I will bring the pastry.',
    3
  ),
  (
    'dddddddd-0000-0000-0000-000000000006',
    'cccccccc-0000-0000-0000-000000000002',
    'aaaaaaaa-0000-0000-0000-000000000004',
    NULL,
    'Send the itch.io when the route ships.',
    2
  ),
  (
    'dddddddd-0000-0000-0000-000000000007',
    'cccccccc-0000-0000-0000-000000000008',
    'aaaaaaaa-0000-0000-0000-000000000002',
    NULL,
    'Already crying and we have not started.',
    5
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.comments (id, post_id, author_id, parent_id, content, like_count)
VALUES
  (
    'dddddddd-0000-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'dddddddd-0000-0000-0000-000000000001',
    'They adopted us, honestly.',
    2
  ),
  (
    'dddddddd-0000-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000005',
    'aaaaaaaa-0000-0000-0000-000000000002',
    'dddddddd-0000-0000-0000-000000000003',
    'Same. Follow Maya if you want the walk series.',
    1
  )
ON CONFLICT (id) DO NOTHING;

UPDATE public.posts p
SET comment_count = (
  SELECT count(*) FROM public.comments c
  WHERE c.post_id = p.id AND c.deleted_at IS NULL
)
WHERE p.id IN (
  'cccccccc-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000002',
  'cccccccc-0000-0000-0000-000000000003',
  'cccccccc-0000-0000-0000-000000000004',
  'cccccccc-0000-0000-0000-000000000005',
  'cccccccc-0000-0000-0000-000000000006',
  'cccccccc-0000-0000-0000-000000000007',
  'cccccccc-0000-0000-0000-000000000008',
  'cccccccc-0000-0000-0000-000000000009',
  'cccccccc-0000-0000-0000-00000000000a'
);

-- Official accounts host events on their community row. Profile Events tab
-- reads host_id, so the same night shows on the account.
INSERT INTO public.events (
  host_id, community_id, title, description, event_type,
  starts_at, location_text, max_attendees, status
)
SELECT
  p.id, p.official_community_id, v.title, v.description, v.event_type,
  now() + v.starts_in, v.location_text, v.cap, 'active'
FROM (VALUES
  ('roxy_official', 'Roxy house update', 'What shipped this week, then open questions.', 'online', interval '3 days', NULL::text, 80),
  ('lesbians_of_london', 'Sunday community walk', 'Hampstead, slow pace, coffee after.', 'in_person', interval '5 days', 'Hampstead Heath, London', 30),
  ('queer_book_club', 'Book Club: Fingersmith', 'Bring the book and a pastry.', 'in_person', interval '10 days', 'Foyles Café, London', 12),
  ('wlw_entrepreneurs', 'Founders brunch', 'Pitch, hire, or just eat.', 'in_person', interval '14 days', 'Brew & Co, Brixton', 20)
) AS v(username, title, description, event_type, starts_in, location_text, cap)
JOIN public.profiles p ON p.username = v.username
WHERE p.official_community_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.host_id = p.id AND e.title = v.title
  );

INSERT INTO public.event_attendees (event_id, user_id)
SELECT e.id, 'aaaaaaaa-0000-0000-0000-000000000001'
FROM public.events e
WHERE e.title IN ('Sunday community walk', 'Roxy house update')
ON CONFLICT DO NOTHING;

DROP TABLE seed_ids;
