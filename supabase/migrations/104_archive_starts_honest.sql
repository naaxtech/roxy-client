-- ============================================================
-- 104_archive_starts_honest.sql
--
-- Remove every vote and review no real person cast.
--
-- 098 seeded 28,972 votes and 21 reviews, gated on the dev-seed profiles
-- existing so that a production database would never see them. This database
-- HAS those profiles (alex@roxy.dev and friends, created 2026-03-28), so the
-- guard did not fire and the Archive has been showing fabricated consensus to
-- anyone who opened it. Portrait of a Lady on Fire read "95% of 1,489 members
-- recommend it". Not one of them existed.
--
-- The seed reviews are worse than the numbers. They are written in the first
-- person — "I have watched it four times" — under ordinary display names, so
-- they are indistinguishable from a real member's words. A number can be
-- discounted once you know; a fabricated testimonial cannot.
--
-- WHAT STAYS. The catalogue: 45 real works, their creators, years, spoiler-free
-- summaries, cover gradients and 95 content notes. That is the part that took
-- research and the part that is true. An Archive of 45 titles nobody has rated
-- yet is a catalogue waiting for its community; an Archive of 45 titles with
-- invented ratings is a lie about one.
--
-- WHY BASELINES RATHER THAN A DELETE. archive_votes is empty — every one of
-- those 28,972 was baseline weight, never a row. Zeroing the baseline is
-- therefore the whole operation, and 097's trigger recomputes vote_count as
-- baseline + real on the next write, so this cannot drift back.
--
-- Reversible in the sense that matters: 098 is still in the repo and can be
-- re-run against a dev database. It is deliberately NOT reversible here — the
-- down file refuses, because restoring fabricated consensus to a live product
-- is not a rollback anyone should be able to perform by accident.
-- ============================================================

-- ── The votes nobody cast ───────────────────────────────────────────────────

UPDATE public.archive_entries
SET baseline_vote_count = 0,
    baseline_up_count   = 0,
    vote_count = (
      SELECT count(*) FROM public.archive_votes v WHERE v.entry_id = archive_entries.id
    ),
    up_count = (
      SELECT count(*) FROM public.archive_votes v WHERE v.entry_id = archive_entries.id AND v.value
    ),
    updated_at = now()
WHERE baseline_vote_count > 0 OR baseline_up_count > 0;

-- ── The reviews nobody wrote ────────────────────────────────────────────────
-- Scoped to the four dev-seed accounts by username, exactly as 098 chose them.
-- A review written by anyone else is a real member's and is not touched.

DELETE FROM public.archive_reviews
WHERE author_id IN (
  SELECT id FROM public.profiles
  WHERE username IN ('alex_wlw', 'jamie_star', 'river_sky', 'morgan_jay')
);

-- review_count is trigger-maintained on write; the DELETE above fires it per
-- row. This recomputes anyway, because a count left stale here would show a
-- review tab with nothing in it.
UPDATE public.archive_entries e
SET review_count = (
  SELECT count(*) FROM public.archive_reviews r
  WHERE r.entry_id = e.id AND r.status = 'published'
);

COMMENT ON COLUMN public.archive_entries.baseline_vote_count IS
  'Seeded demo weight, added to real votes by the 097 trigger. Zeroed on this database by 104 — it was showing 28,972 votes no member had cast. Set it again only on a database no real member can reach.';
