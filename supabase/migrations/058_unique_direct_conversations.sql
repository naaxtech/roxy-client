-- 058: enforce one direct conversation per user pair.
-- The client's find-or-create (lib/directMessages.ts) is a search-then-insert
-- with a race window: two concurrent opens could each create a conversation,
-- silently splitting message history. A unique index on the sorted participant
-- pair closes the race; the client retries the lookup on unique-violation.

CREATE OR REPLACE FUNCTION public.sorted_uuids(arr uuid[])
RETURNS uuid[] IMMUTABLE LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(x ORDER BY x), '{}') FROM unnest(arr) AS x
$$;

-- Dev-data cleanup: keep the most recently active conversation per pair,
-- drop the rest (messages cascade). Pre-launch data only — production must
-- never reach this state again once the index exists.
DELETE FROM public.conversations c
USING public.conversations dup
WHERE c.conversation_type = 'direct'
  AND dup.conversation_type = 'direct'
  AND public.sorted_uuids(c.participant_ids) = public.sorted_uuids(dup.participant_ids)
  AND c.id <> dup.id
  AND (
    COALESCE(c.last_message_at, c.created_at) < COALESCE(dup.last_message_at, dup.created_at)
    OR (
      COALESCE(c.last_message_at, c.created_at) = COALESCE(dup.last_message_at, dup.created_at)
      AND c.id < dup.id
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_conversation_pair
ON public.conversations (public.sorted_uuids(participant_ids))
WHERE conversation_type = 'direct';
