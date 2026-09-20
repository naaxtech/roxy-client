-- ============================================================
-- 101_review_findings_down.sql
--
-- Restores the pre-101 grants. Note what that MEANS before running it: it
-- re-opens archive_reviews.helpful_count and archive_votes.entry_id to their
-- own owner, and makes "Who can message me" unsavable again. This down exists
-- for completeness, not because rolling it back is ever a good idea.
-- ============================================================

REVOKE UPDATE (dm_permission) ON public.profiles FROM authenticated;

REVOKE UPDATE (body, is_recommend, no_spoilers_ack, updated_at)
  ON public.archive_reviews FROM authenticated;
GRANT UPDATE ON public.archive_reviews TO authenticated;

REVOKE UPDATE (value, updated_at) ON public.archive_votes FROM authenticated;
GRANT UPDATE ON public.archive_votes TO authenticated;
