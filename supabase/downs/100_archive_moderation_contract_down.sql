-- ============================================================
-- 100_archive_moderation_contract_down.sql
--
-- NOTE on the enum: Postgres cannot remove a value from an enum type. If any
-- archive_revisions row already holds 'reverted', that value must stay — and
-- rewriting those rows to 'rejected' to allow a clean rollback would falsify
-- the audit trail this feature exists to keep. So the down leaves the enum
-- value in place, deliberately, and says so rather than pretending the
-- rollback is total.
--
-- Rolling back the reports CHECK will FAIL if any archive report has been
-- filed. That is correct: the alternative is deleting a woman's report to make
-- a rollback succeed.
-- ============================================================

DROP POLICY IF EXISTS "archive_reviews_update_staff" ON public.archive_reviews;
DROP POLICY IF EXISTS "archive_entries_update_staff" ON public.archive_entries;
DROP POLICY IF EXISTS "reports_update_staff" ON public.reports;
DROP POLICY IF EXISTS "reports_select_staff" ON public.reports;

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_content_type_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_content_type_check
  CHECK (content_type IN ('message', 'post', 'profile', 'room', 'speed_date'));
