-- ============================================================
-- 097_archive_triggers.sql
--
-- The denormalized counts on archive_entries, and the search vector.
--
-- WHY RECOMPUTE INSTEAD OF INCREMENT.
--   Every counter here is rebuilt with a COUNT over the source table rather
--   than nudged by +1/-1. An increment is one missed edge — an UPDATE that
--   flips a vote, a review moving to 'removed', a CASCADE delete — away from a
--   number that is permanently wrong with nothing to notice it. These counts
--   decide whether an entry shows a score at all, so a drifted vote_count is
--   an entry that either hides a real score or shows one it has not earned.
--   The row is already locked by the write that fired the trigger, so the
--   recompute is correct under concurrency; the tables are small per entry.
--
-- WHY A VOTE TRIGGER HANDLES UPDATE AT ALL.
--   Changing your mind is a first-class action here: the vote card in the
--   prototype toggles, and an UPDATE that flips `value` moves up_count without
--   moving vote_count. A trigger written only for INSERT and DELETE would
--   leave the percentage stale for exactly the members who reconsidered.
-- ============================================================

-- ── Entry counters ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_refresh_vote_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry uuid := COALESCE(NEW.entry_id, OLD.entry_id);
BEGIN
  -- Baseline PLUS the real tally. The baseline is seeded demo weight (095) and
  -- is zero on a production row; adding rather than replacing is what stops the
  -- first real vote on a seeded entry from collapsing 1,489 votes to 1.
  UPDATE public.archive_entries e
  SET vote_count = e.baseline_vote_count + sub.total,
      up_count   = e.baseline_up_count + sub.ups,
      updated_at = now()
  FROM (
    SELECT count(*) AS total, count(*) FILTER (WHERE value) AS ups
    FROM public.archive_votes WHERE entry_id = v_entry
  ) AS sub
  WHERE e.id = v_entry;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS archive_votes_count ON public.archive_votes;
CREATE TRIGGER archive_votes_count
  AFTER INSERT OR UPDATE OR DELETE ON public.archive_votes
  FOR EACH ROW EXECUTE FUNCTION public.archive_refresh_vote_counts();


CREATE OR REPLACE FUNCTION public.archive_refresh_review_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry uuid := COALESCE(NEW.entry_id, OLD.entry_id);
BEGIN
  UPDATE public.archive_entries e
  SET review_count = (
        SELECT count(*) FROM public.archive_reviews
        WHERE entry_id = v_entry AND status = 'published'
      ),
      updated_at = now()
  WHERE e.id = v_entry;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS archive_reviews_count ON public.archive_reviews;
CREATE TRIGGER archive_reviews_count
  AFTER INSERT OR UPDATE OR DELETE ON public.archive_reviews
  FOR EACH ROW EXECUTE FUNCTION public.archive_refresh_review_count();


CREATE OR REPLACE FUNCTION public.archive_refresh_helpful_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review uuid := COALESCE(NEW.review_id, OLD.review_id);
BEGIN
  UPDATE public.archive_reviews r
  SET helpful_count = (
        SELECT count(*) FROM public.archive_review_helpful WHERE review_id = v_review
      )
  WHERE r.id = v_review;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS archive_helpful_count ON public.archive_review_helpful;
CREATE TRIGGER archive_helpful_count
  AFTER INSERT OR DELETE ON public.archive_review_helpful
  FOR EACH ROW EXECUTE FUNCTION public.archive_refresh_helpful_count();


CREATE OR REPLACE FUNCTION public.archive_refresh_agree_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note uuid := COALESCE(NEW.note_id, OLD.note_id);
BEGIN
  UPDATE public.archive_content_notes n
  SET agree_count = (
        SELECT count(*) FROM public.archive_note_agreements WHERE note_id = v_note
      )
  WHERE n.id = v_note;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS archive_note_agree_count ON public.archive_note_agreements;
CREATE TRIGGER archive_note_agree_count
  AFTER INSERT OR DELETE ON public.archive_note_agreements
  FOR EACH ROW EXECUTE FUNCTION public.archive_refresh_agree_count();


-- ── Search ──────────────────────────────────────────────────────────────────
-- Title, creator and summary. Not the reviews: a search for "Sciamma" should
-- find her film, not the twenty reviews that mention her, and folding review
-- bodies in here would make the most-discussed entry match nearly everything.

CREATE OR REPLACE FUNCTION public.archive_entries_search_tsv()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_tsv :=
      setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A')
   || setweight(to_tsvector('simple', coalesce(NEW.creator, '')), 'B')
   || setweight(to_tsvector('simple', coalesce(NEW.summary, '')), 'C');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS archive_entries_tsv ON public.archive_entries;
CREATE TRIGGER archive_entries_tsv
  BEFORE INSERT OR UPDATE OF title, creator, summary ON public.archive_entries
  FOR EACH ROW EXECUTE FUNCTION public.archive_entries_search_tsv();

CREATE INDEX IF NOT EXISTS idx_archive_entries_search
  ON public.archive_entries USING GIN (search_tsv);

-- Backfill for any row that existed before this migration (none on a fresh
-- database; this makes the migration safe to apply to one that is not).
UPDATE public.archive_entries SET title = title WHERE search_tsv IS NULL;
