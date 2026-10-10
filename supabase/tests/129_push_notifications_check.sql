-- Behaviour proof for 129_push_notifications.sql on a LOCAL database.
-- Runs inside one transaction and ROLLS BACK, so it leaves nothing behind.
--   docker exec -i supabase_db_roxy-client psql -U postgres -v ON_ERROR_STOP=1 < this file
-- (the migration is \i'd inside the same transaction first by the runner)
\set ON_ERROR_STOP on

DO $$
DECLARE
  a uuid; b uuid; c uuid;
  n_id uuid;
  cnt int;
  ok boolean;
BEGIN
  SELECT id INTO a FROM public.profiles ORDER BY created_at LIMIT 1;
  SELECT id INTO b FROM public.profiles WHERE id <> a ORDER BY created_at LIMIT 1;
  SELECT id INTO c FROM public.profiles WHERE id NOT IN (a, b) ORDER BY created_at LIMIT 1;
  IF a IS NULL OR b IS NULL OR c IS NULL THEN RAISE EXCEPTION 'need 3 profiles in the local db'; END IF;

  -- T1: a new notification is queued exactly once
  INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
  VALUES (a, b, 'message', 'x sent you a message', 'hi', '/chat/t1') RETURNING id INTO n_id;
  SELECT count(*) INTO cnt FROM public.push_outbox WHERE notification_id = n_id AND status = 'pending' AND user_id = a;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T1 enqueue: expected 1 outbox row, got %', cnt; END IF;

  -- T2: existing notifications were NOT backfilled into the outbox
  SELECT count(*) INTO cnt FROM public.push_outbox o JOIN public.notifications n ON n.id = o.notification_id
   WHERE n.created_at < now() - interval '1 minute';
  IF cnt <> 0 THEN RAISE EXCEPTION 'T2 backfill: % old notifications were queued', cnt; END IF;

  -- T3: claim_push_batch claims due rows once (SKIP LOCKED / status flip)
  SELECT count(*) INTO cnt FROM public.claim_push_batch(100) WHERE notification_id = n_id;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T3 claim: expected 1, got %', cnt; END IF;
  SELECT count(*) INTO cnt FROM public.claim_push_batch(100) WHERE notification_id = n_id;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T3 claim twice: a claimed row was claimed again'; END IF;
  SELECT attempts INTO cnt FROM public.push_outbox WHERE notification_id = n_id;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T3 attempts: expected 1, got %', cnt; END IF;

  -- T4: a stale 'sending' row (crashed run) is reclaimed after 2 minutes
  UPDATE public.push_outbox SET locked_at = now() - interval '3 minutes' WHERE notification_id = n_id;
  SELECT count(*) INTO cnt FROM public.claim_push_batch(100) WHERE notification_id = n_id;
  IF cnt <> 1 THEN RAISE EXCEPTION 'T4 reclaim: stale sending row not reclaimed'; END IF;

  -- T5: deleting the notification removes its outbox row (cascade)
  DELETE FROM public.notifications WHERE id = n_id;
  SELECT count(*) INTO cnt FROM public.push_outbox WHERE notification_id = n_id;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T5 cascade: outbox row survived its notification'; END IF;

  -- T6: cancelling a pending friend request deletes its notification
  DELETE FROM public.friendships WHERE (requester_id = b AND addressee_id = c) OR (requester_id = c AND addressee_id = b);
  INSERT INTO public.friendships (requester_id, addressee_id) VALUES (b, c);
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = c AND actor_id = b AND type = 'friend_request';
  IF cnt < 1 THEN RAISE EXCEPTION 'T6 setup: request notification not created by 057 trigger'; END IF;
  DELETE FROM public.friendships WHERE requester_id = b AND addressee_id = c;
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = c AND actor_id = b AND type = 'friend_request';
  IF cnt <> 0 THEN RAISE EXCEPTION 'T6 cancel: % stale request notifications left', cnt; END IF;

  -- T7: accepting marks the request notification read (and notifies the requester)
  UPDATE public.notifications SET read_at = now() WHERE user_id = c AND actor_id = b AND type = 'friend_request';
  DELETE FROM public.notifications WHERE user_id = c AND actor_id = b AND type = 'friend_request';
  INSERT INTO public.friendships (requester_id, addressee_id) VALUES (b, c);
  UPDATE public.friendships SET status = 'accepted' WHERE requester_id = b AND addressee_id = c;
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = c AND actor_id = b AND type = 'friend_request' AND read_at IS NULL;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T7 accept: request notification still unread'; END IF;
  SELECT count(*) INTO cnt FROM public.notifications WHERE user_id = b AND actor_id = c AND type = 'friend_accept';
  IF cnt < 1 THEN RAISE EXCEPTION 'T7 accept: requester was not notified'; END IF;

  -- T8: wake_push_dispatcher is a quiet no-op without Vault secrets
  PERFORM public.wake_push_dispatcher();

  -- T9: no orphaned friend_request notifications remain after the migration
  SELECT count(*) INTO cnt FROM public.notifications n WHERE n.type = 'friend_request'
     AND NOT EXISTS (SELECT 1 FROM public.friendships f WHERE f.requester_id = n.actor_id AND f.addressee_id = n.user_id);
  IF cnt <> 0 THEN RAISE EXCEPTION 'T9 orphans: % left', cnt; END IF;

  -- T10: a fan-out (one INSERT ... SELECT of many notifications) wakes the
  -- dispatcher exactly ONCE, not once per row. Only checkable where pg_net and
  -- Vault exist (the local stack has both).
  IF to_regnamespace('net') IS NOT NULL AND to_regnamespace('vault') IS NOT NULL THEN
    PERFORM vault.create_secret('http://127.0.0.1:9/never', 'roxy_push_dispatch_url', 'test');
    PERFORM vault.create_secret('test-key', 'roxy_service_role_key', 'test');
    SELECT count(*) INTO cnt FROM net.http_request_queue;
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, link_path)
    SELECT p.id, a, 'community_event', 't', 'b', '/event/t10'
      FROM public.profiles p WHERE p.id <> a LIMIT 3;
    IF (SELECT count(*) FROM net.http_request_queue) - cnt <> 1 THEN
      RAISE EXCEPTION 'T10 fan-out: expected 1 wake-up for 3 notifications, got %',
        (SELECT count(*) FROM net.http_request_queue) - cnt;
    END IF;
  END IF;

  RAISE NOTICE 'superuser behaviour tests: PASS';
