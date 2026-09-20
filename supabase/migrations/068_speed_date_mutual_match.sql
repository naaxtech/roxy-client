-- ============================================================
-- 068_speed_date_mutual_match.sql
-- Bug: apps/mobile/app/(tabs)/connect/speed-dating/result.tsx created a
-- `matches` row and started a conversation the instant ONE participant
-- tapped "like" -- with zero check that the other participant also liked
-- back -- while telling that user "You both felt the connection. It's a
-- match!" This is false, and pairs two strangers into a live conversation
-- with no consent from the side that never indicated interest, which is a
-- real problem on a dating app, not just a copy bug.
--
-- Fix: record each participant's like server-side and only create the
-- match + conversation once BOTH sides have said yes.
-- ============================================================

CREATE TABLE IF NOT EXISTS speed_date_likes (
  session_id uuid NOT NULL REFERENCES speed_date_sessions(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  liked      boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

ALTER TABLE speed_date_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sdl_insert_own" ON speed_date_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sdl_select_participant" ON speed_date_likes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM speed_date_sessions s
      WHERE s.id = speed_date_likes.session_id AND auth.uid() = ANY(s.participant_ids)
    )
  );

-- Enable Realtime so the waiting side finds out the moment the other
-- participant's decision lands, without polling.
ALTER PUBLICATION supabase_realtime ADD TABLE speed_date_likes;

CREATE OR REPLACE FUNCTION public.submit_speed_date_like(p_session_id uuid, p_liked boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session         speed_date_sessions;
  v_partner_id      uuid;
  v_partner_liked   boolean;
  v_conversation_id uuid;
BEGIN
  SELECT * INTO v_session FROM speed_date_sessions WHERE id = p_session_id;
  IF v_session IS NULL OR NOT (auth.uid() = ANY(v_session.participant_ids)) THEN
    RAISE EXCEPTION 'Not a participant of this session';
  END IF;

  INSERT INTO speed_date_likes (session_id, user_id, liked)
  VALUES (p_session_id, auth.uid(), p_liked)
  ON CONFLICT (session_id, user_id) DO UPDATE SET liked = EXCLUDED.liked;

  SELECT x INTO v_partner_id FROM unnest(v_session.participant_ids) x WHERE x != auth.uid() LIMIT 1;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('status', 'no_match', 'conversation_id', null);
  END IF;

  SELECT liked INTO v_partner_liked
  FROM speed_date_likes WHERE session_id = p_session_id AND user_id = v_partner_id;

  IF v_partner_liked IS NULL THEN
    RETURN jsonb_build_object('status', 'waiting', 'conversation_id', null);
  END IF;

  IF NOT p_liked OR NOT v_partner_liked THEN
    RETURN jsonb_build_object('status', 'no_match', 'conversation_id', null);
  END IF;

  -- Mutual like -- canonical (LEAST, GREATEST) pair order so whichever side
  -- resolves the match second doesn't insert a reversed duplicate row.
  INSERT INTO matches (user_a_id, user_b_id, source)
  VALUES (LEAST(auth.uid(), v_partner_id), GREATEST(auth.uid(), v_partner_id), 'speed_date')
  ON CONFLICT (user_a_id, user_b_id) DO NOTHING;

  SELECT id INTO v_conversation_id
  FROM conversations
  WHERE conversation_type = 'speed_date'
    AND participant_ids @> ARRAY[auth.uid(), v_partner_id]
    AND participant_ids <@ ARRAY[auth.uid(), v_partner_id]
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    INSERT INTO conversations (participant_ids, conversation_type)
    VALUES (ARRAY[auth.uid(), v_partner_id], 'speed_date')
    RETURNING id INTO v_conversation_id;
  END IF;

  RETURN jsonb_build_object('status', 'matched', 'conversation_id', v_conversation_id);
END;
$$;
