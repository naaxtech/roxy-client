-- ============================================================
-- 094_report_live_surfaces.sql
--
-- A woman could not report anyone from inside a live room or a video date.
--
-- `store/safetyStore.ts` types reportTarget.contentType as
-- 'message' | 'post' | 'profile' | 'room' | 'speed_date', widened when the live
-- surfaces got report buttons, with a comment asking a later session to widen
-- the edge function to match. Neither the edge function nor the database was
-- ever widened: 008_safety.sql constrains reports.content_type to
-- ('message','post','profile'), and submit-report passes the client's value
-- straight into the insert. So the report failed on a CHECK violation.
--
-- On a WLW dating app the report button is what she reaches for when a call
-- turns threatening, and this is the second time a control on that exact path
-- has been decorative — 085 fixed the first, `block_user`, which had never
-- existed at all.
--
-- WHY THE TWO NEW VALUES ARE SEPARATE, and not folded into 'profile'.
--    Reporting a video date as though it were a profile throws away the one
--    detail a moderator needs to find it: which session, at what time. A report
--    a moderator cannot act on is a report that did not happen, which is worse
--    than no button, because she stops looking for another way to be heard.
--    content_id already carries the session id; this lets it mean something.
--
-- The drift that caused this is now held closed by
-- apps/mobile/__tests__/lib/reportContentTypes.test.ts, which reads this CHECK
-- and the edge function's allowlist off disk and fails when either disagrees
-- with the client. A comment asking a future session to remember was not a
-- mechanism.
-- ============================================================

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_content_type_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_content_type_check
  CHECK (content_type IN ('message', 'post', 'profile', 'room', 'speed_date'));

COMMENT ON COLUMN public.reports.content_type IS
  'Where the reported thing happened. room and speed_date keep the session identifiable, which is the difference between a report a moderator can act on and one they cannot.';
