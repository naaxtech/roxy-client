-- Undoes 120_archive_star_votes.sql. Restores the 097 vote-count function
-- and drops the star columns.

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
      updated_at = now()
  FROM (
    SELECT count(*) AS total, count(*) FILTER (WHERE value) AS ups
    FROM public.archive_votes WHERE entry_id = v_entry
  ) AS sub
  WHERE e.id = v_entry;

  RETURN NULL;
END;
$$;

REVOKE UPDATE (stars) ON public.archive_votes FROM authenticated;
GRANT UPDATE (value, updated_at) ON public.archive_votes TO authenticated;

ALTER TABLE public.archive_entries DROP CONSTRAINT IF EXISTS archive_star_sum_nonneg;
ALTER TABLE public.archive_entries DROP COLUMN IF EXISTS star_sum;

ALTER TABLE public.archive_votes DROP CONSTRAINT IF EXISTS archive_vote_stars_range;
ALTER TABLE public.archive_votes DROP COLUMN IF EXISTS stars;
