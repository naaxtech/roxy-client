-- ============================================================
-- 102_speed_date_respects_blocks.sql
--
-- Blocking someone did not stop her being matched with you again.
--
-- `claim_speed_date_partner` (077) filters a waiting session on status,
-- participant count, not-self, community, scheduled_at and last_seen_at — and
-- on nothing else. There is no block check anywhere in it. `blocked_pair` is
-- enforced on exactly five relations in production (posts, comments, profiles,
-- conversations, messages); speed_date_sessions is not among them, and the
-- client does not filter either — `blockedUserIds` is read in one place
-- app-wide, for a count on the settings screen.
--
-- So: she blocks a woman mid-date, leaves, rejoins the queue, and the same
-- person can be handed to her again in another one-to-one live video call
-- minutes later.
--
-- The app promises otherwise, in so many words. components/rooms/ConsentStrip
-- announces the control as "Block. She can never see you or match with you
-- again." That sentence was false on the highest-stakes surface in the product,
-- and it is the sentence a woman relies on when a call has gone wrong.
--
-- WHY BOTH DIRECTIONS.
--   `blocked_pair` is symmetric on purpose. The woman who did the blocking must
--   not be matched to him, AND he must not be matched to her — a block that
--   only filtered one side would still put them in the same call, just with the
--   other one doing the joining.
--
-- WHY IN THE FUNCTION AND NOT IN RLS.
--   The matcher runs SECURITY DEFINER and picks a row on the caller's behalf;
--   an RLS policy on speed_date_sessions would not be consulted for that
--   sub-select. The filter has to live where the choice is made.
--
-- Everything else about the function is unchanged, comments included — this is
-- one added predicate, so the diff is reviewable as one idea.
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
        -- exactly one waiter. array_length returns NULL for '{}', so rows
        -- abandoned by "Leave Queue" are excluded rather than matched.
        AND array_length(c.participant_ids, 1) = 1
        AND NOT (p_user_id = ANY (c.participant_ids))
        -- NULL community (the open "feeling wild" pool) must compare equal to
        -- NULL, which plain = never does.
        AND c.community_id IS NOT DISTINCT FROM p_community_id
        -- A session booked for later (the host flow, 009) is not a queue entry
        -- and must never be handed to a walk-up joiner. The 30s grace is clock
        -- skew tolerance, nothing more: the edge function stamps scheduled_at
        -- from the Deno runtime's clock, not the database's, so a queue row can
        -- legitimately land a few milliseconds in Postgres' future. Anything
        -- genuinely booked ahead is minutes to days out and still excluded.
        AND c.scheduled_at <= now() + interval '30 seconds'
        -- never pair someone with a waiter who has gone quiet. Bounded on the
        -- last heartbeat, NOT on created_at: someone who has been waiting
        -- fifteen minutes with a live app is still there and still wants this.
        AND c.last_seen_at > now() - make_interval(secs => p_stale_seconds)
        -- NEW in 102: never hand her someone either of them has blocked.
        -- blocked_pair is symmetric, so this holds whichever way round the
        -- block was made and whichever of them is doing the joining.
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(c.participant_ids) AS waiting(uid)
          WHERE public.blocked_pair(p_user_id, waiting.uid)
        )
      -- fairest first: longest time in the queue wins.
      ORDER BY c.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING s.id, s.daily_room_url;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_speed_date_partner(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_speed_date_partner(uuid, uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.claim_speed_date_partner(uuid, uuid, integer) IS
  'Claims one waiting speed-date session. Skips any waiter in a blocked pair with the caller, in either direction — without that, blocking someone mid-date did not stop her being matched with them again minutes later.';
