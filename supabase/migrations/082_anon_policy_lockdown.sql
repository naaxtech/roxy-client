-- ============================================================
-- 082_anon_policy_lockdown.sql
--
-- The rest of the class of bug 080 closed on profiles and communities.
--
-- Root cause, restated once because all ten instances share it: a CREATE POLICY
-- with no TO clause defaults to TO PUBLIC, and PUBLIC includes `anon`. Supabase
-- additionally ships `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,
-- authenticated` and `GRANT SELECT ON storage.objects TO anon`, so the grant is
-- never the thing stopping an unauthenticated caller -- the policy is. The anon
-- key is hardcoded in apps/mobile/eas.json (three build profiles) and ships in
-- every bundle by design; it is a publishable key, not a secret. So "no TO
-- clause" means "readable by anyone who has downloaded the app", which is
-- everyone.
--
-- Every one of the ten was verified against its source before being touched,
-- and grepped forward: none of them is re-created or dropped by any later
-- migration, so the definitions below are the live ones.
--
-- ── Why the six storage policies do NOT break image rendering ────────────────
--
-- All six buckets are `public = true` (002:5, 040:14, 044:8, 045:181, 055:11,
-- 059:8). For a public bucket the byte-serving path is not RLS-checked at all:
--   "When a bucket is designated as 'Public,' it effectively bypasses access
--    controls for both retrieving and serving files within the bucket."
--   "Access control is still enforced for other types of operations including
--    uploading, deleting, moving, and copying."
-- -- src: https://supabase.com/docs/guides/storage/buckets/fundamentals · 2026-08-02
--
-- What the SELECT policy on storage.objects actually gates is the LISTING API,
-- which Supabase confirms runs on the same SQL SELECT privilege as authenticated
-- download and is distinguishable from it only with the operation-aware helpers:
--   "This is useful when a single SQL privilege such as SELECT is used by
--    multiple Storage actions, but you want a policy to apply to only one of
--    them, such as object listing versus object download."
-- -- src: https://supabase.com/docs/guides/storage/schema/helper-functions · 2026-08-02
--
-- So restricting SELECT to authenticated closes listing and leaves rendering
-- untouched -- but only for as long as the buckets stay public. That is a real
-- coupling, not a throwaway assumption, so the 082 test asserts `public = true`
-- on all six rather than trusting this comment. Flip a bucket to private without
-- re-reading this and images go dark everywhere; the test fails first.
--
-- Confirmed against the shipped read paths rather than inferred:
--   * zero `.list(` calls exist in apps/mobile or apps/studio -- nothing in the
--     product uses the listing API, so nothing loses a capability here.
--   * zero `.download(` and zero `createSignedUrl(` calls -- neither app ever
--     touches the RLS-checked object endpoint.
--   * every read is `getPublicUrl()` or a hand-built URL, and all four
--     hand-built ones are `/storage/v1/object/public/...`
--     (mobile/lib/media.ts:31, ProfilePhotoGrid.tsx:101, ProductForm.tsx:171) --
--     i.e. the CDN path that bypasses RLS.
--   * zero storage usage in supabase/functions/** (and service_role bypasses RLS
--     regardless).
-- No bucket is left alone. The docs and the call sites agree that none of the
-- six needs to be.
--
-- The SELECT policy is still load-bearing for signed-in users and is replaced
-- rather than dropped: `upsert: true` uploads need SELECT as well as INSERT
-- ("To allow overwriting files using the upsert functionality you will need to
-- additionally grant SELECT and UPDATE permissions" -- src:
-- https://supabase.com/docs/guides/storage/security/access-control · 2026-08-02),
-- and avatars, profile-photos, business-logos and room-banners all upsert. Those
-- callers are `authenticated`, so they keep working. Dropping the policy instead
-- of narrowing it would have broken every avatar change in the app.
--
-- ── Severity, ranked by what a path name identifies ──────────────────────────
-- The listing API returns object names and timestamps, so path shape IS the
-- payload. Path shapes are taken from the INSERT policies and confirmed against
-- the call sites that satisfy them:
--
--   1. post-media      <user_uuid>/<epoch_ms>-<i>.<ext>   (045:190 · create-post.tsx:236)
--   2. profile-photos  <user_uuid>/<epoch_ms>.<ext>       (055:20 · ProfilePhotoGrid.tsx:78)
--        Worst two: user UUID plus per-upload timestamps. Unauthenticated, that
--        is a membership roster of a WLW app with an activity timeline attached
--        -- the same outing risk 080 closed on profiles, reached by another door.
--   3. avatars         <user_uuid>/avatar.jpg             (002:14 · step3-photo.tsx:46, edit.tsx:137)
--   4. business-logos  <user_uuid>/logo.<ext>             (040:26 · BusinessForm.tsx:46)
--        Also user-keyed -- correcting the audit note that named only the first
--        two. Fixed filenames, so no activity timeline, but the folder list is
--        still a complete roster of UUIDs. business-logos is narrower (business
--        owners only, a semi-public population by nature).
--   5. product-photos  <business_id>/<product_id>/<uuid>.<ext> (044:23 · ProductForm.tsx:137)
--   6. room-banners    <community_id>/<room_id>            (059:21 · RoomModal.tsx:97)
--        Not user-keyed. These leak commercial catalog and room inventory, which
--        is a competitive-intelligence nit rather than a safety issue. Fixed
--        anyway: they are the same one-word defect, and leaving two of six
--        undone is how the next audit finds this file and has to re-derive all
--        of it.
--
-- Names are kept as-is on replacement so this is a true swap with no orphan left
-- behind, which does leave three policies called *_read_public that are no
-- longer public. Same tradeoff 080 accepted for profiles_select_public: a
-- rename would mean a drop plus a create under a new name, and any failure
-- between the two leaves the table with no read policy at all.
--
-- Deliberately NOT done here: revoking the baseline anon SELECT grant on these
-- four tables. 080's own reasoning says a grant held back only by RLS is one
-- policy edit from being live, and that still applies -- but 080 revoked write
-- privileges, and revoking read is a broader posture change with its own blast
-- radius (feature_requests carries a SECURITY INVOKER trigger,
-- update_feature_vote_count 041:45, that writes back to the table under the
-- caller's own privileges). That belongs in its own slice with its own test, not
-- smuggled into a one-word TO-clause fix.
--
-- Retry-safe: DROP POLICY IF EXISTS + CREATE throughout, per 070 and 080.
-- ============================================================

-- ── 1. Public reference + community tables ──────────────────────────────────

-- badges is a static catalog -- no user data on the row -- so this one is
-- reputational rather than dangerous: it hands an attacker the full gamification
-- design pre-auth. It is read only as an embedded join from user_badge_progress
-- (grow/badges.tsx:40 `.select('*, badges(*)')`, grow/index.tsx), and PostgREST
-- applies the embedded table's own RLS, so authenticated must keep reading it.
DROP POLICY IF EXISTS "badges_read_all" ON public.badges;
CREATE POLICY "badges_read_all" ON public.badges
  FOR SELECT TO authenticated
  USING (true);

-- Same shape, same reasoning. Every read is post-auth: connect/index.tsx:297,
-- discover/index.tsx:108, ProfileFavorites.tsx:57, contentNavigation.ts:31, and
-- studio's (dashboard)/games/** + lib/games.ts -- all behind a session.
DROP POLICY IF EXISTS "games_read_all" ON public.games;
CREATE POLICY "games_read_all" ON public.games
  FOR SELECT TO authenticated
  USING (true);

-- The roadmap board. Rows carry created_by (041:11), so unauthenticated this
-- leaks unreleased product plans joined to the UUIDs of the members who asked
-- for them. Read only from feedbackStore.ts:73 (mobile, post-auth) and studio's
-- staff pages, which run on the session client.
DROP POLICY IF EXISTS "feature_requests_read" ON public.feature_requests;
CREATE POLICY "feature_requests_read" ON public.feature_requests
  FOR SELECT TO authenticated
  USING (true);

-- The worst of the four. feature_votes.user_id (041:19) is a bare FK to
-- auth.users with an index on it (041:26), so anon could pull the whole table
-- and get a set of real member UUIDs -- a join key back into every other table
-- keyed by user, and the exact enumeration primitive 080 removed by closing
-- profiles. The vote itself is also an opinion attached to a person.
--
-- USING (true) is kept on purpose: votes are public *within* the app -- that is
-- what makes the board work -- and narrowing the predicate would change product
-- behaviour. The audience was wrong, not the visibility rule.
DROP POLICY IF EXISTS "feature_votes_read" ON public.feature_votes;
CREATE POLICY "feature_votes_read" ON public.feature_votes
  FOR SELECT TO authenticated
  USING (true);

-- ── 2. Storage object listing ───────────────────────────────────────────────
--
-- Writing to storage.objects from a migration is established practice in this
-- repo, not a new privilege assumption: 002, 040, 044, 045 and 055 all CREATE
-- POLICY here and 059 additionally DROPs, and every one of those is applied.

-- <user_uuid>/avatar.jpg. Restricting this does not affect the avatar shown on
-- any screen -- those all render from getPublicUrl over the CDN path.
DROP POLICY IF EXISTS "avatars_read_public" ON storage.objects;
CREATE POLICY "avatars_read_public" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

-- <user_uuid>/logo.<ext> -- despite the bucket sounding org-scoped, the folder
-- is the owner's auth.uid (040:26), so this enumerates business owners.
DROP POLICY IF EXISTS "business_logos_read_public" ON storage.objects;
CREATE POLICY "business_logos_read_public" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'business-logos');

-- <business_id>/<product_id>/<uuid>.<ext> -- no user identifier anywhere in the
-- path. Lowest severity of the six; fixed for consistency, not urgency.
DROP POLICY IF EXISTS "product_photos_read_public" ON storage.objects;
CREATE POLICY "product_photos_read_public" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'product-photos');

-- <user_uuid>/<epoch_ms>-<i>.<ext>. The highest-value listing in the project:
-- UUID plus a millisecond timestamp per upload reconstructs who posted media and
-- when, with no session at all.
DROP POLICY IF EXISTS "post_media_read" ON storage.objects;
CREATE POLICY "post_media_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'post-media');

-- <user_uuid>/<epoch_ms>.<ext>. Same primitive as post-media, and on a WLW app
-- "which members have uploaded profile photos, and when" is exactly the fact
-- that must not be readable without a session.
DROP POLICY IF EXISTS "profile_photos_storage_read" ON storage.objects;
CREATE POLICY "profile_photos_storage_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'profile-photos');

-- <community_id>/<room_id> -- community and room UUIDs, no user identifier.
-- Pairs with 080's closure of communities_read_public: leaving room inventory
-- enumerable would have partly undone that.
DROP POLICY IF EXISTS "room_banners_read" ON storage.objects;
CREATE POLICY "room_banners_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'room-banners');

COMMENT ON TABLE public.feature_votes IS
  'feature_votes.user_id is a live auth.users join key, so its SELECT policy must stay TO authenticated (082). A read policy here that omits TO is an anon-key member-enumeration endpoint, not a visibility preference.';