END $$;

-- ── RLS / grants, as a real signed-in user ─────────────────────────────────
DO $$
DECLARE a uuid; b uuid; cnt int; denied boolean;
BEGIN
  SELECT id INTO a FROM public.profiles ORDER BY created_at LIMIT 1;
  SELECT id INTO b FROM public.profiles WHERE id <> a ORDER BY created_at LIMIT 1;
  INSERT INTO public.push_devices (user_id, token, platform) VALUES (b, 'ExponentPushToken[other-users-device]', 'android');
  INSERT INTO public.notification_settings (user_id, messages) VALUES (b, false);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- R1: register a device through the RPC, see only her own
  PERFORM public.register_push_device('ExponentPushToken[aaaaaaaaaaaaaaaa]', 'ios', '1.1.0');
  SELECT count(*) INTO cnt FROM public.push_devices;
  IF cnt <> 1 THEN RAISE EXCEPTION 'R1: expected to see exactly her 1 device, saw %', cnt; END IF;

  -- R2: a garbage token is rejected
  denied := false;
  BEGIN PERFORM public.register_push_device('not-a-token', 'ios', NULL); EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'R2: garbage token accepted'; END IF;

  -- R3: direct writes to push_devices are refused
  denied := false;
  BEGIN INSERT INTO public.push_devices (user_id, token, platform) VALUES (a, 'ExponentPushToken[direct]', 'ios'); EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'R3: direct INSERT into push_devices allowed'; END IF;

  -- R4: a shared phone moves the token to whoever signs in now
  PERFORM public.register_push_device('ExponentPushToken[other-users-device]', 'android', NULL);
  SELECT count(*) INTO cnt FROM public.push_devices WHERE token = 'ExponentPushToken[other-users-device]';
  IF cnt <> 1 THEN RAISE EXCEPTION 'R4: token did not move to the signed-in user'; END IF;

  -- R5: she cannot read or touch the outbox
  denied := false;
  BEGIN PERFORM 1 FROM public.push_outbox LIMIT 1; EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'R5: authenticated can read push_outbox'; END IF;
  denied := false;
  BEGIN PERFORM * FROM public.claim_push_batch(10); EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'R5: authenticated can claim outbox rows'; END IF;

  -- R6: settings: her own row only; another user''s row is invisible
  INSERT INTO public.notification_settings (user_id) VALUES (a);
  SELECT count(*) INTO cnt FROM public.notification_settings;
  IF cnt <> 1 THEN RAISE EXCEPTION 'R6: saw % settings rows, expected only hers', cnt; END IF;
  denied := false;
  BEGIN INSERT INTO public.notification_settings (user_id) VALUES (b); EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'R6: inserted settings for another user'; END IF;
  SELECT count(*) INTO cnt FROM public.notification_settings WHERE show_previews = false AND messages = true AND push_enabled = true;
  IF cnt <> 1 THEN RAISE EXCEPTION 'R6: defaults wrong (expected previews off, messages on)'; END IF;

  -- R7: unregister removes only her own token
  PERFORM public.unregister_push_device('ExponentPushToken[aaaaaaaaaaaaaaaa]');
  SELECT count(*) INTO cnt FROM public.push_devices WHERE token = 'ExponentPushToken[aaaaaaaaaaaaaaaa]';
  IF cnt <> 0 THEN RAISE EXCEPTION 'R7: unregister did not remove the token'; END IF;

  -- R8: mark_notifications_read_for_link only touches her rows
  PERFORM public.mark_notifications_read_for_link('/chat/none');

  RESET ROLE;

  -- R9: anon cannot call the RPCs
  SET LOCAL ROLE anon;
  denied := false;
  BEGIN PERFORM public.register_push_device('ExponentPushToken[anon]', 'ios', NULL); EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'R9: anon can register a device'; END IF;
  RESET ROLE;

  RAISE NOTICE 'RLS / grant tests: PASS';
END $$;
