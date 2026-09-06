-- ============================================================
-- 079_restore_vetting_default.sql
--
-- URGENT REVERT of one line in 072.
--
-- 072 set profiles.vetting_status DEFAULT 'pending'. That is correct for the
-- finished invite gate: a new account should read nothing until a human
-- approves it.
--
-- It is wrong TODAY, because the migrations are applied to production and the
-- app build is not. Everyone in production is running a binary with no code
-- entry screen, no application flow, and no pending screen. So:
--
--   1. someone signs up on the live app
--   2. her profile row is created with vetting_status = 'pending'
--   3. is_approved_member() -> false
--   4. is_community_member() and can_read_community_content() -> false
--   5. posts_select, posts_insert, comments_select, events_select all deny
--
-- She is locked out of the entire app with no screen to explain it, and the
-- client shows whatever generic error each surface happens to have. Existing
-- accounts are unaffected -- 070 backfilled them to 'unvetted', which the
-- predicate accepts.
--
-- This restores the permissive default so the live app keeps working. It does
-- NOT undo the gate: every table, policy, function and RPC from 070-074 stays
-- exactly as it is, and create_membership_application() still sets 'pending'
-- explicitly for anyone who comes through the real code flow.
--
-- RE-APPLY THE STRICT DEFAULT the same day the gated app build ships:
--
--   ALTER TABLE public.profiles ALTER COLUMN vetting_status SET DEFAULT 'pending';
--
-- Until then the DB must not enforce a gate the UI cannot explain.
-- ============================================================

ALTER TABLE public.profiles ALTER COLUMN vetting_status SET DEFAULT 'unvetted';

-- Repair anyone already caught. Scoped deliberately narrowly: only accounts
-- that are 'pending' but never actually started an application -- i.e. they
-- were caught by the default, not by the gate. A genuine applicant who is
-- mid-review has a membership_applications row and is left alone.
UPDATE public.profiles p
SET vetting_status = 'unvetted'
WHERE p.vetting_status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.membership_applications a
    WHERE a.auth_user_id = p.id
  );
