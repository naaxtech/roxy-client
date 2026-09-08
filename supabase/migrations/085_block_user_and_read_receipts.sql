-- ============================================================
-- 085_block_user_and_read_receipts.sql
--
-- Two client calls that have never worked against this database.
--
-- 1. block_user() DID NOT EXIST.
--    store/safetyStore.ts:31 has always called
--    `supabase.rpc('block_user', { target_id })`. No migration ever created
--    that function, so every block attempt returned PGRST202 and surfaced in
--    the chat menu as "Could not block user." On a WLW dating app the block
--    button is the one control a woman reaches for when a conversation turns
--    threatening, and it has been decorative. This is the highest-severity
--    defect in the app.
--
--    008_safety.sql:2 records the intended mechanism -- "blocks use existing
--    friendships.status='blocked'" -- so the storage was designed and then
--    never given an entry point. This adds the entry point rather than a
--    second blocking table, because friendships already carries the UNIQUE
--    (requester_id, addressee_id) key, the 'blocked' CHECK value, and the
--    ON DELETE CASCADE to profiles that a block list needs.
--
-- 2. Marking a conversation read was silently refused by RLS.
--    app/(tabs)/connect/chat/[id].tsx:413 updates
--    `messages SET is_read = true WHERE conversation_id = X AND sender_id <> me`.
--    The only UPDATE policy on messages is messages_update_own,
--    USING (auth.uid() = sender_id) -- so the RECIPIENT, the only person who
--    can possibly know a message has been read, is the one person the policy
--    excludes. RLS filters non-matching rows instead of erroring, so PostgREST
--    returned 204 and the client believed it had worked. Verified against the
--    live database: the UPDATE returns 204 and is_read stays false.
--
--    Consequences: read ticks never advance past a single tick, and the unread
--    badge is recomputed from the database on every load of the Messages tab,
--    so it comes back permanently.
--
-- WHY AN RPC AND NOT AN RLS POLICY for (2).
--    `authenticated` currently holds UPDATE on every column of messages,
--    including content. RLS chooses ROWS, never COLUMNS -- so any UPDATE
--    policy broad enough to let a recipient set is_read is equally a licence
--    for her to rewrite the sender's words, and no WITH CHECK expression can
--    narrow that to one column. A SECURITY DEFINER function is the only way to
--    grant exactly "set is_read on messages addressed to me" and nothing else.
--    Both functions below are therefore the standard shape used throughout
--    this schema: SECURITY DEFINER, pinned search_path, auth.uid() checked
--    inside, EXECUTE granted only to authenticated.
-- ============================================================

-- ── 1. Blocking ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.block_user(p_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'no user given to block' USING ERRCODE = '22023';
  END IF;

  -- no_self_friendship would raise a constraint violation here anyway, but a
  -- CHECK violation reaches the client as an opaque 23514. Say what happened.
  IF p_target_id = auth.uid() THEN
    RAISE EXCEPTION 'you cannot block yourself' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_id) THEN
    RAISE EXCEPTION 'that account no longer exists' USING ERRCODE = 'P0002';
  END IF;

  -- The relationship is over in both directions. Without this the row SHE
  -- owns survives -- so a woman she has just blocked still appears in her
  -- friends list, and any policy reading friendships for an 'accepted' edge
  -- still finds one. friendships is keyed UNIQUE (requester_id, addressee_id),
  -- so the reverse pair is a genuinely separate row and has to be cleared
  -- explicitly; blocking is the one action allowed to delete a row the caller
  -- does not own, which is why this runs as SECURITY DEFINER.
  DELETE FROM public.friendships
  WHERE requester_id = p_target_id
    AND addressee_id = auth.uid();

  INSERT INTO public.friendships (requester_id, addressee_id, status)
  VALUES (auth.uid(), p_target_id, 'blocked')
  ON CONFLICT (requester_id, addressee_id)
  DO UPDATE SET status = 'blocked';
END;
$$;

REVOKE ALL ON FUNCTION public.block_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated;

COMMENT ON FUNCTION public.block_user(uuid) IS
  'Blocks a member: drops any reverse friendship row and records status=''blocked'' from the caller. Entry point for the mechanism 008_safety.sql described but never built.';


-- Hydration for the block list.
--
-- safetyStore.blockedUserIds starts [] on every launch and nothing ever
-- refills it, so even with block_user working the UI would forget who is
-- blocked as soon as the app restarted. The rows are readable under
-- friendships_own, but the client should not have to know that a block is
-- stored as a friendship -- that is this schema's private business.
CREATE OR REPLACE FUNCTION public.blocked_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT addressee_id
  FROM public.friendships
  WHERE requester_id = auth.uid()
    AND status = 'blocked';
$$;

REVOKE ALL ON FUNCTION public.blocked_user_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.blocked_user_ids() TO authenticated;

COMMENT ON FUNCTION public.blocked_user_ids() IS
  'Everyone the caller has blocked. Lets the client rehydrate its block list without knowing blocks live in friendships.';


-- ── 2. Read receipts ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marked integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- SECURITY DEFINER bypasses messages_participant, so membership of the
  -- conversation has to be proven here or this function would mark any
  -- conversation in the table read.
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND auth.uid() = ANY (c.participant_ids)
  ) THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002';
  END IF;

  -- sender_id <> auth.uid() keeps this to messages addressed TO the caller:
  -- a read receipt is a statement about what she has seen, never about her
  -- own outgoing messages.
  UPDATE public.messages
  SET is_read = true
  WHERE conversation_id = p_conversation_id
    AND sender_id <> auth.uid()
    AND is_read = false;

  GET DIAGNOSTICS v_marked = ROW_COUNT;
  RETURN v_marked;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

COMMENT ON FUNCTION public.mark_conversation_read(uuid) IS
  'Marks every message addressed to the caller in one conversation as read, and returns how many changed. Exists because messages_update_own excludes the recipient and RLS cannot restrict UPDATE to a single column.';
