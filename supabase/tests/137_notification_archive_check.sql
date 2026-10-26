-- Behaviour proof for 137_notification_archive.sql on a LOCAL database.
-- Runs inside one transaction that the runner ROLLS BACK (migration-proof.cjs);
-- it leaves nothing behind. Every block RAISEs on a failed expectation.
\set ON_ERROR_STOP on

DO $$
DECLARE
  a uuid; b uuid;
  na uuid; na2 uuid; nb uuid;
  n int;
  ok boolean; st text;
  t_arch timestamptz; t_read timestamptz; t_created timestamptz;
  col text;
BEGIN
  -- A stacked check may have left an identity behind; auth.uid() reads
  -- claim.sub before claims, so clear both.
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT id INTO a FROM public.profiles ORDER BY created_at, id LIMIT 1;
  SELECT id INTO b FROM public.profiles WHERE id <> a ORDER BY created_at, id LIMIT 1;
  IF b IS NULL THEN RAISE EXCEPTION 'need 2 profiles in the local db'; END IF;

  -- Fixtures: two rows for a, one for b. Cleared first so the check can run
  -- twice in one transaction (down cycle).
  DELETE FROM public.notifications WHERE title LIKE '137 fixture%';
  INSERT INTO public.notifications (user_id, actor_id, type, title)
  VALUES (a, b, 'friend_accept', '137 fixture a1') RETURNING id INTO na;
  INSERT INTO public.notifications (user_id, actor_id, type, title)
  VALUES (a, b, 'friend_accept', '137 fixture a2') RETURNING id INTO na2;
  INSERT INTO public.notifications (user_id, actor_id, type, title)
  VALUES (b, a, 'friend_accept', '137 fixture b1') RETURNING id INTO nb;

  -- ── T1 shape: nullable timestamptz, no default, CHECK, inbox + archive indexes ──
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'archived_at'
      AND data_type = 'timestamp with time zone' AND is_nullable = 'YES' AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'T1 notifications.archived_at is missing or not a nullable timestamptz without default';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND conname = 'notifications_archived_after_created'
      AND pg_get_constraintdef(oid) = 'CHECK (((archived_at IS NULL) OR (archived_at >= created_at)))'
  ) THEN
    RAISE EXCEPTION 'T1 CHECK notifications_archived_after_created is missing or changed';
  END IF;
  IF (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_notifications_user_inbox')
     IS DISTINCT FROM 'CREATE INDEX idx_notifications_user_inbox ON public.notifications USING btree (user_id, created_at DESC) WHERE (archived_at IS NULL)' THEN
    RAISE EXCEPTION 'T1 inbox index idx_notifications_user_inbox is missing or changed';
  END IF;
  IF (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_notifications_user_archived')
     IS DISTINCT FROM 'CREATE INDEX idx_notifications_user_archived ON public.notifications USING btree (user_id, archived_at DESC) WHERE (archived_at IS NOT NULL)' THEN
    RAISE EXCEPTION 'T1 archive index idx_notifications_user_archived is missing or changed';
  END IF;
  -- 057's indexes stay exactly as they were: the duplicate checks (133 follow,
  -- 136 reaction) and the profiles ON DELETE CASCADE read every row, archived or not.
  IF (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_notifications_user_created')
     IS DISTINCT FROM 'CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC)' THEN
    RAISE EXCEPTION 'T1 057 index idx_notifications_user_created was changed';
  END IF;
  IF (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_notifications_user_unread')
     IS DISTINCT FROM 'CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id) WHERE (read_at IS NULL)' THEN
    RAISE EXCEPTION 'T1 057 index idx_notifications_user_unread was changed';
  END IF;
  RAISE NOTICE 'PASS 137 T1 shape: archived_at, CHECK, inbox + archive indexes, 057 indexes untouched';

  -- ── T2 grants: members may write read_at and archived_at, nothing else; anon nothing ──
  IF has_table_privilege('authenticated', 'public.notifications', 'UPDATE') THEN
    RAISE EXCEPTION 'T2 authenticated holds table-wide UPDATE on notifications';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.notifications', 'archived_at', 'UPDATE') THEN
    RAISE EXCEPTION 'T2 authenticated cannot UPDATE notifications.archived_at';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE') THEN
    RAISE EXCEPTION 'T2 authenticated lost UPDATE on notifications.read_at';
  END IF;
  FOR col IN SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'notifications'
               AND column_name NOT IN ('read_at', 'archived_at')
  LOOP
    IF has_column_privilege('authenticated', 'public.notifications', col, 'UPDATE') THEN
      RAISE EXCEPTION 'T2 authenticated can UPDATE notifications.%', col;
    END IF;
  END LOOP;
  IF has_any_column_privilege('anon', 'public.notifications', 'SELECT')
     OR has_any_column_privilege('anon', 'public.notifications', 'UPDATE')
     OR has_any_column_privilege('anon', 'public.notifications', 'INSERT')
     OR has_table_privilege('anon', 'public.notifications', 'DELETE') THEN
    RAISE EXCEPTION 'T2 anon holds a privilege on notifications';
  END IF;
  RAISE NOTICE 'PASS 137 T2 grants: UPDATE (read_at, archived_at) for members only, anon nothing';

  -- ── T3 she clears her own notification: archived and read, one row ──────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.notifications SET archived_at = now(), read_at = now() WHERE id = na;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'T3 clearing her own row changed % rows', n; END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = na;
  IF t_arch IS NULL OR t_read IS NULL THEN
    RAISE EXCEPTION 'T3 after clearing: archived_at %, read_at %', t_arch, t_read;
  END IF;
  RAISE NOTICE 'PASS 137 T3 she archives her own notification (archived_at and read_at set)';

  -- ── T4 a slow phone clock cannot make the clear fail: the server stamps it ──
  SET LOCAL ROLE authenticated;
  n := -1;
  BEGIN
    UPDATE public.notifications SET archived_at = now() - interval '1 day' WHERE id = na2;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RESET ROLE;
  IF n = -1 THEN RAISE EXCEPTION 'T4 a clear sent with a slow device clock was refused by the CHECK'; END IF;
  IF n <> 1 THEN RAISE EXCEPTION 'T4 a clear with a skewed clock changed % rows', n; END IF;
  SELECT archived_at, created_at INTO t_arch, t_created FROM public.notifications WHERE id = na2;
  IF t_arch IS NULL OR t_arch < t_created THEN
    RAISE EXCEPTION 'T4 archived_at % was not stamped by the server (created_at %)', t_arch, t_created;
  END IF;
  RAISE NOTICE 'PASS 137 T4 archived_at is the server clock, so a skewed device clock still clears';

  -- ── T5 Undo / Restore: she can unarchive her own row ────────────────────
  SET LOCAL ROLE authenticated;
  UPDATE public.notifications SET archived_at = NULL WHERE id IN (na, na2);
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 2 THEN RAISE EXCEPTION 'T5 restoring her rows changed % rows', n; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE id IN (na, na2) AND archived_at IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'T5 % rows still archived after restore', n; END IF;
  RAISE NOTICE 'PASS 137 T5 she restores (unarchives) her own notifications';

  -- ── T6 she can NOT clear another member's notification ──────────────────
  SET LOCAL ROLE authenticated;
  UPDATE public.notifications SET archived_at = now(), read_at = now() WHERE id = nb;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'T6 a''s UPDATE of b''s notification changed % rows', n; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE id = nb;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'T6 a can see b''s notification'; END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = nb;
  IF t_arch IS NOT NULL OR t_read IS NOT NULL THEN
    RAISE EXCEPTION 'T6 b''s notification was changed by a: archived_at %, read_at %', t_arch, t_read;
  END IF;
  RAISE NOTICE 'PASS 137 T6 she cannot archive another member''s notification (re-read: unchanged)';

  -- ── T7 she can NOT rewrite title, body, user_id, type or link_path ──────
  FOREACH col IN ARRAY ARRAY['title', 'body', 'user_id', 'type', 'link_path'] LOOP
    ok := false; st := NULL;
    SET LOCAL ROLE authenticated;
    BEGIN
      IF col = 'user_id' THEN
        EXECUTE format('UPDATE public.notifications SET user_id = %L WHERE id = %L', b, na);
      ELSIF col = 'type' THEN
        EXECUTE format('UPDATE public.notifications SET type = %L WHERE id = %L', 'follow', na);
      ELSE
        EXECUTE format('UPDATE public.notifications SET %I = %L WHERE id = %L', col, '137 hacked', na);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN ok := true;
    END;
    RESET ROLE;
    IF NOT ok THEN RAISE EXCEPTION 'T7 a member could UPDATE notifications.%', col; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.notifications
   WHERE id = na AND user_id = a AND title = '137 fixture a1' AND type = 'friend_accept';
  IF n <> 1 THEN RAISE EXCEPTION 'T7 her row was rewritten'; END IF;
  RAISE NOTICE 'PASS 137 T7 she cannot write title, body, user_id, type or link_path';

  -- ── T8 mark-read alone still works (installed builds) ───────────────────
  SET LOCAL ROLE authenticated;
  UPDATE public.notifications SET read_at = now() WHERE id = na2;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'T8 mark-read changed % rows', n; END IF;
  SELECT archived_at INTO t_arch FROM public.notifications WHERE id = na2;
  IF t_arch IS NOT NULL THEN RAISE EXCEPTION 'T8 mark-read archived the row'; END IF;
  RAISE NOTICE 'PASS 137 T8 mark-read without archiving still works';

  -- ── T9 anon: no way in ──────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN PERFORM 1 FROM public.notifications LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'T9 anon could read notifications'; END IF;
  ok := false;
  BEGIN UPDATE public.notifications SET archived_at = now() WHERE id = nb;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'T9 anon could UPDATE notifications.archived_at'; END IF;
  RAISE NOTICE 'PASS 137 T9 anon can neither read nor archive';

  -- ── T10 the CHECK: archived_at never precedes created_at ────────────────
  ok := false;
  BEGIN
    INSERT INTO public.notifications (user_id, actor_id, type, title, created_at, archived_at)
    VALUES (a, b, 'friend_accept', '137 fixture bad', now(), now() - interval '1 day');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T10 CHECK accepted archived_at before created_at on INSERT'; END IF;
  UPDATE public.notifications SET archived_at = now() WHERE id = nb;
  ok := false;
  BEGIN
    UPDATE public.notifications SET created_at = now() + interval '1 day' WHERE id = nb;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T10 CHECK accepted created_at moved past archived_at'; END IF;
  RAISE NOTICE 'PASS 137 T10 CHECK rejects archived_at < created_at';

  DELETE FROM public.notifications WHERE title LIKE '137 fixture%';
END $$;

-- ── T11–T19: clear and Undo as single-statement RPCs ──────────────────────
-- archive_notifications / unarchive_notifications replace the client's two
-- writes (archive, then mark read): those could half-apply, and could not
-- tell "nothing to clear" from "the write failed".
DO $$
DECLARE
  a uuid; b uuid;
  r1 uuid; r2 uuid; e1 uuid; l1 uuid; g1 uuid; rd uuid; bq uuid; barch uuid;
  t0 timestamptz := now();
  n int; c1 int; c2 int; i int;
  st text; msg text;
  got uuid[]; want uuid[]; ids500 uuid[]; ids501 uuid[];
  t_arch timestamptz; t_read timestamptz;
  sec boolean; cfg text[]; res text; args text;
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT id INTO a FROM public.profiles ORDER BY created_at, id LIMIT 1;
  SELECT id INTO b FROM public.profiles WHERE id <> a ORDER BY created_at, id LIMIT 1;

  -- a: r1 unread, r2 read an hour ago (both cleared by id); e1 old and unread
  -- (cleared by p_up_to); l1 arrived after her screen loaded and was read
  -- (must survive p_up_to); g1 cleared an hour ago; rd cleared, then deleted.
  -- b: bq in her inbox, barch cleared and read.
  DELETE FROM public.notifications WHERE title LIKE '137 rpc fixture%';
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at)
  VALUES (a, b, 'friend_accept', '137 rpc fixture r1', t0 - interval '2 hours') RETURNING id INTO r1;
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at, read_at)
  VALUES (a, b, 'friend_accept', '137 rpc fixture r2', t0 - interval '2 hours', t0 - interval '1 hour') RETURNING id INTO r2;
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at)
  VALUES (a, b, 'friend_accept', '137 rpc fixture e1', t0 - interval '3 hours') RETURNING id INTO e1;
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at, read_at)
  VALUES (a, b, 'friend_accept', '137 rpc fixture l1', t0 - interval '30 minutes', t0 - interval '20 minutes') RETURNING id INTO l1;
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at, archived_at)
  VALUES (a, b, 'friend_accept', '137 rpc fixture g1', t0 - interval '2 hours', t0 - interval '1 hour') RETURNING id INTO g1;
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at, archived_at)
  VALUES (a, b, 'friend_accept', '137 rpc fixture rd', t0 - interval '2 hours', t0 - interval '1 hour') RETURNING id INTO rd;
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at)
  VALUES (b, a, 'friend_accept', '137 rpc fixture bq', t0 - interval '3 hours') RETURNING id INTO bq;
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at, read_at, archived_at)
  VALUES (b, a, 'friend_accept', '137 rpc fixture barch', t0 - interval '2 hours', t0 - interval '1 hour', t0 - interval '1 hour') RETURNING id INTO barch;

  -- ── T11 shape: both RPCs exist, SECURITY INVOKER, search_path pinned, contract signatures ──
  IF to_regprocedure('public.archive_notifications(uuid[], timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'T11 public.archive_notifications(uuid[], timestamptz) does not exist';
  END IF;
  IF to_regprocedure('public.unarchive_notifications(uuid[], uuid[])') IS NULL THEN
    RAISE EXCEPTION 'T11 public.unarchive_notifications(uuid[], uuid[]) does not exist';
  END IF;
  SELECT p.prosecdef, p.proconfig, pg_get_function_result(p.oid), pg_get_function_arguments(p.oid)
    INTO sec, cfg, res, args
    FROM pg_proc p WHERE p.oid = 'public.archive_notifications(uuid[], timestamptz)'::regprocedure;
  IF sec OR cfg IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR res IS DISTINCT FROM 'TABLE(id uuid, was_unread boolean)'
     OR args IS DISTINCT FROM 'p_ids uuid[] DEFAULT NULL::uuid[], p_up_to timestamp with time zone DEFAULT NULL::timestamp with time zone' THEN
    RAISE EXCEPTION 'T11 archive_notifications: definer %, config %, returns %, args %', sec, cfg, res, args;
  END IF;
  SELECT p.prosecdef, p.proconfig, pg_get_function_result(p.oid), pg_get_function_arguments(p.oid)
    INTO sec, cfg, res, args
    FROM pg_proc p WHERE p.oid = 'public.unarchive_notifications(uuid[], uuid[])'::regprocedure;
  IF sec OR cfg IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR res IS DISTINCT FROM 'integer'
     OR args IS DISTINCT FROM 'p_ids uuid[], p_mark_unread uuid[] DEFAULT ''{}''::uuid[]' THEN
    RAISE EXCEPTION 'T11 unarchive_notifications: definer %, config %, returns %, args %', sec, cfg, res, args;
  END IF;
  RAISE NOTICE 'PASS 137 T11 shape: archive_notifications / unarchive_notifications are SECURITY INVOKER, search_path pinned, contract signatures';

  -- ── T12 clear by ids: one statement archives both, reports which were unread, keeps read_at ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE x.id = r1 AND x.was_unread), count(*) FILTER (WHERE x.id = r2 AND NOT x.was_unread)
    INTO n, c1, c2
    FROM public.archive_notifications(p_ids => ARRAY[r1, r2]) AS x;
  RESET ROLE;
  IF n <> 2 OR c1 <> 1 OR c2 <> 1 THEN
    RAISE EXCEPTION 'T12 archive by ids returned % rows (r1 as was_unread: %, r2 as was read: %)', n, c1, c2;
  END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE id IN (r1, r2) AND archived_at IS NOT NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'T12 % of r1, r2 archived, expected 2', n; END IF;
  SELECT read_at INTO t_read FROM public.notifications WHERE id = r1;
  IF t_read IS NULL THEN RAISE EXCEPTION 'T12 r1 was cleared but is still unread'; END IF;
  SELECT read_at INTO t_read FROM public.notifications WHERE id = r2;
  IF t_read IS DISTINCT FROM t0 - interval '1 hour' THEN
    RAISE EXCEPTION 'T12 clearing overwrote r2''s read_at: % (was %)', t_read, t0 - interval '1 hour';
  END IF;
  RAISE NOTICE 'PASS 137 T12 archive by ids: both archived and read in one statement, was_unread right, an existing read_at kept';

  -- ── T13 clear-all with p_up_to: a notification that arrived after her screen loaded stays ──
  SELECT array_agg(id ORDER BY id) INTO want FROM public.notifications
   WHERE user_id = a AND archived_at IS NULL AND created_at <= t0 - interval '90 minutes';
  SET LOCAL ROLE authenticated;
  SELECT array_agg(x.id ORDER BY x.id), count(*) FILTER (WHERE x.id = e1 AND x.was_unread)
    INTO got, c1
    FROM public.archive_notifications(p_up_to => t0 - interval '90 minutes') AS x;
  RESET ROLE;
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'T13 p_up_to archived % but her inbox up to then was %', got, want;
  END IF;
  IF c1 <> 1 THEN RAISE EXCEPTION 'T13 e1 (old, unread) was not archived as was_unread'; END IF;
  SELECT archived_at INTO t_arch FROM public.notifications WHERE id = l1;
  IF t_arch IS NOT NULL THEN RAISE EXCEPTION 'T13 l1, created after p_up_to, was archived'; END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = bq;
  IF t_arch IS NOT NULL OR t_read IS NOT NULL THEN
    RAISE EXCEPTION 'T13 a''s clear-all reached b''s notification: archived_at %, read_at %', t_arch, t_read;
  END IF;
  RAISE NOTICE 'PASS 137 T13 archive with p_up_to: her rows up to then, not the one that arrived later, not b''s';

  -- ── T14 nothing to clear is an empty result, not an error ───────────────
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.archive_notifications(p_ids => ARRAY[r1, g1, gen_random_uuid()]);
  SELECT count(*) INTO c1 FROM public.archive_notifications(p_up_to => t0 - interval '90 minutes');
  RESET ROLE;
  IF n <> 0 OR c1 <> 0 THEN
    RAISE EXCEPTION 'T14 already-archived / nonexistent returned % rows by id, % by p_up_to', n, c1;
  END IF;
  SELECT archived_at INTO t_arch FROM public.notifications WHERE id = g1;
  IF t_arch IS DISTINCT FROM t0 - interval '1 hour' THEN
    RAISE EXCEPTION 'T14 re-clearing g1 moved its archived_at to %', t_arch;
  END IF;
  RAISE NOTICE 'PASS 137 T14 already-archived and nonexistent ids return 0 rows, no error, archived_at untouched';

  -- ── T15 she can NOT clear or restore another member's rows through the RPCs ──
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.archive_notifications(p_ids => ARRAY[bq]);
  SELECT public.unarchive_notifications(ARRAY[barch], ARRAY[barch]) INTO c1;
  RESET ROLE;
  IF n <> 0 OR c1 <> 0 THEN
    RAISE EXCEPTION 'T15 a touched b''s rows: archived %, restored %', n, c1;
  END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = bq;
  IF t_arch IS NOT NULL OR t_read IS NOT NULL THEN
    RAISE EXCEPTION 'T15 b''s inbox row changed: archived_at %, read_at %', t_arch, t_read;
  END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = barch;
  IF t_arch IS DISTINCT FROM t0 - interval '1 hour' OR t_read IS DISTINCT FROM t0 - interval '1 hour' THEN
    RAISE EXCEPTION 'T15 b''s cleared row changed: archived_at %, read_at %', t_arch, t_read;
  END IF;
  RAISE NOTICE 'PASS 137 T15 she cannot archive or unarchive another member''s rows (re-read: unchanged)';

  -- ── T16 bad parameters are refused (22023), never guessed at ────────────
  SELECT array_agg(gen_random_uuid()) INTO ids501 FROM generate_series(1, 501);
  ids500 := ids501[1:500];
  SET LOCAL ROLE authenticated;
  FOR i IN 1..7 LOOP
    st := NULL; msg := NULL;
    BEGIN
      CASE i
        WHEN 1 THEN PERFORM * FROM public.archive_notifications();
        WHEN 2 THEN PERFORM * FROM public.archive_notifications(ARRAY[r1], t0);
        WHEN 3 THEN PERFORM * FROM public.archive_notifications(p_ids => ids501);
        WHEN 4 THEN PERFORM public.unarchive_notifications(NULL);
        WHEN 5 THEN PERFORM public.unarchive_notifications(ids501);
        WHEN 6 THEN PERFORM public.unarchive_notifications(ids500, ids500 || ids500[1]);
        WHEN 7 THEN PERFORM public.unarchive_notifications(ARRAY[r1], ARRAY[r1, r2]);
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    END;
    IF st IS DISTINCT FROM '22023'
       OR msg NOT LIKE (ARRAY['%exactly one of p_ids or p_up_to%', '%exactly one of p_ids or p_up_to%',
                              '%at most 500%', '%p_ids is required%', '%at most 500%', '%at most 500%',
                              '%p_mark_unread must be a subset of p_ids%'])[i] THEN
      RESET ROLE;
      RAISE EXCEPTION 'T16 case %: expected 22023, got % (%)', i, st, msg;
    END IF;
  END LOOP;
  RESET ROLE;
  RAISE NOTICE 'PASS 137 T16 both-null, both-set, >500 ids, null p_ids, >500 p_mark_unread and a non-subset p_mark_unread all raise 22023';

  -- ── T17 Undo: restores her cleared rows, unreads only p_mark_unread, counts what came back ──
  DELETE FROM public.notifications WHERE id = rd;
  SET LOCAL ROLE authenticated;
  SELECT public.unarchive_notifications(ARRAY[r1, r2, rd, l1], ARRAY[r1, l1]) INTO n;
  RESET ROLE;
  IF n <> 2 THEN
    RAISE EXCEPTION 'T17 unarchive returned %, expected 2 (r1, r2; rd was deleted, l1 never cleared)', n;
  END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = r1;
  IF t_arch IS NOT NULL OR t_read IS NOT NULL THEN
    RAISE EXCEPTION 'T17 r1 after Undo: archived_at %, read_at % (expected both NULL)', t_arch, t_read;
  END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = r2;
  IF t_arch IS NOT NULL OR t_read IS DISTINCT FROM t0 - interval '1 hour' THEN
    RAISE EXCEPTION 'T17 r2 after Undo: archived_at %, read_at % (expected NULL, %)', t_arch, t_read, t0 - interval '1 hour';
  END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = l1;
  IF t_arch IS NOT NULL OR t_read IS DISTINCT FROM t0 - interval '20 minutes' THEN
    RAISE EXCEPTION 'T17 l1 (never cleared) was changed by Undo: archived_at %, read_at %', t_arch, t_read;
  END IF;
  SELECT archived_at INTO t_arch FROM public.notifications WHERE id = e1;
  IF t_arch IS NULL THEN RAISE EXCEPTION 'T17 e1 was restored though it was not in p_ids'; END IF;
  RAISE NOTICE 'PASS 137 T17 unarchive restores her rows, resets read_at only for p_mark_unread, returns 2 (deleted row not counted)';

  -- ── T18 mark-read on a cleared row leaves archived_at alone ─────────────
  SET LOCAL ROLE authenticated;
  UPDATE public.notifications SET read_at = now() WHERE id = g1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'T18 mark-read on a cleared row changed % rows', n; END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = g1;
  IF t_arch IS DISTINCT FROM t0 - interval '1 hour' OR t_read IS DISTINCT FROM t0 THEN
    RAISE EXCEPTION 'T18 mark-read on a cleared row: archived_at % (was %), read_at %', t_arch, t0 - interval '1 hour', t_read;
  END IF;
  RAISE NOTICE 'PASS 137 T18 a plain UPDATE of read_at on an archived row leaves archived_at unchanged';

  -- ── T19 anon (and PUBLIC) cannot EXECUTE either RPC; members can ────────
  IF has_function_privilege('anon', 'public.archive_notifications(uuid[], timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.unarchive_notifications(uuid[], uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'T19 anon can EXECUTE archive_notifications / unarchive_notifications';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.archive_notifications(uuid[], timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.unarchive_notifications(uuid[], uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'T19 members cannot EXECUTE archive_notifications / unarchive_notifications';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid IN ('public.archive_notifications(uuid[], timestamptz)'::regprocedure,
                    'public.unarchive_notifications(uuid[], uuid[])'::regprocedure)
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'T19 PUBLIC holds EXECUTE on archive_notifications / unarchive_notifications';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  FOR i IN 1..2 LOOP
    st := NULL; msg := NULL;
    BEGIN
      IF i = 1 THEN PERFORM * FROM public.archive_notifications(p_ids => ARRAY[bq]);
      ELSE PERFORM public.unarchive_notifications(ARRAY[barch]);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    END;
    IF st IS DISTINCT FROM '42501' OR msg NOT LIKE 'permission denied for function%' THEN
      RESET ROLE;
      RAISE EXCEPTION 'T19 anon call % was not refused EXECUTE: % (%)', i, st, msg;
    END IF;
  END LOOP;
  RESET ROLE;
  RAISE NOTICE 'PASS 137 T19 anon and PUBLIC cannot EXECUTE either RPC; members can';

  DELETE FROM public.notifications WHERE title LIKE '137 rpc fixture%';
