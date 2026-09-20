-- ============================================================
-- 120_archive_star_votes.sql
--
-- Archive scoring is now 1–5 stars. The recommend boolean stays so the
-- existing up_count trigger and ranking gate keep working: 4★ and 5★ count
-- as a recommend. star_sum / vote_count is the average the app shows.
-- ============================================================

ALTER TABLE public.archive_votes
  ADD COLUMN IF NOT EXISTS stars smallint;

UPDATE public.archive_votes
SET stars = CASE WHEN value THEN 5 ELSE 2 END
WHERE stars IS NULL;

ALTER TABLE public.archive_votes
  ALTER COLUMN stars SET DEFAULT 5,
  ALTER COLUMN stars SET NOT NULL;

ALTER TABLE public.archive_votes
  DROP CONSTRAINT IF EXISTS archive_vote_stars_range;

ALTER TABLE public.archive_votes
  ADD CONSTRAINT archive_vote_stars_range CHECK (stars BETWEEN 1 AND 5);

ALTER TABLE public.archive_entries
  ADD COLUMN IF NOT EXISTS star_sum integer NOT NULL DEFAULT 0;

ALTER TABLE public.archive_entries
  DROP CONSTRAINT IF EXISTS archive_star_sum_nonneg;

ALTER TABLE public.archive_entries
  ADD CONSTRAINT archive_star_sum_nonneg CHECK (star_sum >= 0);

-- 101 granted UPDATE only on (value, updated_at). Stars has to be writable
-- the same way or changing a rating is refused.
GRANT UPDATE (value, stars, updated_at) ON public.archive_votes TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_refresh_vote_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry uuid := COALESCE(NEW.entry_id, OLD.entry_id);
BEGIN
  UPDATE public.archive_entries e
  SET vote_count = e.baseline_vote_count + sub.total,
      up_count   = e.baseline_up_count + sub.ups,
      star_sum   = sub.stars,
      updated_at = now()
  FROM (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE value) AS ups,
      coalesce(sum(stars), 0) AS stars
    FROM public.archive_votes WHERE entry_id = v_entry
  ) AS sub
  WHERE e.id = v_entry;

  RETURN NULL;
END;
$$;

UPDATE public.archive_entries e
SET star_sum = coalesce((
  SELECT sum(v.stars) FROM public.archive_votes v WHERE v.entry_id = e.id
), 0);
