-- 135_chat_notifications_down.sql
-- Reverses 135. Invite and join-request notifications are deleted (the old
-- CHECK cannot hold them); the invites and requests themselves stay.
-- Every other type in notifications_type_check is kept as it is now, so a
-- lane applied after 135 does not lose its types.
-- destructive-ok: reversal of 135 only.

DROP TRIGGER IF EXISTS community_join_requests_notify ON public.community_join_requests;
DROP FUNCTION IF EXISTS public.notify_community_join_request();

DELETE FROM public.notifications WHERE type IN ('community_invite', 'community_join_request');

DO $$
DECLARE
  v_def   text;
  v_types text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_types
  FROM (
    SELECT btrim(x, ' "') AS t
    FROM regexp_matches(COALESCE(v_def, ''), '''([^'']*)''', 'g') AS m(lit),
         LATERAL regexp_split_to_table(translate(m.lit[1], '{}', ''), ',') AS x
  ) s
  WHERE t ~ '^[a-z_]+$' AND t NOT IN ('community_invite', 'community_join_request');
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format(
    'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))',
    v_types
  );
END $$;
