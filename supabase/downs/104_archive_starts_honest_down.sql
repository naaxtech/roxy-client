-- ============================================================
-- 104_archive_starts_honest_down.sql
--
-- There is deliberately no rollback.
--
-- Undoing 104 means restoring 28,972 votes and 21 first-person reviews that no
-- member wrote, to a live product real women use. That is not a rollback; it is
-- a decision to show fabricated consensus, and it should never be reachable by
-- running a down migration in a hurry.
--
-- If a dev or staging database needs the demo weight, run 098 against it. It is
-- still in the repo, and its own guard means it only fires where the dev-seed
-- profiles exist.
-- ============================================================

DO $$
BEGIN
  RAISE EXCEPTION
    '104 has no rollback: restoring fabricated votes and reviews to a live Archive is a product decision, not a migration. Re-run 098 against a dev database instead.';
END $$;
