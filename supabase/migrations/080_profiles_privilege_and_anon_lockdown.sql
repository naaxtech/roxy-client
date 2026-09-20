-- ============================================================
-- 080_profiles_privilege_and_anon_lockdown.sql
--
-- Two confirmed critical holes on public.profiles, both dating back to
-- 001_core_identity.sql and both untouched by every migration since (profiles
-- has had exactly four policies for its whole life -- 001:32/36/40/44).
--
-- HOLE 1 -- privilege escalation by PATCH.
--   profiles_update_own is FOR UPDATE USING (auth.uid() = id) with no WITH
--   CHECK and -- more importantly -- there has never been a single column-level
--   GRANT on this table. Supabase's default `GRANT ALL ON ALL TABLES IN SCHEMA
--   public TO anon, authenticated` therefore gives every signed-in user UPDATE
--   on all 38 columns, and RLS is row-level only: it decides *which rows*, never
--   *which columns*. A member could send
--     PATCH /rest/v1/profiles?id=eq.<self>
--     {"vetting_status":"approved","is_staff":true}
--   which is one request away from total compromise: is_roxy_staff() (069:94)
--   and is_approved_member() (072:39) both read straight off this row, so that
--   single PATCH opens every staff policy in 069-074, and after one self-insert
--   into reviewer_settings (rs_own, 070:260) can_review_application() returns
--   true for EVERY application platform-wide -- including the Art. 9 legal-name
--   reveal path at 070:422.
--
-- HOLE 2 -- the whole WLW roster readable with the shipped anon key.
--   profiles_select_public (001:32) has no TO clause. A policy with no TO
--   defaults to TO PUBLIC, which includes the `anon` role. The anon key is
--   hardcoded into apps/mobile/eas.json (all three build profiles), so it is in
--   every shipped bundle by design -- it is a publishable key, not a secret.
--   Result: an unauthenticated GET /rest/v1/profiles?select=display_name,
--   identity_labels,pronouns,location_city returns the entire membership of a
--   WLW app. That is an outing risk, not a privacy nit.
--
-- The fix for hole 1 is column grants, not policy text. This is the same
-- two-control pattern already applied and live on notifications (057:34) and
-- invite_codes (070:168): RLS picks the rows, GRANT picks the columns, and
-- neither one can do the other's job.
--
-- Retry-safe: every statement is idempotent. DROP POLICY IF EXISTS + CREATE
-- matches the house style in 070. REVOKE/GRANT are naturally idempotent -- the
-- end-state ACL is identical whether this runs once or ten times.
-- ============================================================

-- ── 1. Column privileges on public.profiles ─────────────────────────────────
--
-- Everything below is derived from what the apps actually write, not from what
-- the schema allows. Full audit of every client write path:
--
--   apps/mobile/app/(auth)/onboarding/step1-identity.tsx:44  upsert id, username,
--        display_name, identity_labels, pronouns   <- the row is created here;
--        there is NO handle_new_user trigger on auth.users, so this client
--        upsert is the only thing that ever creates a profile row
--   apps/mobile/app/(auth)/onboarding/step2-interests.tsx:26  interests
--   apps/mobile/app/(auth)/onboarding/step3-photo.tsx:51      avatar_url
--   apps/mobile/app/(auth)/onboarding/step4-status.tsx:35      is_dating_mode,
--        onboarding_completed
--   apps/mobile/store/profileStore.ts:23   {...patch, updated_at}, callers being
--        profile/edit.tsx:142,153 avatar_url · :165 pronouns · :173
--        identity_labels · :237 bio, and profile/settings.tsx:132
--        is_dating_mode · :150 is_ghost
--   apps/mobile/store/themeStore.ts:25     theme_preference
--   apps/mobile/store/friendStore.ts:64    last_seen_at  (presence heartbeat)
--   apps/mobile/app/(tabs)/connect/index.tsx:428  is_dating_mode
--   apps/studio/components/ThemeToggle.tsx:24     theme_preference
--   apps/studio/app/(dashboard)/settings/account-actions.ts:22
--        notification_preferences  (session client, so it runs as
--        `authenticated` -- NOT the admin client used by deleteAccount below)
--
-- Deliberately absent, with the reason each one is safe to withhold:
--   vetting_status, admitted_via_code_id, admitted_at
--        written only by _apply_decision (071:455) / decide_application
--        (071:530), both SECURITY DEFINER, so they keep working after this
--        REVOKE -- a SECURITY DEFINER function runs with its owner's privileges,
--        not the caller's.
--   is_staff, is_verified, gov_verified   operator-set trust flags. No client
--        path exists and none should.
--   gamification_points, badge_ids        award_badge_points() (007:43) is
--        SECURITY DEFINER; unaffected.
--   streak_count, streak_last_day         record_daily_checkin() (056:14) is
--        SECURITY DEFINER; unaffected.
--   can_create_room, can_submit_game      capability flags (016:26-27). Not in
--        the brief, but they are the same class of hole: a self-grant here mints
--        room-creation and game-submission rights. Withheld for the same reason.
--   is_active, deleted_at                 account lifecycle. Deletion runs
--        service-role only: mobile via the gdpr-delete edge function
--        (profile/delete-account.tsx:30), studio via
--        adminClient.auth.admin.deleteUser (account-actions.ts:39).
--   stripe_customer_id, last_shipping_address   marketplace fields written by
--        edge functions on the service role.
--   behavioural_consent                   no client write path exists anywhere
--        in apps/ today (grepped). If a consent toggle is ever built, it adds
--        one column to this grant in a new migration.
--   dating_looking_for, age_min_pref, age_max_pref, location_city,
--   location_country                      declared in 001 but no screen writes
--        them today. Granting write on a column no code writes is pure attack
--        surface, so they stay out until the screen that needs them ships.
--   created_at                            immutable by definition.
--
-- Revoked from anon as well as authenticated. anon cannot reach a row anyway
-- (every remaining policy is TO authenticated after section 2), but a table
-- grant that only RLS is holding back is one policy edit away from being live.
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;

-- `id` is in the UPDATE list on purpose and is not a widening. PostgREST
-- compiles .upsert() into INSERT ... ON CONFLICT (id) DO UPDATE SET over the
-- payload columns, and step1-identity.tsx sends `id` in that payload -- so
-- without UPDATE(id) a returning user who re-enters step 1 gets a bare 42501
-- and can never finish onboarding. It grants nothing: the new WITH CHECK in
-- section 3 permits exactly one value for id, namely auth.uid(), which is the
-- value the row already has. The write is provably a no-op.
--
-- `updated_at` likewise: the profiles_updated_at trigger (001:60) already
-- overwrites it with now(), but profileStore.ts:23 puts it in the SET list of
-- every single patch, and column privileges are checked against the statement's
-- SET list. Omit it and every profile edit in the mobile app dies.
GRANT UPDATE (
  id,
  username,
  display_name,
  bio,
  avatar_url,
  pronouns,
  identity_labels,
  interests,
  is_dating_mode,
  is_ghost,
  onboarding_completed,
  theme_preference,
  notification_preferences,
  last_seen_at,
  updated_at
) ON public.profiles TO authenticated;

-- Exactly the five columns step1-identity.tsx:44 sends. Every other column on a
-- new row comes from its schema DEFAULT, which is the point: a user cannot hand
-- herself vetting_status='approved' at creation time because she cannot name
-- the column in the INSERT at all.
GRANT INSERT (
  id,
  username,
  display_name,
  identity_labels,
  pronouns
) ON public.profiles TO authenticated;

-- ── 2. Close the anon read on profiles ──────────────────────────────────────
-- USING is unchanged -- the visibility rule was never wrong, the audience was.
-- Adding TO authenticated is what stops the anon key from working here.
--
-- Nothing legitimate reads profiles unauthenticated: the four pre-auth screens
-- (welcome, code, application, pending) touch no table directly, and the
-- username-availability probe at step1-identity.tsx:31 runs after sign-in, so
-- it is already `authenticated`. Studio reads profiles through the session
-- client (lib/staff-auth.ts) or the service role, both unaffected.
DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;
CREATE POLICY "profiles_select_public" ON public.profiles
  FOR SELECT TO authenticated
  USING (is_active = true AND is_ghost = false);

-- Also pinned to authenticated. This one was never exploitable -- auth.uid() is
-- NULL for anon, and NULL = id is NULL, so it never matched a row. But that
-- means the anon lockdown above rested on a NULL-comparison accident rather
-- than on an audience rule. Made structural so it stays true if the predicate
-- is ever edited.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Same shape, same fix: communities_read_public (003:19) had no TO clause, so
-- the public community directory -- names, slugs, descriptions, categories --
-- was enumerable pre-auth with the bundled key. No pre-auth screen reads this
-- table; the invite flow goes through SECURITY DEFINER RPCs instead.
DROP POLICY IF EXISTS "communities_read_public" ON public.communities;
CREATE POLICY "communities_read_public" ON public.communities
  FOR SELECT TO authenticated
  USING (is_private = false);

-- ── 3. Explicit WITH CHECK on the profiles write policies ───────────────────
--
-- Honest note on what this half does: with USING (auth.uid() = id), Postgres's
-- fallback of reusing USING as WITH CHECK happens to produce the correct
-- constraint, so the missing WITH CHECK is not itself the escalation -- section
-- 1 is. It is written out anyway because the fallback is a property of *this*
-- predicate, not a guarantee. The moment USING is widened (a staff-read clause,
-- a moderation clause), the implicit WITH CHECK widens with it silently and the
-- row-ownership rule quietly disappears. 070:158 hit exactly this on
-- invite_codes, where the reused USING let an admin flip is_review_code and
-- bypass human review in one statement.
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- The insert policy gets the same TO clause plus a belt-and-braces predicate.
-- The three flags below cannot appear in an INSERT at all after section 1, so
-- today this only ever sees their DEFAULTs and is trivially true. It is here
-- for the day someone widens the INSERT grant without re-reading this comment:
-- the predicate fails the statement instead of minting a staff account.
--
-- vetting_status is deliberately NOT pinned here even though it is the highest
-- value target. Its default is policy, not invariant -- 070:57 set 'unvetted',
-- 072:35 moved it to 'pending', 079 moved it back -- so a hardcoded predicate
-- would turn the next intentional default change into a total signup outage.
-- The column grant is the control for that one, and it is unconditional.
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND is_staff = false
    AND is_verified = false
    AND gov_verified = false
  );

COMMENT ON TABLE public.profiles IS
  'Column-level INSERT/UPDATE grants (080) are load-bearing security, not tidiness: RLS on this table decides which ROW you may write, and only the GRANT decides which COLUMNS. is_staff and vetting_status feed is_roxy_staff() and is_approved_member(), so any column added here that a client may write must be checked against those two first.';
