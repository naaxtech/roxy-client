-- ============================================================
-- 087_server_authoritative_badges.sql
--
-- Badges have never been awarded, and members can award them to themselves.
-- 086 is blocked on this file: publishing earned rows without it publishes
-- forgeries and nothing else.
--
-- ── ROOT CAUSE 1 -- nothing has ever awarded a badge ────────────────────────
-- Grepped every migration, every edge function, both apps. The only statement
-- in this repository that has ever written public.user_badge_progress is
-- 019_juicypeach_badges.sql:15, a one-off dev seed that hands three badges to
-- whichever row has username='juicypeach' and does nothing on a database where
-- that account is absent.
--
-- Everything else is a read:
--   apps/mobile/app/(tabs)/grow/badges.tsx:39        .select('*, badges(*)')
--   apps/mobile/app/(tabs)/grow/index.tsx:170        .select('*, badges(*)')
--   apps/mobile/app/(tabs)/profile/index.tsx:55      .select('*, badges(*)')
--   apps/mobile/app/(tabs)/profile/edit.tsx:45       .select('*, badges(*)')
--   apps/mobile/app/(tabs)/profile/[userId].tsx:39   .select('*, badges(*)')
-- supabase/functions/** contains the string "badge" zero times. So the four
-- badges seeded at 007:65 have been decorative for the life of the product:
-- award_badge_points() (007:43) is a trigger nothing legitimate ever fires.
--
-- ── ROOT CAUSE 2 -- members can mint their own ──────────────────────────────
-- No migration has ever issued a REVOKE against this table (grepped: the
-- REVOKEs in 056, 057, 070, 071, 072, 074, 077, 080, 081, 083 and 085 name
-- other objects), so Supabase's bootstrap `GRANT ALL ON ALL TABLES IN SCHEMA
-- public TO anon, authenticated` still stands on it. Combined with
-- ubp_owner_insert (007:32, WITH CHECK user_id = auth.uid()) and
-- ubp_owner_update (007:33, USING user_id = auth.uid()), a signed-in member
-- can run:
--
--     POST  /rest/v1/user_badge_progress   {"user_id":<self>,"badge_id":<any>}
--     PATCH /rest/v1/user_badge_progress?user_id=eq.<self>  {"earned_at":"now"}
--
-- The PATCH is an UPDATE that takes earned_at from NULL to a value, which is
-- exactly the transition trg_award_badge_points fires on (007:47-53). That
-- trigger is SECURITY DEFINER, so it writes profiles.gamification_points even
-- though 080:101 revoked UPDATE on profiles from authenticated. Repeat per
-- badge id and the leaderboard is whatever she wants it to be.
--
-- Note the INSERT alone is not enough: the 007 trigger is AFTER UPDATE only, so
-- a row inserted with earned_at already set awards no points. Both the forgery
-- and the fix below therefore have to write earned_at in a second statement.
--
-- ── WHAT SHIPS ──────────────────────────────────────────────────────────────
-- Progress is DERIVED, never declared. _sync_badges_for() counts the source
-- tables itself and overwrites current_value with what it finds; it takes no
-- count, no threshold and no earned_at from any caller. "My message count is
-- 500" and a hand-written earned_at are the same forgery, so neither is an
-- input. The only argument the member-facing entry point accepts is nothing at
-- all -- sync_my_badges() reads auth.uid() and has no parameters, so there is
-- no field to tamper with.
--
-- Then the grants come off the table, so the derived path is the only path.
--
-- ── Which badges are derivable, and from what ───────────────────────────────
-- The catalog is four rows (007:65-70) and all four have a server-side source:
--   connections     -> friendships, status='accepted', either direction
--   messages        -> messages.sender_id
--   community_joins -> community_members.user_id
--   speed_dates     -> speed_date_sessions that actually STARTED, see below
-- A requirement_type outside that set returns NULL from
-- badge_requirement_value() and is skipped entirely -- no row is created and no
-- badge is awarded. A badge nobody can compute is a badge nobody earns, which
-- is the safe direction to fail in.
--
-- speed_dates is the one that needed care. status='completed' is overloaded:
-- leave_speed_date_queue() (077:368) and release_speed_date_claim() (077:427)
-- both retire abandoned QUEUE rows to 'completed', so counting that status
-- alone would award "Speed Dater" for joining a queue and leaving. started_at
-- is only ever set by claim_speed_date_partner() when two people are actually
-- paired (077:225), and release_speed_date_claim() nulls it again when a claim
-- is rolled back (077:410). `status='completed' AND started_at IS NOT NULL` is
-- therefore the narrowest honest statement of "a date happened".
--
-- ── current_value is capped at the threshold, on purpose ────────────────────
-- 086's stated residual is that RLS filters rows and never columns, so once a
-- real awarder ships, an earned row published to other members carries a live
-- activity counter: "she has sent 431 messages" rather than "she has sent at
-- least 50". 086 names moving the public read behind a view as the trigger for
-- that day and puts it in the table COMMENT.
--
-- This file closes it at the source instead, which is cheaper and needs no
-- second read surface: every count is taken through `LIMIT threshold`, so
-- current_value can never exceed requirement_threshold and an earned row says
-- precisely what the badge already says. No view, no client fork, no PostgREST
-- embed to re-verify. The table COMMENT is rewritten at the bottom to record
-- that the residual is closed rather than pending -- 086 asked whoever shipped
-- the awarder to own that decision, and this is the decision.
--
-- The cap is also why the loop reads the catalog row by row rather than
-- computing all four counts in one pass: the cap is per badge.
--
-- ── Why ubp_owner_insert / ubp_owner_update are KEPT, not dropped ───────────
-- Dropping them is the marginally stronger control and this is a deliberate
-- trade, stated rather than glossed. With the grants revoked, PostgREST (which
-- connects as `authenticated`) fails at the ACL check with 42501 before any
-- policy is consulted, so neither policy is load-bearing either way. The one
-- scenario that separates them is a future GRANT restoring INSERT/UPDATE on
-- this table: with the policies dropped, RLS would still refuse every write
-- because no permissive write policy would remain; with them kept, the forgery
-- is live again.
--
-- They are kept for two reasons:
--   1. 086 pins all three ubp_owner_* policies to TO authenticated and its
--      companion check asserts all four policies exist, with the right command
--      and PERMISSIVE (tests/086_public_earned_badges_check.sql:46-86). 086 and
--      087 land in the same push. Dropping two of them turns that check into a
--      false "migration 086 is not applied" failure -- a verification script
--      that cries wolf is worse than the residual it would be reporting.
--   2. It is the shape 080 already chose on profiles: REVOKE picks the columns
--      and privileges, the policy stays and keeps describing who owns a row
--      (080:101 alongside profiles_update_own at 080:189). An empty policy list
--      on an RLS-enabled table reads to the next auditor as "nobody considered
--      writes here", which is the ambiguity that let this hole live since 007.
--
-- The residual is handled where it can actually be caught: the companion check
-- for this migration asserts the ACL itself via has_table_privilege(), not just
-- the policy list. A future GRANT is a test failure, not a silent regression.
--
-- ── What this file deliberately does NOT do ────────────────────────────────
-- It does not delete or un-earn anything. Every earned row on the database
-- today is either the 019 dev seed or a forgery, but stripping badges and
-- points from live accounts is a destructive data migration, and it is written
-- here by a process that cannot execute a single statement against the
-- database. So the cleanup ships as reconcile_forged_badges(), which defaults
-- to a dry run, is callable only by the service role, and is listed as an
-- explicit post-push step. Nothing is removed until a human looks at the list
-- and asks for it.
--
-- Retry-safe throughout: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS +
-- CREATE, CREATE INDEX IF NOT EXISTS, and REVOKE/GRANT are all idempotent. The
-- backfill at the end converges -- a second run finds the same derived numbers
-- and writes nothing.
-- ============================================================

-- ── 1. The lockdown ─────────────────────────────────────────────────────────
--
-- REVOKE ALL then GRANT back the one privilege the apps use, rather than
-- enumerating what to remove: `GRANT ALL` on a table is SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES and TRIGGER, and an enumeration is a list that
-- silently stops being complete when Postgres adds to it.
--
-- DELETE matters as much as INSERT/UPDATE here even though no DELETE policy
-- exists: RLS is the only thing refusing a delete today, and 080:98-100 is the
-- lesson -- a table grant that only a policy is holding back is one policy edit
-- away from being live.
--
-- Every SECURITY DEFINER function below still writes this table after the
-- revoke, because a definer function runs with its owner's privileges, not the
-- caller's. That is the same mechanism that keeps award_badge_points() (007:43)
-- and record_daily_checkin() (056) working after 080 revoked UPDATE on
-- profiles.
--
-- PUBLIC is named alongside the two roles for the same reason 085:93 names it
-- on functions: a privilege held by PUBLIC is held by every role that exists,
-- so revoking from anon and authenticated by name would leave it in place and
-- has_table_privilege() would still answer true for both. Neither the owner nor
-- service_role is affected -- they hold their access directly.
REVOKE ALL ON public.user_badge_progress FROM PUBLIC, anon, authenticated;

-- The owner SELECT policy has to keep working: grow/badges.tsx:39 and
-- profile/edit.tsx:45 both need in-progress rows for the progress bars, and
-- 086's Phase B asserts the owner still reads all of her own rows. RLS decides
-- WHICH rows; this grant is what lets her ask at all.
GRANT SELECT ON public.user_badge_progress TO authenticated;

-- anon is left with nothing. It could not reach a row anyway once 086 pins
-- every policy to TO authenticated, but that safety would be resting on the
-- policies rather than on the ACL. 086's Phase E already expects either
-- outcome and prints "anon holds no SELECT grant at all" for this one.

-- Same treatment for the catalog. badges carries no user data and 082:116 keeps
-- it readable so the embedded `badges(*)` join works, but points_value is the
-- multiplier every award below is computed from: a member who could write this
-- table would not need to forge a badge row at all, she would just raise the
-- price of one she has already earned. There is no INSERT or UPDATE policy on
-- badges today, so this changes no behaviour -- it moves the refusal from RLS,
-- which one CREATE POLICY undoes, to the ACL, which it does not.
REVOKE ALL ON public.badges FROM anon, authenticated;
GRANT SELECT ON public.badges TO authenticated;

-- The three inherited write policies from 007 are deliberately left in place;
-- see the header. They are re-created with TO authenticated by 086, which
-- lands in the same push.


-- ── 2. Index the FK the derivation walks ────────────────────────────────────
--
-- messages.sender_id has been an unindexed foreign key since 004:33. The two
-- indexes that table has are both keyed on conversation_id (004:67-68), so
-- counting one member's messages is a sequential scan of the hottest table in
-- the app. This is needed by badge_requirement_value() below, and it was
-- already owed: ON DELETE SET NULL means every account deletion scans the whole
-- table too.
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages (sender_id);


-- ── 3. Derivation: the count the server works out for itself ────────────────
--
-- Returns NULL, never 0, for a requirement_type with no server-side source.
-- The two are very different answers -- 0 means "she has none of these yet",
-- NULL means "this database cannot know" -- and conflating them would create
-- progress rows for badges that can never legitimately advance.
--
-- p_cap is the badge's requirement_threshold and bounds the work: every count
-- stops as soon as it has seen enough rows to settle the question, so a member
-- with 40,000 messages costs the same lookup as one with two. It is also what
-- keeps current_value from becoming an activity counter on a publicly readable
-- row (see the header).
--
-- SECURITY DEFINER with no grants at all. It reads another member's friendship,
-- message and speed-date counts, which is not something any client role should
-- be able to ask for one uuid at a time; the only callers are the definer
-- functions below, which run as the owner and therefore hold EXECUTE.
CREATE OR REPLACE FUNCTION public.badge_requirement_value(
  p_user_id         uuid,
  p_requirement_type text,
  p_cap             integer
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_requirement_type

    -- Accepted friendships in either direction. status='blocked' rows are
    -- excluded by the predicate, so blocking someone cannot inflate a count.
    WHEN 'connections' THEN (
      SELECT count(*)::int FROM (
        SELECT 1
        FROM public.friendships f
        WHERE f.status = 'accepted'
          AND (f.requester_id = p_user_id OR f.addressee_id = p_user_id)
        LIMIT GREATEST(COALESCE(p_cap, 1), 1)
      ) capped
    )

    -- Messages she sent. Not messages in her conversations: "Conversation
    -- Starter" is about speaking, and sender_id is the only column that says
    -- who did.
    WHEN 'messages' THEN (
      SELECT count(*)::int FROM (
        SELECT 1
        FROM public.messages m
        WHERE m.sender_id = p_user_id
        LIMIT GREATEST(COALESCE(p_cap, 1), 1)
      ) capped
    )

    WHEN 'community_joins' THEN (
      SELECT count(*)::int FROM (
        SELECT 1
        FROM public.community_members cm
        WHERE cm.user_id = p_user_id
        LIMIT GREATEST(COALESCE(p_cap, 1), 1)
      ) capped
    )

    -- started_at IS NOT NULL is the whole point -- see the header. Written as
    -- the array containment operator rather than `= ANY(...)` so it can use
    -- idx_speed_date_participants, the GIN index 077:115 added for exactly this
    -- access pattern.
    WHEN 'speed_dates' THEN (
      SELECT count(*)::int FROM (
        SELECT 1
        FROM public.speed_date_sessions s
        WHERE s.status = 'completed'
          AND s.started_at IS NOT NULL
          AND s.participant_ids @> ARRAY[p_user_id]
        LIMIT GREATEST(COALESCE(p_cap, 1), 1)
      ) capped
    )

    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.badge_requirement_value(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.badge_requirement_value(uuid, text, integer) IS
  'How far one member actually is toward one requirement_type, counted from the source tables and capped at p_cap. NULL means this requirement_type has no server-side source, which is not the same as 0 and must never be treated as one. Internal: no client role holds EXECUTE.';


-- ── 4. The award path ───────────────────────────────────────────────────────
--
-- Recomputes and, where the threshold is met, awards. Idempotent in both
-- halves:
--
--   current_value is written by an upsert whose DO UPDATE is skipped when the
--   value has not moved, so a re-sync of an unchanged member writes no rows at
--   all -- no dead tuples on a path a trigger fires.
--
--   earned_at is set by a SEPARATE UPDATE guarded on `earned_at IS NULL`. Two
--   statements rather than one because trg_award_badge_points is AFTER UPDATE
--   (007:58) and reads OLD: an INSERT that already carries earned_at awards no
--   points, and an UPDATE that re-sets an already-set earned_at is refused by
--   the trigger's own guard (007:48). Awarding twice therefore cannot
--   double-count and cannot move the timestamp -- the WHERE clause stops the
--   second write before the trigger is even reached.
--
-- current_value is OVERWRITTEN with the derived number rather than merged with
-- GREATEST, so a value a member wrote for herself before this migration does
-- not survive the first sync. The one exception is a row that is already
-- earned, which is pinned at its threshold: an earned badge must not start
-- displaying as in-progress because she has since left the community that
-- earned it. Awards are monotonic -- nothing here ever un-earns a badge. The
-- cleanup of rows that were never earned in the first place is section 7, and
-- it is opt-in.
CREATE OR REPLACE FUNCTION public._sync_badges_for(
  p_user_id          uuid,
  p_requirement_type text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b        record;
  v_value  integer;
  v_hit    integer;
  v_earned integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- user_badge_progress.user_id is NOT NULL REFERENCES profiles (007:19), so
  -- this only turns a foreign-key violation into a quiet no-op -- but the
  -- callers include a trigger that must never abort the write it observed.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN 0;
  END IF;

  FOR b IN
    SELECT id, requirement_type, requirement_threshold
    FROM public.badges
    WHERE p_requirement_type IS NULL
       OR requirement_type = p_requirement_type
    ORDER BY id
  LOOP
    v_value := public.badge_requirement_value(
                 p_user_id, b.requirement_type, b.requirement_threshold);

    -- No server-side source. No row, no award, no trace -- an empty progress
    -- row for an uncomputable badge is a permanent 0% bar with no way to move.
    CONTINUE WHEN v_value IS NULL;

    -- The GREATEST expression is spelled out twice on purpose -- once in the
    -- SET and once in the WHERE. They must be the same expression or the guard
    -- stops matching what the write does, so they are kept adjacent rather than
    -- hoisted somewhere they can drift apart.
    INSERT INTO public.user_badge_progress AS ubp
      (user_id, badge_id, current_value, earned_at)
    VALUES
      (p_user_id, b.id, v_value, NULL)
    ON CONFLICT (user_id, badge_id) DO UPDATE
      SET current_value = GREATEST(
            EXCLUDED.current_value,
            CASE WHEN ubp.earned_at IS NOT NULL THEN b.requirement_threshold ELSE 0 END)
      WHERE ubp.current_value IS DISTINCT FROM GREATEST(
            EXCLUDED.current_value,
            CASE WHEN ubp.earned_at IS NOT NULL THEN b.requirement_threshold ELSE 0 END);

    -- The award. Re-reads current_value from the row rather than trusting
    -- v_value, so the threshold test is made against what is actually stored.
    UPDATE public.user_badge_progress
       SET earned_at = now()
     WHERE user_id  = p_user_id
       AND badge_id = b.id
       AND earned_at IS NULL
       AND current_value >= b.requirement_threshold;

    GET DIAGNOSTICS v_hit = ROW_COUNT;
    v_earned := v_earned + v_hit;
  END LOOP;

  RETURN v_earned;
END;
$$;

REVOKE ALL ON FUNCTION public._sync_badges_for(uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._sync_badges_for(uuid, text) IS
  'Recomputes one member''s badge progress from the source tables and awards any badge whose threshold is met. Returns how many were newly earned. Idempotent: re-running writes nothing and never moves earned_at. Internal -- it takes a user id, so no client role holds EXECUTE; members go through sync_my_badges().';


-- ── 5. The member-facing entry point ────────────────────────────────────────
--
-- Deliberately parameterless. The identity is auth.uid() and the numbers come
-- from the source tables, so there is no field in the request a caller could
-- lie in: hammering this only recomputes the truth about herself. That is the
-- same shape 077 chose for speed_date_queue_heartbeat() and
-- leave_speed_date_queue(), for the same stated reason -- "called straight from
-- the client, so identity is auth.uid() and never an argument" (077:271-272).
--
-- It exists because only one of the four badges is wired to a trigger (section
-- 6). This is the surface a badges screen can call on mount to pick up the
-- other three without putting a trigger on the messages table.
CREATE OR REPLACE FUNCTION public.sync_my_badges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN public._sync_badges_for(v_user_id, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_my_badges() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_my_badges() TO authenticated;

COMMENT ON FUNCTION public.sync_my_badges() IS
  'Recomputes the CALLER''s badge progress and awards anything now earned; returns how many were newly earned. Takes no arguments by design -- identity is auth.uid() and every count is derived server-side, so there is nothing in the call a client could falsify.';


-- ── 6. One real earn event, wired at the source ─────────────────────────────
--
-- community_members AFTER INSERT -> "Community Builder" (007:69, threshold 1).
--
-- Chosen as the cheapest of the four genuine sources. Joining a community is
-- among the rarest writes a member makes -- a handful over an account's life,
-- against hundreds of messages -- so the recompute rides a cold path; the table
-- already carries an AFTER INSERT row trigger (003:76), so the cost shape is
-- established rather than novel; and at threshold 1 it fires for every real
-- member on her first join, which makes the whole chain observable in
-- production rather than only in a test.
--
-- A trigger and not a client call: the client is not consulted about whether
-- the join happened, so there is nothing for it to get wrong or lie about. The
-- other three requirement_types are deliberately NOT triggered here --
-- messages.INSERT is the hottest write path in the app and does not get a
-- recompute hung off it for a threshold-1 badge, and speed_dates has no
-- completion writer that runs on the database. Both reach members through
-- sync_my_badges(). Promote either to a trigger when its badge catalog grows
-- past a one-off threshold, not before.
--
-- SECURITY DEFINER is required, not decorative: a trigger function runs as the
-- role that performed the write, which here is `authenticated`, and section 4
-- revoked EXECUTE on _sync_badges_for from that role. As SECURITY INVOKER this
-- would raise 42501, be swallowed by the handler below, and silently never
-- award anything.
--
-- The handler swallows everything for the reason 057:75 does: a badge is a
-- reward for an action, and it must never be able to roll that action back. A
-- woman joining a community must not be told the join failed because a
-- gamification counter did.
CREATE OR REPLACE FUNCTION public.badges_on_community_join()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._sync_badges_for(NEW.user_id, 'community_joins');
  RETURN NULL;  -- AFTER FOR EACH ROW: the return value is ignored (003:72)
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_badges_on_community_join ON public.community_members;
CREATE TRIGGER trg_badges_on_community_join
  AFTER INSERT ON public.community_members
  FOR EACH ROW EXECUTE FUNCTION public.badges_on_community_join();

COMMENT ON FUNCTION public.badges_on_community_join() IS
  'Awards community_joins badges when a member joins a community. Swallows its own errors so a gamification failure can never roll back the join that earned it.';


-- ── 7. Cleanup of pre-087 rows, opt-in and dry by default ───────────────────
--
-- Every earned row on this database predates any legitimate awarder, so each
-- one is either the 019 dev seed or a forgery. That makes them exactly the rows
-- 086 would publish, and it is the reason 086 has been held back.
--
-- It is still not something this migration does on its own. Removing badges and
-- points from live accounts is a destructive data change, and this file cannot
-- be executed anywhere before it is pushed. So the cleanup is a function with
-- p_dry_run defaulting to true: it reports first, and only changes anything
-- when a human asks it to a second time.
--
-- The test is the live derivation, not the stored current_value, and that is
-- load-bearing twice over. A member who forged the counter as well as the
-- timestamp would otherwise clear her own audit -- and section 4's pin actively
-- raises current_value to the threshold on any row that is already earned, so
-- after the backfill the stored counter no longer distinguishes a real badge
-- from a forged one at all. Only the source tables do.
--
-- Rows whose requirement_type has no server-side source are never touched: the
-- function cannot prove those either way and does not guess.
--
-- Points are refunded floored at 0 because gamification_points is also written
-- by the dev seeds (011:100, 049:42, 051:40) with arbitrary starting values,
-- so a subtraction is not guaranteed to land on a number this system put there.
-- It is not recomputed from scratch for the same reason.
CREATE OR REPLACE FUNCTION public.reconcile_forged_badges(p_dry_run boolean DEFAULT true)
RETURNS TABLE (
  member_id    uuid,
  badge        uuid,
  badge_name   text,
  earned       timestamptz,
  derived      integer,
  threshold    integer,
  points_delta integer,
  action       text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      ubp.user_id,
      ubp.badge_id,
      b.name          AS b_name,
      ubp.earned_at,
      b.points_value,
      b.requirement_threshold AS b_threshold,
      public.badge_requirement_value(
        ubp.user_id, b.requirement_type, b.requirement_threshold) AS b_derived
    FROM public.user_badge_progress ubp
    JOIN public.badges b ON b.id = ubp.badge_id
    WHERE ubp.earned_at IS NOT NULL
    ORDER BY ubp.user_id, b.name
  LOOP
    -- No server-side source: unprovable in both directions, so left alone.
    CONTINUE WHEN r.b_derived IS NULL;
    -- Genuinely earned. Nothing to do.
    CONTINUE WHEN r.b_derived >= r.b_threshold;

    IF NOT p_dry_run THEN
      UPDATE public.user_badge_progress
         SET earned_at = NULL
       WHERE user_id = r.user_id AND badge_id = r.badge_id;

      UPDATE public.profiles
         SET gamification_points = GREATEST(gamification_points - r.points_value, 0)
       WHERE id = r.user_id;
    END IF;

    member_id    := r.user_id;
    badge        := r.badge_id;
    badge_name   := r.b_name;
    earned       := r.earned_at;
    derived      := r.b_derived;
    threshold    := r.b_threshold;
    points_delta := -r.points_value;
    action       := CASE WHEN p_dry_run THEN 'would_revoke' ELSE 'revoked' END;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_forged_badges(boolean)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.reconcile_forged_badges(boolean) IS
  'Lists every earned badge row whose derived progress does not meet its threshold -- i.e. every badge nobody could have earned. Dry run by default; pass false to clear earned_at and refund the points. Operator tool: no client role holds EXECUTE. Rows whose requirement_type has no server-side source are never touched.';


-- ── 8. Backfill ─────────────────────────────────────────────────────────────
--
-- Non-destructive by construction: _sync_badges_for only ever writes a derived
-- current_value and only ever sets earned_at on a row that has met its
-- threshold. Nobody loses anything here; members who already did the work get
-- what they earned, which is what makes 086 worth shipping.
--
-- Every profile, not just active ones: 086 hides an inactive member's badges
-- from other members anyway, but she still reads her own (ubp_owner_select),
-- and a reactivated account should not come back with an empty Grow tab.
--
-- Costed rather than assumed: four badges per member, each one index probe
-- bounded by LIMIT 1 (every threshold in the catalog is 1), against
-- idx_friendships_requester/addressee, idx_messages_sender (section 2),
-- idx_cm_user and idx_speed_date_participants. Rows only get written where a
-- number actually changes.
DO $$
DECLARE
  r         record;
  v_awarded integer := 0;
  v_users   integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.profiles ORDER BY created_at LOOP
    v_awarded := v_awarded + public._sync_badges_for(r.id, NULL);
    v_users   := v_users + 1;
  END LOOP;

  RAISE NOTICE '087 backfill: % profiles synced, % badges newly awarded', v_users, v_awarded;
END;
$$;


-- ── 9. The rule, where the next reader will find it ─────────────────────────
--
-- Replaces the COMMENT 086 set. 086 asked whoever shipped the awarder to decide
-- what happens to the column-visibility residual; the decision is the LIMIT cap
-- in section 3, so the note now records a closed question instead of an open
-- one. Everything 086 said about the two-audience read is carried over
-- verbatim in substance, because all of it is still true.
COMMENT ON TABLE public.user_badge_progress IS
  'Server-authoritative (087). This table is not writable by any client role -- INSERT/UPDATE/DELETE were revoked from anon and authenticated, and the only writers are the SECURITY DEFINER functions _sync_badges_for() and reconcile_forged_badges(). Progress is DERIVED from the source tables by badge_requirement_value(); never accept a count, a threshold or an earned_at from a caller. The ubp_owner_insert/ubp_owner_update policies survive as documentation of row ownership behind that revoke -- restoring the table grant re-opens badge forgery regardless of what they say, and supabase/tests/087_server_authoritative_badges_check.sql asserts the ACL for that reason. Two-audience read (086): ubp_owner_select gives a member every row of her own including in-progress ones; ubp_earned_public_select gives approved members the earned rows (earned_at IS NOT NULL) of visible profiles only. Any new SELECT policy here must keep BOTH halves of that split and must carry TO authenticated -- policies are OR''d, so one permissive sibling without a TO clause republishes in-progress rows to the shipped anon key. RLS cannot hide a COLUMN, so current_value rides along on every earned row; 086 flagged that as a tripwire for the day an awarder shipped, and 087 closes it at the source instead of behind a view -- every count is taken through LIMIT requirement_threshold, so current_value can never exceed the threshold and an earned row states nothing the badge does not. Any new derivation added to badge_requirement_value() MUST keep that cap.';
