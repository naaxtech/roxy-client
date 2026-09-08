-- ============================================================
-- 101_review_findings.sql
--
-- Three defects a review of the LIVE database found, all of them in migrations
-- already applied to production. Each was verified against
-- ptymtdlysqbpxzlgsshp before this file was written.
--
-- ── 1. "Who can message me" cannot be saved by anyone ───────────────────────
--    093 added profiles.dm_permission and granted EXECUTE on all four of its
--    new functions — and never granted UPDATE on the column. `authenticated`
--    holds column-scoped UPDATE on 15 columns of profiles; this was not one of
--    them, so every attempt returned 42501 and the woman saw "Not saved". The
--    privacy control the whole of 093 exists to build has been unreachable
--    since the day it shipped. Confirmed by the data: all 21 production
--    profiles still read 'everyone', because none of them could ever change it.
--
--    has_column_privilege('authenticated','public.profiles','dm_permission','UPDATE')
--      → false, before this migration.
--
-- ── 2. A member could set her own review's "helpful" count ──────────────────
--    096's archive_reviews_update_own restricts the ROW (author_id = auth.uid())
--    but `authenticated` holds table-wide UPDATE, and RLS chooses rows, never
--    columns. So a PATCH could set helpful_count to any value >= 0, and the
--    097 trigger only recomputes on archive_review_helpful writes — it never
--    corrects a hand-set number. lib/archive.ts orders reviews by
--    helpful_count DESC LIMIT 20, so she could own the top slot on any entry
--    and push genuine reviews out of the window, under a count she wrote
--    herself. There is no UI to mark a review helpful at all, so any non-zero
--    value in that column today is by definition manipulation.
--
--    Same grant let her move a review between entries by rewriting entry_id.
--
-- ── 3. Reverting a published entry always failed ────────────────────────────
--    staff-review-archive-revision's revert branch sets status='hidden' and
--    leaves published_at alone, which violates archive_published_has_date:
--      CHECK ((status = 'published') = (published_at IS NOT NULL))
--    A moderator pulling back a published entry that turned out to be abusive
--    got a 500 and the entry stayed live. The function is fixed alongside this
--    migration; the constraint is correct and stays.
-- ============================================================

-- ── 1. Let her save the setting ─────────────────────────────────────────────
-- Column-scoped, matching how the other 15 writable profile columns are
-- granted. A table-wide GRANT here would also hand her vetting_status and
-- is_staff, which is how a member promotes herself.

GRANT UPDATE (dm_permission) ON public.profiles TO authenticated;


-- ── 2. Take back the columns a review's author must not write ───────────────
-- RLS chooses rows; column privileges choose columns. Both are needed, and 096
-- only had the first half.
--
-- Revoking the table-wide grant and re-granting the three columns she legitimately
-- edits: her own words, her own recommendation, and the acknowledgement the
-- CHECK already forces to true.

REVOKE UPDATE ON public.archive_reviews FROM authenticated;
GRANT UPDATE (body, is_recommend, no_spoilers_ack, updated_at)
  ON public.archive_reviews TO authenticated;

-- Same shape for votes: she may change her mind about `value`, and nothing
-- else. Moving a vote to another entry left the old entry's denormalized count
-- pointing at a row that had left it, because 097 only recomputes the entry
-- named in NEW.
REVOKE UPDATE ON public.archive_votes FROM authenticated;
GRANT UPDATE (value, updated_at) ON public.archive_votes TO authenticated;

COMMENT ON COLUMN public.archive_reviews.helpful_count IS
  'Trigger-maintained from archive_review_helpful. NOT writable by the author — 096 restricted the row and left the column open, which let her set her own review''s helpful count and take the top slot on any entry.';
