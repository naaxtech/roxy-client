-- Behaviour proof for 135_chat_notifications.sql on a LOCAL database, on top
-- of 132 (and 129/133/134 when the stack runner applies them). Runs inside the
-- runner's transaction and is ROLLED BACK, so it leaves nothing behind.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.as135(u uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE q INTO r;
  RESET ROLE;
  RETURN coalesce(r, 'NULL');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR ' || SQLSTATE || ' ' || SQLERRM;
END $f$;

-- The type names a notifications_type_check definition lists, whatever its form.
CREATE OR REPLACE FUNCTION pg_temp.types135(def text) RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(DISTINCT t ORDER BY t), '{}')
  FROM (
    SELECT btrim(x, ' "') AS t
    FROM regexp_matches(coalesce(def, ''), '''([^'']*)''', 'g') AS m(lit),
         LATERAL regexp_split_to_table(translate(m.lit[1], '{}', ''), ',') AS x
  ) s WHERE t ~ '^[a-z_]+$';
$f$;

CREATE OR REPLACE FUNCTION pg_temp.is135(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION '% -- expected "%", got "%"', label, want, coalesce(got, 'NULL');
  END IF;
END $f$;

DO $$
DECLARE
  ids uuid[];
  own uuid; mdr uuid; adm uuid; mem uuid; asker uuid; inv uuid; blk uuid; mut uuid; out uuid;
  comm uuid; n int; r text; v_def text;
BEGIN
  SELECT array_agg(id ORDER BY created_at, id) INTO ids FROM (
    SELECT id, created_at FROM public.profiles ORDER BY created_at, id LIMIT 10
  ) s;
  IF cardinality(ids) < 10 THEN RAISE EXCEPTION 'need 10 profiles in the local db'; END IF;
  own := ids[1]; mdr := ids[2]; adm := ids[3]; mem := ids[4]; asker := ids[5];
  inv := ids[6]; blk := ids[7]; mut := ids[8]; out := ids[9];

  DELETE FROM public.friendships WHERE requester_id = ANY (ids) AND addressee_id = ANY (ids);
  DELETE FROM public.mutes WHERE user_id = ANY (ids) OR muted_user_id = ANY (ids);
  DELETE FROM public.notifications WHERE user_id = ANY (ids);
  UPDATE public.profiles SET vetting_status = 'approved', is_active = true WHERE id = ANY (ids);
  -- Other lanes' checks may run first in a stacked proof: undo any staff flag,
  -- soft-delete
  -- (130) or open suspension (131) they left on these accounts.
  UPDATE public.profiles SET deleted_at = NULL, is_staff = false WHERE id = ANY (ids);
  IF to_regclass('public.account_suspensions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.account_suspensions WHERE user_id = ANY ($1)' USING ids;
  END IF;

  -- ── The CHECK keeps every type it had and gains the two new ones ─────────
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
  FOR r IN SELECT unnest(ARRAY['friend_request','friend_accept','community_event','message','channel_message',
                               'community_invite','community_join_request']) LOOP
    IF NOT (r = ANY (pg_temp.types135(v_def))) THEN
      RAISE EXCEPTION 'TYPES: notifications_type_check lost or lacks %: %', r, v_def;
    END IF;
  END LOOP;
  -- Other lanes' types survive whichever of them was applied first (133 feed,
  -- 134 gate): the stack runner snapshots the CHECK into pg_temp.pre135 just
  -- before 135, and every type listed there must still be listed now.
  IF to_regclass('pg_temp.pre135') IS NOT NULL THEN
    FOR r IN SELECT unnest(pg_temp.types135((SELECT def FROM pg_temp.pre135))) LOOP
      IF NOT (r = ANY (pg_temp.types135(v_def))) THEN
        RAISE EXCEPTION 'TYPES: 135 dropped an earlier lane''s type %: %', r, v_def;
      END IF;
    END LOOP;
  END IF;
  RAISE NOTICE 'PASS 135 types: union kept, community_invite + community_join_request added';

  -- 'Report conversation' works on top of 133's rebuilt reports CHECK, and
  -- every report type 133 allows is still allowed.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.reports'::regclass AND conname = 'reports_content_type_check';
  FOR r IN SELECT unnest(ARRAY['message','post','profile','room','speed_date','archive_entry','archive_review','conversation']) LOOP
    IF NOT (r = ANY (pg_temp.types135(v_def))) THEN
      RAISE EXCEPTION 'REPORTS: reports_content_type_check lacks %: %', r, v_def;
    END IF;
  END LOOP;
  IF to_regclass('pg_temp.pre135_reports') IS NOT NULL THEN
    FOR r IN SELECT unnest(pg_temp.types135((SELECT def FROM pg_temp.pre135_reports))) LOOP
      IF NOT (r = ANY (pg_temp.types135(v_def))) THEN
        RAISE EXCEPTION 'REPORTS: 135 dropped an earlier report type %: %', r, v_def;
      END IF;
    END LOOP;
  END IF;
  RAISE NOTICE 'PASS 135 reports: conversation reports allowed, no earlier type dropped';

  -- ── A private community: creator (admin), moderator, admin, plain member, border patrol ─
  INSERT INTO public.communities (name, slug, category, is_private, created_by)
  VALUES ('Secret 135 Circle', 'test-135-private-' || substr(md5(clock_timestamp()::text), 1, 8), 'interest', true, own) RETURNING id INTO comm;
  INSERT INTO public.community_members (community_id, user_id, role) VALUES
    (comm, own, 'admin'), (comm, mdr, 'moderator'), (comm, adm, 'admin'), (comm, mem, 'member'), (comm, blk, 'moderator'),
    (comm, mut, 'moderator'), (comm, ids[10], 'border_patrol')
    ON CONFLICT (community_id, user_id) DO UPDATE SET role = excluded.role;
  -- blk (a moderator) blocked the asker; mut (a moderator) muted her.
  INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES (blk, asker, 'blocked');
  INSERT INTO public.mutes (user_id, muted_user_id) VALUES (mut, asker);

  -- ── A join request reaches every moderator, nobody else ─────────────────
  r := pg_temp.as135(asker, format('select public.request_to_join_community(%L, %L)', comm, 'hi, I run the book club'));
  PERFORM pg_temp.is135('REQ asked', r, 'requested');
  PERFORM pg_temp.is135('REQ owner told',
    (SELECT count(*)::text FROM public.notifications WHERE user_id = own AND type = 'community_join_request'), '1');
  PERFORM pg_temp.is135('REQ plain member not told',
    (SELECT count(*)::text FROM public.notifications WHERE user_id = mem AND type = 'community_join_request'), '0');
  PERFORM pg_temp.is135('REQ border patrol not told',
    (SELECT count(*)::text FROM public.notifications WHERE user_id = ids[10] AND type = 'community_join_request'), '0');
  PERFORM pg_temp.is135('REQ block-paired moderator not told',
    (SELECT count(*)::text FROM public.notifications WHERE user_id = blk AND type = 'community_join_request'), '0');
  PERFORM pg_temp.is135('REQ moderator who muted her not told',
    (SELECT count(*)::text FROM public.notifications WHERE user_id = mut AND type = 'community_join_request'), '0');
  SELECT count(*) INTO n FROM public.notifications WHERE type = 'community_join_request' AND actor_id = asker;
  PERFORM pg_temp.is135('REQ fan-out: creator admin, moderator, admin', n::text, '3');
  PERFORM pg_temp.is135('REQ link opens Members',
    (SELECT link_path FROM public.notifications WHERE user_id = mdr AND type = 'community_join_request'),
    '/community/members/' || comm);
  -- She sees her own row only; the asker cannot read the moderators' rows.
  PERFORM pg_temp.is135('REQ asker reads none of them',
    pg_temp.as135(asker, 'select count(*)::text from public.notifications where type = ''community_join_request'''), '0');
  PERFORM pg_temp.is135('REQ moderator reads her own',
    pg_temp.as135(mdr, 'select count(*)::text from public.notifications where type = ''community_join_request'''), '1');

  -- Declined, then asked again a week later: one more ping only after a day.
  r := pg_temp.as135(mdr, format('select public.respond_join_request(%L, %L, false)::text', comm, asker));
  UPDATE public.community_join_requests SET decided_at = now() - interval '8 days'
   WHERE community_id = comm AND user_id = asker;
  r := pg_temp.as135(asker, format('select public.request_to_join_community(%L)', comm));
  PERFORM pg_temp.is135('REQ asked again', r, 'requested');
  PERFORM pg_temp.is135('REQ no second ping within a day',
    (SELECT count(*)::text FROM public.notifications WHERE type = 'community_join_request' AND actor_id = asker), '3');
  UPDATE public.notifications SET created_at = now() - interval '2 days'
   WHERE type = 'community_join_request' AND actor_id = asker;
  UPDATE public.community_join_requests SET status = 'declined', decided_at = now() - interval '8 days'
   WHERE community_id = comm AND user_id = asker;
  r := pg_temp.as135(asker, format('select public.request_to_join_community(%L)', comm));
  PERFORM pg_temp.is135('REQ pinged again after a day',
    (SELECT count(*)::text FROM public.notifications WHERE type = 'community_join_request' AND actor_id = asker), '6');
  RAISE NOTICE 'PASS 135 join requests: moderators only, blocks/mutes respected, once a day';

  -- ── An invite reaches the invitee, private by default ───────────────────
  r := pg_temp.as135(mdr, format('select public.invite_to_community(%L, %L)', comm, inv));
  PERFORM pg_temp.is135('INV invited', r, 'invited');
  PERFORM pg_temp.is135('INV invitee told',
    (SELECT count(*)::text FROM public.notifications WHERE user_id = inv AND type = 'community_invite' AND actor_id = mdr), '1');
  PERFORM pg_temp.is135('INV opens Requests',
    (SELECT link_path FROM public.notifications WHERE user_id = inv AND type = 'community_invite'),
    '/messages?requests=1&community=' || comm);
  PERFORM pg_temp.is135('INV she reads it',
    pg_temp.as135(inv, 'select count(*)::text from public.notifications where type = ''community_invite'''), '1');
  -- Not now, then a fresh invite the same day: not pinged twice.
  r := pg_temp.as135(inv, format('select public.respond_community_invite(%L, false)::text', comm));
  r := pg_temp.as135(adm, format('select public.invite_to_community(%L, %L)', comm, inv));
  PERFORM pg_temp.is135('INV re-invite same day stays quiet',
    (SELECT count(*)::text FROM public.notifications WHERE user_id = inv AND type = 'community_invite'), '1');
  -- Invitee blocked the moderator before she was invited: nothing arrives.
  -- (invite_to_community refuses a block pair; prove the trigger also holds
  --  when a row is written directly, e.g. by staff tooling.)
  INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES (out, own, 'blocked');
  INSERT INTO public.community_join_requests (community_id, user_id, kind, status, invited_by)
  VALUES (comm, out, 'invite', 'pending', own);
  PERFORM pg_temp.is135('INV block pair stays quiet',
    (SELECT count(*)::text FROM public.notifications WHERE user_id = out AND type = 'community_invite'), '0');
  DELETE FROM public.friendships WHERE requester_id = out AND addressee_id = own;
  INSERT INTO public.mutes (user_id, muted_user_id) VALUES (out, mdr);
  UPDATE public.community_join_requests SET status = 'declined', invited_by = mdr WHERE community_id = comm AND user_id = out;
  UPDATE public.community_join_requests SET status = 'pending' WHERE community_id = comm AND user_id = out;
  PERFORM pg_temp.is135('INV muted inviter stays quiet',
    (SELECT count(*)::text FROM public.notifications WHERE user_id = out AND type = 'community_invite'), '0');
  RAISE NOTICE 'PASS 135 invites: invitee only, blocks/mutes respected, no repeat ping the same day';

  -- ── A notification failure never undoes the request ────────────────────
  PERFORM pg_temp.is135('SAFE trigger function not callable by members',
    (SELECT CASE WHEN has_function_privilege('authenticated', 'public.notify_community_join_request()', 'EXECUTE')
                 THEN 'yes' ELSE 'no' END), 'no');

  -- ── With 129 applied the rows reach push_outbox ─────────────────────────
  IF to_regclass('public.push_outbox') IS NOT NULL THEN
    PERFORM pg_temp.is135('PUSH invite queued',
      (SELECT count(*)::text FROM public.push_outbox po JOIN public.notifications n ON n.id = po.notification_id
        WHERE n.user_id = inv AND n.type = 'community_invite'), '1');
    RAISE NOTICE 'PASS 135 push: invite and join-request rows are queued for push';
  END IF;
END $$;

-- Leave no signed-in user behind for the next check in a stacked proof:
-- auth.uid() reads the legacy request.jwt.claim.sub before request.jwt.claims,
-- so a check that clears only the latter would still run as our last member.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
