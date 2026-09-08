-- ============================================================
-- 100_archive_moderation_contract.sql
--
-- The Archive's moderation loop could be opened but not closed. Four gaps,
-- each found by building the screen that needed it:
--
--   1. Nothing could FILE an archive report. reports.content_type has no
--      archive member, so the report button on an entry or a review would die
--      on the CHECK — the same bug 094 fixed for room/speed_date, in the same
--      place, four migrations later.
--
--   2. No mod could READ a report. `reports` has carried exactly one SELECT
--      policy since 008 — reporter_id = auth.uid() — so the staff queue reads
--      zero rows for every report ever filed. The screen does not error; it
--      renders empty, which tells a moderator there is nothing to do. On a
--      safety product that is the most expensive possible lie, and it is the
--      failure mode the queue exists to prevent.
--
--   3. No mod could ACT. archive_entries and archive_reviews have no staff
--      UPDATE policy (096 gave them none deliberately — writes were meant to go
--      through edge functions), so hide-entry and remove-review had nothing to
--      call. Granting a narrow staff UPDATE is better here than a fourth
--      service-role function: the action is a single column on a single row, and
--      RLS can express "staff only" exactly.
--
--   4. Revert had no state to move to. archive_revision_status is
--      ('pending','approved','rejected') — an applied revision that a mod undoes
--      is none of those, and reusing 'rejected' would erase the fact that it was
--      once live.
--
-- WHY STAFF UPDATE AND NOT SERVICE ROLE, for 3.
--   The studio reads through the same RLS-bound client as every other staff
--   page. A service-role workaround in one screen means that screen is no
--   longer subject to the policy everything else is checked against, and the
--   next person to copy it inherits that.
--
--   CORRECTION (2026-09-05, migration 106). The sentence that stood here said
--   "The policies below are scoped to the exact columns a moderator touches."
--   That was false, and in a way worth spelling out: RLS chooses ROWS and never
--   columns — the whole lesson of migration 101 — so a policy cannot scope a
--   column at all. archive_entries in fact carried a table-WIDE update grant,
--   and archive_reviews had no grant on `status`, so remove-review returned
--   42501 for every moderator from the day this shipped. 106 narrows the one
--   grant and adds the other.
-- ============================================================

-- ── 1. Archive reports can be filed ─────────────────────────────────────────

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_content_type_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_content_type_check
  CHECK (content_type IN (
    'message', 'post', 'profile', 'room', 'speed_date',
    'archive_entry', 'archive_review'
  ));

COMMENT ON COLUMN public.reports.content_type IS
  'Where the reported thing happened. archive_entry / archive_review keep an Archive report actionable — content_id is the entry or review id.';


-- ── 2. Staff can read the queue ─────────────────────────────────────────────
-- Shape copied from 043_staff_product_select, but through is_roxy_staff()
-- (070) rather than an inline EXISTS — 043 predates the helper, and a second
-- hand-rolled staff predicate is a second thing to get wrong.

DROP POLICY IF EXISTS "reports_select_staff" ON public.reports;
CREATE POLICY "reports_select_staff" ON public.reports
  FOR SELECT TO authenticated
  USING (public.is_roxy_staff());

-- Resolving a report is an UPDATE of its status. Without this the queue can
-- read a report and never close it, which fills the screen with work that
-- cannot be finished.
DROP POLICY IF EXISTS "reports_update_staff" ON public.reports;
CREATE POLICY "reports_update_staff" ON public.reports
  FOR UPDATE TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff());


-- ── 3. Staff can hide an entry and remove a review ──────────────────────────

DROP POLICY IF EXISTS "archive_entries_update_staff" ON public.archive_entries;
CREATE POLICY "archive_entries_update_staff" ON public.archive_entries
  FOR UPDATE TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff());

DROP POLICY IF EXISTS "archive_reviews_update_staff" ON public.archive_reviews;
CREATE POLICY "archive_reviews_update_staff" ON public.archive_reviews
  FOR UPDATE TO authenticated
  USING (public.is_roxy_staff())
  WITH CHECK (public.is_roxy_staff());


-- ── 4. A revision can be reverted ───────────────────────────────────────────
-- 'reverted' is its own state rather than a reuse of 'rejected': a revision
-- that was applied and then undone is a different history from one that was
-- never applied, and the revision log is the Archive's audit trail.

DO $$ BEGIN
  ALTER TYPE public.archive_revision_status ADD VALUE IF NOT EXISTS 'reverted';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TYPE public.archive_revision_status IS
  'pending → approved | rejected. approved → reverted when a mod undoes an applied revision; the row keeps its history rather than being re-marked rejected.';
