-- ============================================================
-- 103_dm_permission_bypasses.sql
--
-- Two ways past the DM-permission gate 093 built. Both verified against
-- production before this file was written; neither is exploitable today only
-- because 093 also forgot the column grant, so nobody could set the value away
-- from 'everyone' (fixed in 101). With 101 applied, these become live.
--
-- ── 1. A null conversation_type skipped the check entirely ──────────────────
--    The trigger opens with:
--      IF NEW.conversation_type IS DISTINCT FROM 'direct' THEN RETURN NEW;
--    and `conversation_type` is NULLABLE with a default. A default only applies
--    when the column is OMITTED — an explicit `null` is a value, it bypasses
--    the default, and it is DISTINCT FROM 'direct'. So the gate was skippable
--    by sending one extra key.
--
-- ── 2. Only ONE other participant was ever checked ──────────────────────────
--      SELECT p INTO v_other FROM unnest(NEW.participant_ids) AS p
--      WHERE p <> auth.uid() LIMIT 1;
--    `participant_ids` had no length constraint, and the uniqueness index is on
--    sorted_uuids(participant_ids), so a three-element array is a distinct row
--    that collides with nothing. Insert [attacker, permissive_decoy, victim]:
--    the trigger reads the decoy's 'everyone' and returns NEW, and the row then
--    matches the inbox query, which selects on participant_ids @> [me]. The
--    victim gets a conversation past a setting she chose.
--
--    This is the same shape as the lesson already written into 093's own
--    header — a gate the writer can steer. 093 guarded against the writer
--    choosing the RULE; it did not guard against the writer choosing WHICH
--    PERSON the rule is read from.
--
-- Fixed three ways, because one of them would have been a patch:
--   structurally (a direct conversation is exactly two people),
--   at the type (conversation_type can no longer be null),
--   and in the trigger (every other participant is checked, not the first).
--
-- Safe to apply: every existing row is already a 2-participant conversation
-- with a non-null type — 10 direct, 1 speed_date, checked before writing this.
-- ============================================================

-- ── 1. A type that cannot be null ───────────────────────────────────────────

UPDATE public.conversations SET conversation_type = 'direct' WHERE conversation_type IS NULL;
ALTER TABLE public.conversations ALTER COLUMN conversation_type SET NOT NULL;

-- ── 2. A direct conversation is exactly two people ──────────────────────────
-- Structural, so the trigger is not the only thing standing between a crafted
-- array and someone's inbox.

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_direct_is_a_pair;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_direct_is_a_pair
  CHECK (conversation_type <> 'direct' OR array_length(participant_ids, 1) = 2);

-- ── 3. Check every other participant, not the first one found ───────────────

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
  IF NEW.conversation_type <> 'direct' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (auth.uid() = ANY (NEW.participant_ids)) THEN
    RAISE EXCEPTION 'you cannot open a conversation you are not in'
      USING ERRCODE = '42501';
  END IF;

  -- EVERY other participant, not `LIMIT 1`. Taking the first match let an
  -- attacker put a permissive decoy in front of the person she was actually
  -- reaching — the rule was read from someone who had not been messaged.
  FOR v_other IN
    SELECT p FROM unnest(NEW.participant_ids) AS p WHERE p <> auth.uid()
  LOOP
    SELECT dm_permission INTO v_rule FROM public.profiles WHERE id = v_other;

    -- An absent row is not permission. A missing profile means the account is
    -- gone, and a conversation with it should not open.
    IF v_rule IS NULL THEN
      RAISE EXCEPTION 'that account no longer exists' USING ERRCODE = 'P0002';
    END IF;

    IF v_rule = 'everyone' THEN
      CONTINUE;
    END IF;

    IF v_rule = 'friends' AND public.are_friends(auth.uid(), v_other) THEN
      CONTINUE;
    END IF;

    IF v_rule = 'friends_of_friends'
       AND (public.are_friends(auth.uid(), v_other)
         OR public.share_a_friend(auth.uid(), v_other)) THEN
      CONTINUE;
    END IF;

    RAISE EXCEPTION 'she only accepts messages from %', v_rule
      USING ERRCODE = '42501';
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_dm_permission() IS
  'Refuses a direct conversation the recipient has not permitted. Checks EVERY other participant — 093 checked only the first, so a permissive decoy in the array let an attacker reach someone who had not permitted it.';
