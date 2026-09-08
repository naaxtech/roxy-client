-- ============================================================
-- 096_archive_rls.sql
--
-- RLS is the feature here, not a wrapper around it.
--
-- The Archive is the one part of Roxy a PENDING member can use. 079's
-- postmortem is what that is for: a new signup landed on
-- vetting_status='pending', every gate helper returned false, and she was
-- locked out of the entire app with no screen explaining why. So the read
-- policies below are deliberately `TO authenticated` and deliberately do NOT
-- call `is_approved_member()` / `can_read_community_content()` — using the
-- ordinary helpers here would silently re-lock the exact door this feature
-- exists to open.
--
-- The split, stated once so no policy below has to re-argue it:
--
--   ANY authenticated profile, pending included:
--     read published entries · read published reviews · read visible notes ·
--     cast and change her own vote · keep her own watchlist
--
--   `is_approved_member()` only — that is vetting_status IN
--   ('approved','unvetted'), the 072 predicate, INCLUDING the grandfathered
--   population on purpose:
--     write a review · agree a content note · add a note · submit an entry or
--     an edit
--
-- Entries themselves have no INSERT or UPDATE policy for `authenticated` at
-- all. Every write to a published row goes through an edge function on the
-- service role, because a member-maintained catalogue where members can write
-- directly to the catalogue is not moderated, whatever the UI says.
--
-- WHY A VOTE IS READABLE ONLY BY ITS OWNER.
--   The score is public; who voted which way is not. On a wlw app, "she
--   recommends this" is inference about a stranger from her taste, and the
--   aggregate is already carried by the denormalized counts on the entry, so
--   nothing needs the individual rows. SELECT is scoped to auth.uid().
-- ============================================================

ALTER TABLE public.archive_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_votes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_reviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_review_helpful  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_content_notes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_note_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_watchlist       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_revisions       ENABLE ROW LEVEL SECURITY;

-- ── Entries ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "archive_entries_select_published" ON public.archive_entries;
CREATE POLICY "archive_entries_select_published" ON public.archive_entries
  FOR SELECT TO authenticated
  USING (status = 'published' OR public.is_roxy_staff());

-- No INSERT/UPDATE/DELETE policy for authenticated, on purpose. See the header.

-- ── Votes ───────────────────────────────────────────────────────────────────
-- Pending included: scoring is the thing she can do while she waits, and the
-- product rule is that the score she casts while pending counts and stays.

DROP POLICY IF EXISTS "archive_votes_select_own" ON public.archive_votes;
CREATE POLICY "archive_votes_select_own" ON public.archive_votes
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "archive_votes_insert_own" ON public.archive_votes;
CREATE POLICY "archive_votes_insert_own" ON public.archive_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    -- She may only score something she can actually see.
    AND EXISTS (
      SELECT 1 FROM public.archive_entries e
      WHERE e.id = entry_id AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "archive_votes_update_own" ON public.archive_votes;
CREATE POLICY "archive_votes_update_own" ON public.archive_votes
  FOR UPDATE TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "archive_votes_delete_own" ON public.archive_votes;
CREATE POLICY "archive_votes_delete_own" ON public.archive_votes
  FOR DELETE TO authenticated
  USING (profile_id = auth.uid());

-- ── Reviews ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "archive_reviews_select_published" ON public.archive_reviews;
CREATE POLICY "archive_reviews_select_published" ON public.archive_reviews
  FOR SELECT TO authenticated
  USING (status = 'published' OR author_id = auth.uid() OR public.is_roxy_staff());

-- The one place the pending/approved line is drawn for writing. `author_id =
-- auth.uid()` is not redundant beside it: without it an approved member could
-- publish a review under another woman's name.
DROP POLICY IF EXISTS "archive_reviews_insert_approved" ON public.archive_reviews;
CREATE POLICY "archive_reviews_insert_approved" ON public.archive_reviews
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.is_approved_member());

