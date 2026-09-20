-- ============================================================
-- 096_archive_rls_down.sql
--
-- Drops the Archive policies and disables RLS on its tables.
--
-- Running this ALONE leaves eight tables with RLS off and no policies, which is
-- open season on every review, vote and watchlist in the database. It is only
-- correct immediately before 095's down drops the tables entirely.
-- ============================================================

DROP POLICY IF EXISTS "archive_revisions_insert_approved" ON public.archive_revisions;
DROP POLICY IF EXISTS "archive_revisions_select_own_or_staff" ON public.archive_revisions;
DROP POLICY IF EXISTS "archive_watchlist_delete_own" ON public.archive_watchlist;
DROP POLICY IF EXISTS "archive_watchlist_insert_own" ON public.archive_watchlist;
DROP POLICY IF EXISTS "archive_watchlist_select_own" ON public.archive_watchlist;
DROP POLICY IF EXISTS "archive_note_agree_delete_own" ON public.archive_note_agreements;
DROP POLICY IF EXISTS "archive_note_agree_insert_approved" ON public.archive_note_agreements;
DROP POLICY IF EXISTS "archive_note_agree_select_own" ON public.archive_note_agreements;
DROP POLICY IF EXISTS "archive_notes_insert_approved" ON public.archive_content_notes;
DROP POLICY IF EXISTS "archive_notes_select_visible" ON public.archive_content_notes;
DROP POLICY IF EXISTS "archive_helpful_delete_own" ON public.archive_review_helpful;
DROP POLICY IF EXISTS "archive_helpful_insert_own" ON public.archive_review_helpful;
DROP POLICY IF EXISTS "archive_helpful_select_own" ON public.archive_review_helpful;
DROP POLICY IF EXISTS "archive_reviews_delete_own" ON public.archive_reviews;
DROP POLICY IF EXISTS "archive_reviews_update_own" ON public.archive_reviews;
DROP POLICY IF EXISTS "archive_reviews_insert_approved" ON public.archive_reviews;
DROP POLICY IF EXISTS "archive_reviews_select_published" ON public.archive_reviews;
DROP POLICY IF EXISTS "archive_votes_delete_own" ON public.archive_votes;
DROP POLICY IF EXISTS "archive_votes_update_own" ON public.archive_votes;
DROP POLICY IF EXISTS "archive_votes_insert_own" ON public.archive_votes;
DROP POLICY IF EXISTS "archive_votes_select_own" ON public.archive_votes;
DROP POLICY IF EXISTS "archive_entries_select_published" ON public.archive_entries;

ALTER TABLE public.archive_revisions       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_watchlist       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_note_agreements DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_content_notes   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_review_helpful  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_reviews         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_votes           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_entries         DISABLE ROW LEVEL SECURITY;
