-- ============================================================
-- 099_archive_report_reasons_down.sql
--
-- Restores the narrower CHECK from 008_safety.sql (as widened by 094 --
-- 094 never touched reason, so this is the same five values 008 shipped).
--
-- NOTE: rows already written with reason 'archive_spoiler',
-- 'archive_bad_entry' or 'archive_review_abuse' will make the ADD CONSTRAINT
-- fail. That is deliberate, same as 094_report_live_surfaces_down.sql --
-- silently deleting reports to make a rollback succeed would destroy the only
-- record of an incident. If this down has to run, decide what happens to
-- those rows first.
-- ============================================================

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_reason_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_reason_check
  CHECK (reason IN ('harassment', 'spam', 'inappropriate', 'hate_speech', 'other'));