DROP POLICY IF EXISTS "archive_reviews_update_own" ON public.archive_reviews;
CREATE POLICY "archive_reviews_update_own" ON public.archive_reviews
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "archive_reviews_delete_own" ON public.archive_reviews;
CREATE POLICY "archive_reviews_delete_own" ON public.archive_reviews
  FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- ── Helpful marks ───────────────────────────────────────────────────────────
-- Own rows only. The visible total lives in reviews.helpful_count.

DROP POLICY IF EXISTS "archive_helpful_select_own" ON public.archive_review_helpful;
CREATE POLICY "archive_helpful_select_own" ON public.archive_review_helpful
  FOR SELECT TO authenticated USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "archive_helpful_insert_own" ON public.archive_review_helpful;
CREATE POLICY "archive_helpful_insert_own" ON public.archive_review_helpful
  FOR INSERT TO authenticated WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "archive_helpful_delete_own" ON public.archive_review_helpful;
CREATE POLICY "archive_helpful_delete_own" ON public.archive_review_helpful
  FOR DELETE TO authenticated USING (profile_id = auth.uid());

-- ── Content notes ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "archive_notes_select_visible" ON public.archive_content_notes;
CREATE POLICY "archive_notes_select_visible" ON public.archive_content_notes
  FOR SELECT TO authenticated
  USING (status = 'visible' OR public.is_roxy_staff());

DROP POLICY IF EXISTS "archive_notes_insert_approved" ON public.archive_content_notes;
CREATE POLICY "archive_notes_insert_approved" ON public.archive_content_notes
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_approved_member());

-- ── Note agreements ─────────────────────────────────────────────────────────
-- Agreeing is a write, so it needs approval; the count it feeds decides what
-- warning a stranger sees before she starts something.

DROP POLICY IF EXISTS "archive_note_agree_select_own" ON public.archive_note_agreements;
CREATE POLICY "archive_note_agree_select_own" ON public.archive_note_agreements
  FOR SELECT TO authenticated USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "archive_note_agree_insert_approved" ON public.archive_note_agreements;
CREATE POLICY "archive_note_agree_insert_approved" ON public.archive_note_agreements
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid() AND public.is_approved_member());

DROP POLICY IF EXISTS "archive_note_agree_delete_own" ON public.archive_note_agreements;
CREATE POLICY "archive_note_agree_delete_own" ON public.archive_note_agreements
  FOR DELETE TO authenticated USING (profile_id = auth.uid());

-- ── Watchlist ───────────────────────────────────────────────────────────────
-- Hers alone, pending included. Nothing else may read it: what a woman means
-- to watch is at least as revealing as what she has watched.

DROP POLICY IF EXISTS "archive_watchlist_select_own" ON public.archive_watchlist;
CREATE POLICY "archive_watchlist_select_own" ON public.archive_watchlist
  FOR SELECT TO authenticated USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "archive_watchlist_insert_own" ON public.archive_watchlist;
CREATE POLICY "archive_watchlist_insert_own" ON public.archive_watchlist
  FOR INSERT TO authenticated WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "archive_watchlist_delete_own" ON public.archive_watchlist;
CREATE POLICY "archive_watchlist_delete_own" ON public.archive_watchlist
  FOR DELETE TO authenticated USING (profile_id = auth.uid());

-- ── Revisions ───────────────────────────────────────────────────────────────
-- She can see what she proposed and what a mod said about it. She cannot see
-- anyone else's queue, and she cannot decide her own — the decision path is an
-- edge function on the service role, and 071 already learned this lesson the
-- hard way when `decide_application` was callable by its own applicant.

DROP POLICY IF EXISTS "archive_revisions_select_own_or_staff" ON public.archive_revisions;
CREATE POLICY "archive_revisions_select_own_or_staff" ON public.archive_revisions
  FOR SELECT TO authenticated
  USING (submitted_by = auth.uid() OR public.is_roxy_staff());

DROP POLICY IF EXISTS "archive_revisions_insert_approved" ON public.archive_revisions;
CREATE POLICY "archive_revisions_insert_approved" ON public.archive_revisions
  FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = auth.uid()
    AND public.is_approved_member()
    -- A member proposes; she does not decide. Anything but a fresh pending row
    -- is a decision, and decisions belong to the staff function.
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );
