-- ============================================================
-- 097_archive_triggers_down.sql
--
-- Drops the counter and search triggers. The columns they maintain stay (095
-- owns those); after this runs they simply stop being updated, which is why
-- this down is only ever correct as part of unwinding 095-097 together.
-- ============================================================

DROP TRIGGER IF EXISTS archive_entries_tsv ON public.archive_entries;
DROP TRIGGER IF EXISTS archive_note_agree_count ON public.archive_note_agreements;
DROP TRIGGER IF EXISTS archive_helpful_count ON public.archive_review_helpful;
DROP TRIGGER IF EXISTS archive_reviews_count ON public.archive_reviews;
DROP TRIGGER IF EXISTS archive_votes_count ON public.archive_votes;

DROP FUNCTION IF EXISTS public.archive_entries_search_tsv();
DROP FUNCTION IF EXISTS public.archive_refresh_agree_count();
DROP FUNCTION IF EXISTS public.archive_refresh_helpful_count();
DROP FUNCTION IF EXISTS public.archive_refresh_review_count();
DROP FUNCTION IF EXISTS public.archive_refresh_vote_counts();

DROP INDEX IF EXISTS public.idx_archive_entries_search;
