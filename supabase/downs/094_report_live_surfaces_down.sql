-- ============================================================
-- 094_report_live_surfaces_down.sql
--
-- Restores the narrower CHECK from 008_safety.sql.
--
-- NOTE: rows already written with content_type 'room' or 'speed_date' will make
-- the ADD CONSTRAINT fail. That is deliberate — silently deleting reports to
-- make a rollback succeed would destroy the only record of an incident. If this
-- down has to run, decide what happens to those rows first.
-- ============================================================

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_content_type_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_content_type_check
  CHECK (content_type IN ('message', 'post', 'profile'));
