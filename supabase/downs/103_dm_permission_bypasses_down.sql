-- ============================================================
-- 103_dm_permission_bypasses_down.sql
--
-- Restores 093's trigger and drops the two structural guards.
--
-- Running this re-opens both bypasses: a null conversation_type skips the DM
-- permission check entirely, and a three-element participant array lets an
-- attacker put a permissive decoy in front of the person she is actually
-- reaching. Do not run it on a live database.
-- ============================================================

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_direct_is_a_pair;
ALTER TABLE public.conversations ALTER COLUMN conversation_type DROP NOT NULL;

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
  IF NEW.conversation_type IS DISTINCT FROM 'direct' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (auth.uid() = ANY (NEW.participant_ids)) THEN
    RAISE EXCEPTION 'you cannot open a conversation you are not in' USING ERRCODE = '42501';
  END IF;
  SELECT p INTO v_other FROM unnest(NEW.participant_ids) AS p WHERE p <> auth.uid() LIMIT 1;
  IF v_other IS NULL THEN RETURN NEW; END IF;
  SELECT dm_permission INTO v_rule FROM public.profiles WHERE id = v_other;
  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'that account no longer exists' USING ERRCODE = 'P0002';
  END IF;
  IF v_rule = 'everyone' THEN RETURN NEW; END IF;
  IF v_rule = 'friends' AND public.are_friends(auth.uid(), v_other) THEN RETURN NEW; END IF;
  IF v_rule = 'friends_of_friends'
     AND (public.are_friends(auth.uid(), v_other) OR public.share_a_friend(auth.uid(), v_other)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'she only accepts messages from %', v_rule USING ERRCODE = '42501';
END;
$$;
