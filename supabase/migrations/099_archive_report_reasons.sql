-- ============================================================
-- 099_archive_report_reasons.sql
--
-- Widens reports.reason for the WLW Archive, the same way 094 widened
-- reports.content_type for the live surfaces.
--
-- `submit-report/index.ts` required only that `reason` be truthy and then
-- passed it straight into the insert -- an unrecognised value became an
-- opaque 23514 CHECK violation instead of a clear 400. That is the exact bug
-- 094's header describes for content_type, just on the other column, and it
-- was never fixed here because the Archive did not exist yet to need it.
--
-- ── THE THREE NEW REASONS, and why they are not folded into 'other' ─────────
--   archive_spoiler       -- a review or summary broke the one Archive rule:
--                             no endings, ever (095's header, enforced by
--                             archive_reviews.no_spoilers_ack at write time and
--                             still reportable after the fact).
--   archive_bad_entry     -- wrong title, wrong year, wrong everything -- a
--                             catalogue error, not a behaviour problem.
--   archive_review_abuse  -- targets the review/revision process itself: a
--                             pile-on report to get a review pulled, or a
--                             revision proposed in bad faith.
--   Folding these into 'other' would leave a moderator with no way to tell
--   "this needs a content fix" from "this needs a person warned" without
--   opening every single 'other' report to find out.
--
-- `apps/mobile/__tests__/lib/archiveReportReasons.test.ts` reads this CHECK
-- and submit-report's REPORT_REASONS allowlist off disk and fails the moment
-- either drifts from the other -- the same mechanism 094 built for
-- content_type, because a comment asking a future session to remember is not
-- one.
-- ============================================================

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_reason_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_reason_check
  CHECK (reason IN (
    'harassment',
    'spam',
    'inappropriate',
    'hate_speech',
    'other',
    'archive_spoiler',
    'archive_bad_entry',
    'archive_review_abuse'
  ));

COMMENT ON COLUMN public.reports.reason IS
  'Why this was reported. The three archive_* values are WLW Archive-specific: archive_spoiler (broke the no-endings rule), archive_bad_entry (catalogue error), archive_review_abuse (targets the review/revision process itself). Kept in step with submit-report''s REPORT_REASONS allowlist by apps/mobile/__tests__/lib/archiveReportReasons.test.ts.';
