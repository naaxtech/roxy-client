-- ============================================================
-- 123_archive_ranked_view.sql
--
-- The Archive browse list sorted client-side: fetch every published row,
-- then re-sort in JS for "top" (a three-tier ratio ranking) and "needs".
-- Fine at 45 rows; the slow path the moment the catalogue grows — and the
-- one screen every member lands on.
--
-- This view moves the ranking into Postgres so the ORDER BY runs in the
-- database and the client only issues .order(). Two computed columns carry
-- the rules the client used to own:
--
--   rank_priority      the three tiers, mirroring the removed client sort:
--                        0 = past the gate (has_score, i.e. >= 10 votes)
--                        1 = rated but thin (1..9 votes)
--                        2 = unrated
--
--   calculated_percent the number the client shows, so the DB order and the
--                      visible order cannot drift: the star average
--                      normalised to a percentage when stars exist, else the
--                      recommend percentage (up_count / vote_count).
--
-- RLS is preserved with security_invoker = true: the view runs as the
-- caller, so archive_entries' "archive_entries_select_published" policy
-- still decides what a member is allowed to see. Without it the view would
-- republish pending/rejected/hidden rows to the shipped anon key.
--
-- `WHERE status = 'published'` replicates the old
-- `.eq('status','published')` server-side; RLS still applies on top for the
-- staff bypass.
-- ============================================================

CREATE OR REPLACE VIEW public.archive_ranked_view
WITH (security_invoker = true)
AS
SELECT
  id,
  slug,
  title,
  media_type,
  release_year,
  creator,
  length_label,
  summary,
  cover_url,
  cover_gradient,
  vote_count,
  up_count,
  star_sum,
  review_count,
  has_score,
  published_at,
  CASE
    WHEN has_score THEN 0
    WHEN vote_count > 0 THEN 1
    ELSE 2
  END AS rank_priority,
  CASE
    WHEN vote_count <= 0 THEN 0::numeric
    WHEN star_sum > 0 THEN ((star_sum::numeric / vote_count) / 5.0) * 100
    ELSE (up_count::numeric / vote_count) * 100
  END AS calculated_percent
FROM public.archive_entries
WHERE status = 'published';

GRANT SELECT ON public.archive_ranked_view TO authenticated;
