-- ============================================================
-- 093_dm_permissions_and_unblock.sql
--
-- Two halves of the safety surface the 3.0 prototype draws and this schema
-- cannot answer.
--
-- 1. "Who can message me" (prototype markup 896, behaviour 1637) has no column.
--    The row cycles Friends only → Friends of friends → Everyone (requests
--    first). Stored on profiles, and ENFORCED here rather than in the client:
--    a preference the client checks is a preference an attacker skips, and the
--    one person who must not be able to skip it is the one the setting exists
--    to stop.
--
-- 2. unblock_user() DID NOT EXIST. 085 built block_user() and
--    blocked_user_ids() and stopped there, so a block was permanent by
--    accident. "Blocked & muted" in the prototype (markup 899) opens a list
--    with an undo; there was no undo to call. There is also no mute in this
--    app and never has been, so the screen this unlocks says "Blocked".
--
-- WHY unblock_user RETURNS integer.
--    A PostgREST write answers 200 for a statement that matched zero rows, so
--    "no error" does not mean "it happened". The client removes her from the
--    list optimistically; gating that removal on an affected-row count is the
--    difference between an undo and a screen that merely looks like one. This
--    app has shipped the other version twice.
--
-- WHY blocked_profiles() and not a join in the client.
--    blocked_user_ids() returns ids; a list needs names. Reading the profile of
--    a woman you have blocked is exactly the row RLS is otherwise right to keep
--    out of reach, so the function is SECURITY DEFINER and scoped to rows where
--    the CALLER is the blocker — it can return nothing else. It also keeps the
--    client from having to know that a block is stored as a friendship, which
--    is this schema's private business (085's own words).
-- ============================================================

-- ── 1. DM permission ────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dm_permission text NOT NULL DEFAULT 'everyone';

-- Named, and composed from the three values rather than "not the other two".
-- This codebase has twice shipped a bug where a third enum value fell through a
-- `!= 'x'` branch and was treated as its opposite.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_dm_permission_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_dm_permission_check
  CHECK (dm_permission IN ('friends', 'friends_of_friends', 'everyone'));

COMMENT ON COLUMN public.profiles.dm_permission IS
  'Who may open a direct conversation with this member. everyone = anyone may, and the inbox files strangers under Requests. Enforced by enforce_dm_permission() on conversations.';

-- Are two members friends, in either direction? Blocks are stored in the same
-- table with status='blocked', so 'accepted' is required explicitly.
CREATE OR REPLACE FUNCTION public.are_friends(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND ((requester_id = a AND addressee_id = b)
        OR (requester_id = b AND addressee_id = a))
  );
$$;

REVOKE ALL ON FUNCTION public.are_friends(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.are_friends(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.share_a_friend(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friendships fa
    JOIN public.friendships fb ON (
      CASE WHEN fa.requester_id = a THEN fa.addressee_id ELSE fa.requester_id END
      =
      CASE WHEN fb.requester_id = b THEN fb.addressee_id ELSE fb.requester_id END
    )
    WHERE fa.status = 'accepted'
      AND fb.status = 'accepted'
      AND (fa.requester_id = a OR fa.addressee_id = a)
      AND (fb.requester_id = b OR fb.addressee_id = b)
  );
$$;

REVOKE ALL ON FUNCTION public.share_a_friend(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_a_friend(uuid, uuid) TO authenticated;

/*
 * Refuse a direct conversation the recipient has not permitted.
 *
 * The rule comes from the RECIPIENT's profile row, never from anything the
 * inserting client supplies — the only thing read out of NEW is who the other
 * participant is, which is the fact being checked rather than the choice of
 * which check to run. A gate that reads its own rule out of the row being
 * written is a gate the writer controls, and this schema has shipped that once
 * already.
 *
 * The caller must be among the participants, or she could open a conversation
 * between two other people and sidestep her own target's setting entirely.
 */
CREATE OR REPLACE FUNCTION public.enforce_dm_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other uuid;
  v_rule  text;
BEGIN
  IF NEW.conversation_type IS DISTINCT FROM 'direct' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (auth.uid() = ANY (NEW.participant_ids)) THEN
    RAISE EXCEPTION 'you cannot open a conversation you are not in'
      USING ERRCODE = '42501';
  END IF;

  SELECT p INTO v_other
  FROM unnest(NEW.participant_ids) AS p
  WHERE p <> auth.uid()
  LIMIT 1;

  IF v_other IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT dm_permission INTO v_rule FROM public.profiles WHERE id = v_other;

  -- An absent row is not permission. A missing profile means the account is
  -- gone, and a conversation with it should not open.
  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'that account no longer exists' USING ERRCODE = 'P0002';
  END IF;

  IF v_rule = 'everyone' THEN
    RETURN NEW;
  END IF;

  IF v_rule = 'friends' AND public.are_friends(auth.uid(), v_other) THEN
    RETURN NEW;
  END IF;

  IF v_rule = 'friends_of_friends'
     AND (public.are_friends(auth.uid(), v_other)
       OR public.share_a_friend(auth.uid(), v_other)) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'she only accepts messages from %', v_rule
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS enforce_dm_permission_on_insert ON public.conversations;
CREATE TRIGGER enforce_dm_permission_on_insert
  BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dm_permission();


-- ── 2. Unblock ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.unblock_user(p_target_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'no user given to unblock' USING ERRCODE = '22023';
  END IF;

  -- Only the block edge. Unblocking restores nothing else: 085's block_user
  -- deletes the reverse friendship, and a woman who unblocks someone is not
  -- asking to be friends with him again.
  DELETE FROM public.friendships
  WHERE requester_id = auth.uid()
    AND addressee_id = p_target_id
    AND status = 'blocked';

  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.unblock_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated;

COMMENT ON FUNCTION public.unblock_user(uuid) IS
  'Removes the caller''s block on a member and returns how many rows that removed, so the client can tell an undo from a no-op. 085 built block_user without one.';


CREATE OR REPLACE FUNCTION public.blocked_profiles()
RETURNS TABLE (id uuid, display_name text, username text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.username, p.avatar_url
  FROM public.friendships f
  JOIN public.profiles p ON p.id = f.addressee_id
  WHERE f.requester_id = auth.uid()
    AND f.status = 'blocked'
  ORDER BY p.display_name NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.blocked_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.blocked_profiles() TO authenticated;

COMMENT ON FUNCTION public.blocked_profiles() IS
  'The caller''s block list with enough profile detail to render it. Scoped to rows where the caller is the blocker, so it can return no one else.';