END $$;

-- ── T20–T21: Clear all goes 500 at a time, newest first, p_up_to inclusive ──
-- One reply holds at most 500 rows: config.toml's max_rows = 1000 would cut a
-- longer reply short (the client would never learn those ids, so Undo could
-- not bring them back), and Undo restores at most 500 per call. The client
-- calls again with the same p_up_to until a call returns fewer than 500.
DO $$
DECLARE
  a uuid; b uuid;
  base timestamptz := now() - interval '400 days';
  up_to timestamptz;
  edge uuid; late uuid; bq uuid;
  want uuid[]; got uuid[];
  n int; c1 int; held int;
  t_arch timestamptz; t_read timestamptz;
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT id INTO a FROM public.profiles ORDER BY created_at, id LIMIT 1;
  SELECT id INTO b FROM public.profiles WHERE id <> a ORDER BY created_at, id LIMIT 1;

  -- a: 502 a second apart, then `edge` — the newest on her screen, whose
  -- created_at the client sends as p_up_to, microseconds and all — then `late`,
  -- one microsecond newer (arrived after the screen loaded). b: one in the window.
  up_to := base + interval '503 seconds';
  DELETE FROM public.notifications WHERE title LIKE '137 batch fixture%';
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at)
  SELECT a, b, 'friend_accept', '137 batch fixture', base + make_interval(secs => g)
    FROM generate_series(1, 502) AS g;
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at)
  VALUES (a, b, 'friend_accept', '137 batch fixture edge', up_to) RETURNING id INTO edge;
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at)
  VALUES (a, b, 'friend_accept', '137 batch fixture late', up_to + interval '1 microsecond') RETURNING id INTO late;
  INSERT INTO public.notifications (user_id, actor_id, type, title, created_at)
  VALUES (b, a, 'friend_accept', '137 batch fixture b', up_to - interval '1 second') RETURNING id INTO bq;

  -- Her inbox up to p_up_to (503 fixtures, plus any older row the local db holds).
  SELECT count(*) INTO held FROM public.notifications
   WHERE user_id = a AND archived_at IS NULL AND created_at <= up_to;
  SELECT array_agg(id ORDER BY id) INTO want FROM (
    SELECT id FROM public.notifications
     WHERE user_id = a AND archived_at IS NULL AND created_at <= up_to
     ORDER BY created_at DESC, id
     LIMIT 500
  ) newest;

  -- ── T20 one call archives exactly her 500 newest; the next call the rest ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(x.id ORDER BY x.id), count(*) FILTER (WHERE x.id = edge)
    INTO got, c1
    FROM public.archive_notifications(p_up_to => up_to) AS x;
  RESET ROLE;
  -- T21 first: the boundary is the one thing a `<` instead of `<=` would break.
  IF c1 <> 1 THEN
    RAISE EXCEPTION 'T21 edge (created_at = p_up_to, the newest on her screen) was not in the first call';
  END IF;
  IF cardinality(got) IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'T20 one Clear all call archived % rows, expected exactly 500 (her inbox up to p_up_to held %)', cardinality(got), held;
  END IF;
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'T20 the first call did not archive her 500 newest rows up to p_up_to';
  END IF;
  SELECT count(*) INTO n FROM public.notifications
   WHERE user_id = a AND archived_at IS NOT NULL AND title LIKE '137 batch fixture%';
  IF n <> 500 THEN RAISE EXCEPTION 'T20 % of her batch rows are archived after one call, expected 500', n; END IF;

  SELECT array_agg(id ORDER BY id) INTO want FROM public.notifications
   WHERE user_id = a AND archived_at IS NULL AND created_at <= up_to;
  SET LOCAL ROLE authenticated;
  SELECT array_agg(x.id ORDER BY x.id) INTO got FROM public.archive_notifications(p_up_to => up_to) AS x;
  SELECT count(*) INTO n FROM public.archive_notifications(p_up_to => up_to);
  RESET ROLE;
  IF got IS DISTINCT FROM want OR cardinality(got) >= 500 THEN
    RAISE EXCEPTION 'T20 the second call archived % rows, expected the % left (fewer than 500, so the client stops)', cardinality(got), cardinality(want);
  END IF;
  IF n <> 0 THEN RAISE EXCEPTION 'T20 a third call archived % rows, expected 0', n; END IF;
  SELECT count(*) INTO n FROM public.notifications
   WHERE user_id = a AND archived_at IS NULL AND created_at <= up_to;
  IF n <> 0 THEN RAISE EXCEPTION 'T20 % of her rows up to p_up_to are still in her inbox after the calls', n; END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = late;
  IF t_arch IS NOT NULL OR t_read IS NOT NULL THEN
    RAISE EXCEPTION 'T20 late, a microsecond newer than p_up_to, was touched: archived_at %, read_at %', t_arch, t_read;
  END IF;
  SELECT archived_at, read_at INTO t_arch, t_read FROM public.notifications WHERE id = bq;
  IF t_arch IS NOT NULL OR t_read IS NOT NULL THEN
    RAISE EXCEPTION 'T20 a''s Clear all reached b''s notification: archived_at %, read_at %', t_arch, t_read;
  END IF;
  RAISE NOTICE 'PASS 137 T20 p_up_to archives at most 500 per call, her newest first; the next call takes the rest; nothing newer, nothing of b''s';

  -- ── T21 p_up_to is inclusive: the row the client took it from is cleared ──
  -- (its first-call membership is asserted right after that call, above)
  SELECT archived_at INTO t_arch FROM public.notifications WHERE id = edge;
  IF t_arch IS NULL THEN RAISE EXCEPTION 'T21 edge (created_at = p_up_to) is still in her inbox'; END IF;
  RAISE NOTICE 'PASS 137 T21 the row whose created_at IS p_up_to is cleared; one a microsecond newer is not';

  DELETE FROM public.notifications WHERE title LIKE '137 batch fixture%';
END $$;

-- Leave no identity behind for a stacked check: auth.uid() reads claim.sub
-- first, then claims.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
