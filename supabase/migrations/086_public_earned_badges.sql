-- ============================================================
-- 086_public_earned_badges.sql
--
-- Other members' badge strips render blank, and have done since 007.
--
-- ── ROOT CAUSE ──────────────────────────────────────────────────────────────
-- public.user_badge_progress has exactly one SELECT policy for its whole life,
-- ubp_owner_select (007_gamification.sql:31):
--
--     CREATE POLICY "ubp_owner_select" ON user_badge_progress
--       FOR SELECT USING (user_id = auth.uid());
--
-- No later migration re-creates or drops it -- grepped 008 through 085; the
-- only other file that names this table is 082, and only in a comment about
-- the badges catalog it embeds. So a member reads her own badge rows and
-- nobody else's, ever.
--
-- ProfileCard renders a badge strip for whatever profile it is handed --
-- header chips at components/profile/ProfileCard.tsx:317-330, the full grid at
-- ProfileCard.tsx:471 -- and the other-user route already asks exactly the
-- right question: app/(tabs)/profile/[userId].tsx:39 selects
-- user_badge_progress with .eq('user_id', userId) for the profile being
-- viewed. RLS answers with zero rows. The client filter was never the bug.
--
-- It stayed invisible because RLS *filters* rather than errors: PostgREST
-- returns 200 with [], and [userId].tsx:46 does `if (badgesRes.data)
-- setBadges(...)`, so "policy refused every row" and "she has no badges" are
-- the same observable. Nothing on that path has ever logged a failure.
--
-- ── WHAT SHIPS ──────────────────────────────────────────────────────────────
-- An earned badge is a social signal: the whole point is that other women see
-- it. An in-progress row is not -- "37 of 50 messages sent" is an activity
-- metric about a person, handed to a stranger, on a WLW app. The split is
-- therefore `earned_at IS NOT NULL`, and it is expressed as a second
-- PERMISSIVE SELECT policy rather than as a view or a SECURITY DEFINER
-- function.
--
-- ── Why a policy predicate, and not a view or a definer function ────────────
--
-- A VIEW was the obvious alternative, because it is the only one of the three
-- that can also drop a COLUMN (see the residual note below). It was rejected:
--   * To be readable at all it must be `security_invoker = false`, i.e. it
--     bypasses the base table's RLS and becomes the sole gate. The base table's
--     policies would then no longer describe who can read the base table's
--     rows, which is the exact condition that makes an audit six months from
--     now re-derive all of this from scratch.
--   * The client would have to fork: base table for self (grow/badges.tsx and
--     profile/edit.tsx both need current_value for the progress bars), view for
--     everyone else. Two code paths for one concept.
--   * Every read of this table is `.select('*, badges(*)')` -- a PostgREST
--     resource embed. Embedding through a view depends on PostgREST inferring
--     the relationship from the view's source columns. That is version-
--     dependent behaviour I cannot exercise against this database from a
--     migration, and shipping a design whose only query I cannot verify is not
--     a trade worth making for a column.
--
-- A SECURITY DEFINER function (the 085 house shape) was rejected for more:
-- it bypasses RLS entirely and re-states the visibility rule in PL/pgSQL where
-- there is no policy to fall back on; it kills the `badges(*)` embed, so the
-- join moves into a RETURNS TABLE signature and every future badge column
-- becomes a DROP + CREATE migration (CREATE OR REPLACE cannot change a return
-- type); and it forces a client rewrite from .from().select() to .rpc().
--
-- The policy predicate costs zero client change to the fetch shape, keeps the
-- rule in the one place a reader looks for it (`\d+ user_badge_progress`), and
-- composes automatically with any future reader -- a leaderboard, a friends
-- list, studio -- with no second surface to keep in sync.
--
-- ── Known residual, stated rather than hidden ───────────────────────────────
-- RLS chooses ROWS, never COLUMNS (080:34, same lesson). So an earned row
-- exposes current_value along with it. Column GRANTs cannot separate the two
-- audiences here, because the owner and the viewer are the same `authenticated`
-- role -- revoking SELECT(current_value) would blank the owner's own progress
-- bars at grow/badges.tsx:146 and profile/edit.tsx:295.
--
-- Today that residual is empty: nothing anywhere writes current_value. Grepped
-- the whole repo -- the only writer of this table is the 019 dev seed, there is
-- no incrementer in supabase/functions/**, no trigger, and no client write. On
-- an earned row current_value is a static number that says nothing the badge
-- itself does not already say.
--
-- The day a real awarder ships, that stops being true: current_value becomes a
-- live activity counter, and an earned badge sharpens from "she has sent at
-- least 50 messages" to "she has sent 431". THAT is the trigger to move the
-- public read behind a `security_invoker = false` view exposing only
-- (user_id, badge_id, earned_at) -- not before. The tripwire is written into
-- the table COMMENT at the bottom of this file, where whoever writes the
-- awarder will be reading.
--
-- ── Why the viewer and the target are both checked ─────────────────────────
-- `earned_at IS NOT NULL` alone would turn this table into a member-enumeration
-- endpoint: GET /rest/v1/user_badge_progress?select=user_id returns the user_id
-- of everyone who has ever earned a badge, including the accounts 080
-- deliberately hid behind is_active/is_ghost. That is the same primitive 082
-- called "the worst of the four" on feature_votes, reached by another door.
-- So:
--   * the VIEWER must be an approved member -- public.is_approved_member()
--     (072:39), the same gate 072/073/076 put on posts and events. Reading
--     another member's badges is reading another member's content.
--   * the TARGET must be a profile the viewer could already open --
--     is_active AND NOT is_ghost, the predicate of profiles_select_public
--     (080:157). Badges must never be more visible than the profile they
--     decorate.
--
-- The viewer gate is checked against the live default, not assumed: 079:37 set
-- profiles.vetting_status DEFAULT 'unvetted', and is_approved_member() accepts
-- 'unvetted' alongside 'approved' (072:51). So every ordinary production
-- account -- existing (backfilled to 'unvetted' by 070) and newly signed up --
-- passes this clause. The only accounts it stops are genuine mid-review
-- applicants sitting at 'pending', which is the population the gate exists for.
-- If 079's note is ever actioned and the strict 'pending' default comes back,
-- that is a whole-app change, not a badge change: posts, events and comments
-- (072/073/076) go dark at the same instant and by the same predicate.
--
-- The EXISTS on profiles is deliberately redundant: policy expressions are
-- themselves subject to the referenced table's RLS, so profiles_select_public
-- would already hide a ghosted target. Writing the predicate out means badge
-- visibility stays capped at profile visibility even if someone later widens
-- the profiles policy without re-reading this file. It is a cheap subquery:
-- every read of this table is filtered .eq('user_id', ...) and lands on
-- idx_ubp_user (007:36), so the EXISTS runs over a handful of rows. No new
-- index is added -- a partial index on (user_id) WHERE earned_at IS NOT NULL
-- would buy nothing over a lookup that already returns single digits, and would
-- cost write amplification on the awarder that is coming.
--
-- ── The three inherited policies are pinned to authenticated too ────────────
-- All three ubp_* policies (007:31-33) were written with no TO clause, which
-- means TO PUBLIC, which includes `anon` -- the role behind the publishable key
-- hardcoded into apps/mobile/eas.json. None of them is exploitable today, for
-- the same accident 080 documented on profiles_select_own: auth.uid() is NULL
-- for anon and `user_id = NULL` is NULL, so no row ever matches. But that means
-- the table's anon safety rested on a NULL-comparison accident rather than on
-- an audience rule -- and this migration is about to add a second permissive
-- SELECT policy to the same table, where policies are OR'd and one sibling with
-- no TO clause undoes the other. Made structural here so it stays true.
--
-- ubp_owner_update additionally gets an explicit WITH CHECK. Postgres reuses
-- USING for WITH CHECK when the latter is omitted, and for this predicate the
-- reuse happens to be correct -- but that is a property of the predicate, not a
-- guarantee, and 070:158 already cost us once on invite_codes when a widened
-- USING silently widened the implicit WITH CHECK with it.
--
-- Retry-safe: DROP POLICY IF EXISTS + CREATE throughout, per 070, 080 and 082.
-- Re-running lands on the identical end state.
-- ============================================================

-- ── 1. Earned badges become readable by other members ───────────────────────

DROP POLICY IF EXISTS "ubp_earned_public_select" ON public.user_badge_progress;
CREATE POLICY "ubp_earned_public_select" ON public.user_badge_progress
  AS PERMISSIVE
  FOR SELECT TO authenticated
  USING (
    -- The split. An unearned row is a half-finished progress bar and stays
    -- private to its owner, who reaches it through ubp_owner_select below.
    earned_at IS NOT NULL

    -- Viewer side of the gate.
    AND public.is_approved_member()

    -- Target side. Mirrors profiles_select_public (080:157) so a badge can
    -- never out an account whose profile is hidden.
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = user_badge_progress.user_id
        AND p.is_active = true
        AND p.is_ghost  = false
    )
  );

-- ── 2. The three inherited policies, pinned to an audience ──────────────────
--
-- Predicates are unchanged. The TO clause is the whole edit, exactly as 080
-- did for profiles_select_own. This is what keeps section 1 from being
-- undone by an OR'd sibling that anon can satisfy.
--
-- ubp_owner_select is what still gives a member her own in-progress rows, and
-- it is why section 1 is an ADDITION rather than a replacement: a ghosted or
-- deactivated member keeps seeing her own badges even though section 1 hides
-- them from everyone else.

DROP POLICY IF EXISTS "ubp_owner_select" ON public.user_badge_progress;
CREATE POLICY "ubp_owner_select" ON public.user_badge_progress
  AS PERMISSIVE
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ubp_owner_insert" ON public.user_badge_progress;
CREATE POLICY "ubp_owner_insert" ON public.user_badge_progress
  AS PERMISSIVE
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ubp_owner_update" ON public.user_badge_progress;
CREATE POLICY "ubp_owner_update" ON public.user_badge_progress
  AS PERMISSIVE
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.user_badge_progress IS
  'Two-audience read (086): ubp_owner_select gives a member every row of her own, including in-progress ones; ubp_earned_public_select gives approved members the earned rows (earned_at IS NOT NULL) of visible profiles only. Any new SELECT policy here must keep BOTH halves of that split and must carry TO authenticated -- policies are OR''d, so one permissive sibling without a TO clause republishes in-progress rows to the shipped anon key. RLS cannot hide a COLUMN: current_value rides along on every earned row, which is harmless only while nothing increments it. Whoever ships the badge awarder owns moving the public read behind a security_invoker=false view over (user_id, badge_id, earned_at) -- see the residual note in 086.';
