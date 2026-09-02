-- ============================================================
-- 102_speed_date_respects_blocks_down.sql
--
-- Restores 077's matcher WITHOUT the blocked-pair filter.
--
-- Read that sentence again before running this. It re-opens the path where a
-- woman who blocked someone mid-date can be matched with him again minutes
-- later, while the Block control still tells her "she can never see you or
-- match with you again". There is no version of this rollback that is safe to
-- run on a live database with real members on it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_speed_date_partner(
  p_user_id uuid,
  p_community_id uuid,
  p_stale_seconds integer DEFAULT 120
)
RETURNS TABLE (session_id uuid, daily_room_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_member_id(p_user_id) THEN
    RAISE EXCEPTION 'not_approved' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.speed_date_sessions s
     SET participant_ids = s.participant_ids || p_user_id,
         status          = 'active',
         started_at      = now(),
         last_seen_at    = now()
   WHERE s.id = (
     SELECT c.id
       FROM public.speed_date_sessions c
      WHERE c.status = 'scheduled'
        AND array_length(c.participant_ids, 1) = 1
        AND NOT (p_user_id = ANY (c.participant_ids))
        AND c.community_id IS NOT DISTINCT FROM p_community_id
        AND c.scheduled_at <= now() + interval '30 seconds'
        AND c.last_seen_at > now() - make_interval(secs => p_stale_seconds)
      ORDER BY c.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING s.id, s.daily_room_url;
END;
$$;
