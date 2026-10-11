-- Behaviour proof for 132_private_groups_and_requests.sql on a LOCAL database.
-- Runs inside the migration's transaction and is ROLLED BACK by the runner
-- (migration-proof.cjs), so it leaves nothing behind.
\set ON_ERROR_STOP on

-- Run one statement as a signed-in member. Returns 'ok <rows>' or 'ERR <sqlstate> <message>'.
CREATE FUNCTION pg_temp.as_exec(u uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE q;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  RETURN 'ok ' || n;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR ' || SQLSTATE || ' ' || SQLERRM;
END $f$;

-- Same, for a statement that returns one value.
CREATE FUNCTION pg_temp.as_val(u uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE q INTO r;
  RESET ROLE;
  RETURN r;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR ' || SQLSTATE || ' ' || SQLERRM;
END $f$;

CREATE FUNCTION pg_temp.expect(label text, got text, want_prefix text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF got IS NULL OR got NOT LIKE want_prefix || '%' THEN
    RAISE EXCEPTION '% -- expected "%", got "%"', label, want_prefix, coalesce(got, 'NULL');
  END IF;
END $f$;

DO $$
DECLARE
  a uuid; b uuid; c uuid; d uuid; e uuid; f uuid; p uuid;
  ids uuid[];
  conv_ab uuid; conv_eb uuid; conv_ef uuid; conv_ec uuid; conv_pa uuid; conv_legacy uuid;
  g uuid; g2 uuid; g3 uuid;
  m1 uuid; m2 uuid; m_other uuid;
  r text; n int; i int;
  comm_pub uuid; comm_priv uuid; chan uuid; chan_priv uuid; cm uuid;
  giphy text := 'https://media2.giphy.com/media/abc123XYZ/200w.gif';
BEGIN
  SELECT array_agg(id ORDER BY created_at, id) INTO ids FROM (
    SELECT id, created_at FROM public.profiles ORDER BY created_at, id LIMIT 7
  ) s;
  IF cardinality(ids) < 7 THEN RAISE EXCEPTION 'need 7 profiles in the local db'; END IF;
  a := ids[1]; b := ids[2]; c := ids[3]; d := ids[4]; e := ids[5]; f := ids[6]; p := ids[7];

  -- A clean slate between these seven (rolled back at the end).
  DELETE FROM public.friendships WHERE requester_id = ANY (ids) AND addressee_id = ANY (ids);
  DELETE FROM public.conversations WHERE participant_ids && ids;
  DELETE FROM public.chat_settings WHERE user_id = ANY (ids);
  UPDATE public.profiles SET vetting_status = 'approved', is_active = true, dm_permission = 'everyone' WHERE id = ANY (ids);
  UPDATE public.profiles SET dm_permission = 'friends' WHERE id = d;
  INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES
    (a, b, 'accepted'), (a, c, 'accepted'), (a, d, 'accepted'), (b, c, 'accepted'), (b, d, 'accepted');

  -- ── Backfill: every direct thread has a member row per (existing) participant
  SELECT count(*) INTO n FROM public.conversations cv
   WHERE cv.conversation_type = 'direct'
     AND (SELECT count(*) FROM public.conversation_members cm WHERE cm.conversation_id = cv.id)
       < (SELECT count(*) FROM unnest(cv.participant_ids) x JOIN public.profiles pr ON pr.id = x);
  IF n <> 0 THEN RAISE EXCEPTION 'BACKFILL: % direct conversations are missing member rows', n; END IF;
  RAISE NOTICE 'PASS backfill: every direct conversation has its member rows';

  -- ── G-05 friendships ────────────────────────────────────────────────────
  PERFORM pg_temp.expect('G05 forge accepted',
    pg_temp.as_exec(e, format('insert into public.friendships (requester_id, addressee_id, status) values (%L, %L, %L)', e, a, 'accepted')),
    'ERR 42501');
  PERFORM pg_temp.expect('G05 forge as someone else',
    pg_temp.as_exec(e, format('insert into public.friendships (requester_id, addressee_id) values (%L, %L)', f, a)),
    'ERR 42501');
  PERFORM pg_temp.expect('G05 pending request',
    pg_temp.as_exec(e, format('insert into public.friendships (requester_id, addressee_id) values (%L, %L)', e, a)), 'ok 1');
  PERFORM pg_temp.expect('G05 requester self-accept',
    pg_temp.as_exec(e, format('update public.friendships set status = %L where requester_id = %L and addressee_id = %L', 'accepted', e, a)),
    'ok 0');
  PERFORM pg_temp.expect('G05 block',
    pg_temp.as_exec(a, format('select public.block_user(%L)', e)), 'ok');
  PERFORM pg_temp.expect('G05 blocked user deletes the block',
    pg_temp.as_exec(e, format('delete from public.friendships where requester_id = %L and addressee_id = %L', a, e)), 'ok 0');
  PERFORM pg_temp.expect('G05 blocked user flips the block',
    pg_temp.as_exec(e, format('update public.friendships set status = %L where requester_id = %L and addressee_id = %L', 'accepted', a, e)),
    'ok 0');
  PERFORM pg_temp.expect('G05 blocked user sees the block row',
    pg_temp.as_val(e, format('select count(*)::text from public.friendships where requester_id = %L and addressee_id = %L', a, e)), '0');
  PERFORM pg_temp.expect('G05 blocked user re-requests',
    pg_temp.as_exec(e, format('insert into public.friendships (requester_id, addressee_id) values (%L, %L)', e, a)), 'ERR 42501');
  SELECT count(*) INTO n FROM public.friendships WHERE requester_id = a AND addressee_id = e AND status = 'blocked';
  IF n <> 1 THEN RAISE EXCEPTION 'G05: the block row did not survive'; END IF;
  PERFORM pg_temp.expect('G05 unblock', pg_temp.as_exec(a, format('select public.unblock_user(%L)', e)), 'ok');
  RAISE NOTICE 'PASS G-05: requests are pending-only, only the addressee accepts, a block is untouchable by its target';

  -- ── G-06 pending accounts (p is approved first, to own one live thread) ─
  conv_pa := pg_temp.as_val(p, format('select public.start_direct(%L)::text', a))::uuid;
  PERFORM pg_temp.expect('G06 setup msg',
    pg_temp.as_exec(p, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_pa, p, 'hi')), 'ok 1');
  UPDATE public.profiles SET vetting_status = 'pending' WHERE id = p;
  PERFORM pg_temp.expect('G06 start_direct', pg_temp.as_val(p, format('select public.start_direct(%L)::text', b)), 'ERR 42501');
  PERFORM pg_temp.expect('G06 legacy insert',
    pg_temp.as_exec(p, format('insert into public.conversations (participant_ids, conversation_type) values (array[%L, %L]::uuid[], %L)', p, b, 'direct')),
    'ERR 42501');
  PERFORM pg_temp.expect('G06 message in existing thread',
    pg_temp.as_exec(p, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_pa, p, 'again')),
    'ERR 42501');
  PERFORM pg_temp.expect('G06 create_group', pg_temp.as_val(p, format('select public.create_group(%L, array[%L, %L]::uuid[])::text', 'x', a, b)), 'ERR 42501');
  PERFORM pg_temp.expect('G06 friend request',
    pg_temp.as_exec(p, format('insert into public.friendships (requester_id, addressee_id) values (%L, %L)', p, b)), 'ERR 42501');
  PERFORM pg_temp.expect('G06 create community',
    pg_temp.as_val(p, format('select (public.create_community(%L, %L, null, %L)).id::text', 'Nope', 'nope-132', 'interest')), 'ERR 42501');
  RAISE NOTICE 'PASS G-06: a pending account cannot open, write, befriend, group or found anything';

  -- ── CHAT-02 request-first DMs ───────────────────────────────────────────
  conv_eb := pg_temp.as_val(e, format('select public.start_direct(%L)::text', b))::uuid;
  SELECT status INTO r FROM public.conversation_members WHERE conversation_id = conv_eb AND user_id = b;
  IF r <> 'request' THEN RAISE EXCEPTION 'CHAT-02: stranger thread opened as % on her side', r; END IF;
  PERFORM pg_temp.expect('CHAT-02 msg 1',
    pg_temp.as_exec(e, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_eb, e, 'hello 1')), 'ok 1');
  PERFORM pg_temp.expect('CHAT-02 gif while request',
    pg_temp.as_exec(e, format('insert into public.messages (conversation_id, sender_id, media_url, message_type) values (%L, %L, %L, %L)', conv_eb, e, giphy, 'image')),
    'ERR 42501 request_text_only');
  PERFORM pg_temp.as_exec(e, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_eb, e, 'hello 2'));
  PERFORM pg_temp.expect('CHAT-02 msg 3',
    pg_temp.as_exec(e, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_eb, e, 'hello 3')), 'ok 1');
  PERFORM pg_temp.expect('CHAT-02 msg 4 over the cap',
    pg_temp.as_exec(e, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_eb, e, 'hello 4')),
    'ERR 42501 request_cap');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = b AND actor_id = e AND type = 'message';
  IF n <> 0 THEN RAISE EXCEPTION 'CHAT-02: a message request rang her bell (% rows)', n; END IF;
  PERFORM pg_temp.expect('CHAT-02 she can preview',
    pg_temp.as_val(b, format('select count(*)::text from public.messages where conversation_id = %L', conv_eb)), '3');
  PERFORM pg_temp.expect('CHAT-02 badge counts the request',
    pg_temp.as_val(b, 'select (public.messages_badge()->>''message_requests'')'), '1');
  PERFORM pg_temp.expect('CHAT-02 inbox status',
    pg_temp.as_val(b, format('select my_status from public.inbox_summary() where conversation_id = %L', conv_eb)), 'request');
  PERFORM pg_temp.expect('CHAT-02 recipient cannot reply before accepting',
    pg_temp.as_exec(b, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_eb, b, 'hm')), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-02 accept', pg_temp.as_val(b, format('select public.respond_message_request(%L, true)', conv_eb)), 'active');
  PERFORM pg_temp.expect('CHAT-02 gif after accept',
    pg_temp.as_exec(e, format('insert into public.messages (conversation_id, sender_id, media_url, message_type) values (%L, %L, %L, %L)', conv_eb, e, giphy, 'image')), 'ok 1');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = b AND actor_id = e AND type = 'message';
  IF n <> 1 THEN RAISE EXCEPTION 'CHAT-02: accepted thread should notify once, got %', n; END IF;

  conv_ef := pg_temp.as_val(e, format('select public.start_direct(%L)::text', f))::uuid;
  PERFORM pg_temp.as_exec(e, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_ef, e, 'hey'));
  PERFORM pg_temp.expect('CHAT-02 decline', pg_temp.as_val(f, format('select public.respond_message_request(%L, false)', conv_ef)), 'declined');
  PERFORM pg_temp.expect('CHAT-02 after decline',
    pg_temp.as_exec(e, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_ef, e, 'hey?')),
    'ERR 42501 request_declined');
  PERFORM pg_temp.expect('CHAT-02 friends-only refuses a stranger', pg_temp.as_val(e, format('select public.start_direct(%L)::text', d)), 'ERR 42501');

  conv_ec := pg_temp.as_val(e, format('select public.start_direct(%L)::text', c))::uuid;
  PERFORM pg_temp.as_exec(e, format('insert into public.friendships (requester_id, addressee_id) values (%L, %L)', e, c));
  PERFORM pg_temp.expect('CHAT-02 addressee accepts friendship',
    pg_temp.as_exec(c, format('update public.friendships set status = %L where requester_id = %L and addressee_id = %L', 'accepted', e, c)), 'ok 1');
  SELECT status INTO r FROM public.conversation_members WHERE conversation_id = conv_ec AND user_id = c;
  IF r <> 'active' THEN RAISE EXCEPTION 'CHAT-02: becoming friends left the request as %', r; END IF;
  RAISE NOTICE 'PASS CHAT-02: strangers land in Requests, 3 text-only messages, no bell, accept/decline/friend promote';

  -- ── CHAT-03 conversations are read-only to clients ──────────────────────
  conv_ab := pg_temp.as_val(a, format('select public.start_direct(%L)::text', b))::uuid;
  SELECT count(*) INTO n FROM public.conversation_members WHERE conversation_id = conv_ab AND status = 'active';
  IF n <> 2 THEN RAISE EXCEPTION 'CHAT-03 setup: friends thread should be active on both sides'; END IF;
  PERFORM pg_temp.expect('CHAT-03 rewrite participants',
    pg_temp.as_exec(a, format('update public.conversations set participant_ids = array[%L, %L]::uuid[] where id = %L', a, d, conv_ab)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-03 delete thread',
    pg_temp.as_exec(a, format('delete from public.conversations where id = %L', conv_ab)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-03 direct member write',
    pg_temp.as_exec(e, format('insert into public.conversation_members (conversation_id, user_id) values (%L, %L)', conv_ab, e)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-03 outsider reads',
    pg_temp.as_val(e, format('select count(*)::text from public.messages where conversation_id = %L', conv_ab)), '0');
  RAISE NOTICE 'PASS CHAT-03: no client UPDATE/DELETE on conversations or members';

  -- ── CHAT-04 message integrity ───────────────────────────────────────────
  m1 := pg_temp.as_val(a, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L) returning id::text', conv_ab, a, 'original'))::uuid;
  PERFORM pg_temp.expect('CHAT-04 move thread',
    pg_temp.as_exec(a, format('update public.messages set conversation_id = %L where id = %L', conv_eb, m1)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-04 rewrite time',
    pg_temp.as_exec(a, format('update public.messages set created_at = now() - interval ''1 day'' where id = %L', m1)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-04 other edits mine',
    pg_temp.as_exec(b, format('update public.messages set content = %L where id = %L', 'gotcha', m1)), 'ok 0');
  PERFORM pg_temp.expect('CHAT-04 edit',
    pg_temp.as_exec(a, format('update public.messages set content = %L where id = %L', 'edited', m1)), 'ok 1');
  SELECT count(*) INTO n FROM public.messages WHERE id = m1 AND content = 'edited' AND edited_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'CHAT-04: edit did not stamp edited_at'; END IF;
  SELECT count(*) INTO n FROM public.message_revisions WHERE message_id = m1 AND action = 'edit' AND content = 'original';
  IF n <> 1 THEN RAISE EXCEPTION 'CHAT-04: the original words were not kept'; END IF;
  PERFORM pg_temp.expect('CHAT-04 member reads revisions',
    pg_temp.as_val(b, format('select count(*)::text from public.message_revisions where message_id = %L', m1)), '0');
  m2 := pg_temp.as_val(a, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L) returning id::text', conv_ab, a, 'oops'))::uuid;
  PERFORM pg_temp.expect('CHAT-04 unsend',
    pg_temp.as_exec(a, format('update public.messages set deleted_at = now() where id = %L', m2)), 'ok 1');
  SELECT count(*) INTO n FROM public.messages WHERE id = m2 AND content IS NULL AND deleted_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'CHAT-04: unsend left the words behind'; END IF;
  SELECT count(*) INTO n FROM public.message_revisions WHERE message_id = m2 AND action = 'unsend' AND content = 'oops';
  IF n <> 1 THEN RAISE EXCEPTION 'CHAT-04: unsend lost the evidence'; END IF;
  UPDATE public.messages SET created_at = now() - interval '20 minutes' WHERE id = m1;
  PERFORM pg_temp.expect('CHAT-04 edit window',
    pg_temp.as_exec(a, format('update public.messages set content = %L where id = %L', 'late', m1)), 'ERR 42501 edit_window');
  PERFORM pg_temp.expect('CHAT-04 delete row',
    pg_temp.as_exec(a, format('delete from public.messages where id = %L', m1)), 'ERR 42501');
  RAISE NOTICE 'PASS CHAT-04: sender edits words only, within 15 min, edited_at stamped, originals kept for staff';

  -- ── CHAT-05 / CHAT-07 / CHAT-12 message rules ───────────────────────────
  PERFORM pg_temp.expect('CHAT-05 forged Roxy card',
    pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, content, message_type) values (%L, %L, %L, %L)', conv_ab, a, 'move to telegram', 'roxy_suggestion')),
    'ERR 42501');
  PERFORM pg_temp.expect('CHAT-05 forged system row',
    pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, content, message_type) values (%L, %L, %L, %L)', conv_ab, a, 'Roxy removed Bea', 'system')),
    'ERR 42501');
  PERFORM pg_temp.expect('CHAT-07 tracking pixel',
    pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, media_url, message_type) values (%L, %L, %L, %L)', conv_ab, a, 'https://evil.example/x.png', 'image')),
    'ERR 42501 media_not_allowed');
  PERFORM pg_temp.expect('CHAT-07 lookalike host',
    pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, media_url, message_type) values (%L, %L, %L, %L)', conv_ab, a, 'https://media.giphy.com.evil.example/media/x.gif', 'image')),
    'ERR 42501 media_not_allowed');
  PERFORM pg_temp.expect('CHAT-07 other thread storage path',
    pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, media_url, message_type) values (%L, %L, %L, %L)', conv_ab, a, 'chat-media/' || conv_eb || '/x.jpg', 'image')),
    'ERR 42501 media_not_allowed');
  PERFORM pg_temp.expect('CHAT-07 giphy ok',
    pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, media_url, message_type) values (%L, %L, %L, %L)', conv_ab, a, giphy, 'image')), 'ok 1');
  PERFORM pg_temp.expect('CHAT-07 own bucket ok',
    pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, media_url, message_type) values (%L, %L, %L, %L)', conv_ab, a, 'chat-media/' || conv_ab || '/p1.jpg', 'image')), 'ok 1');
  PERFORM pg_temp.expect('CHAT-12 4001 chars',
    pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_ab, a, repeat('x', 4001))), 'ERR 23514');
  m_other := pg_temp.as_val(e, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L) returning id::text', conv_eb, e, 'elsewhere'))::uuid;
  r := pg_temp.as_val(b, format('insert into public.messages (conversation_id, sender_id, content, reply_to_id) values (%L, %L, %L, %L) returning coalesce(reply_to_id::text, %L)', conv_ab, b, 'cross reply', m_other, 'null'));
  IF r <> 'null' THEN RAISE EXCEPTION 'CHAT-17: a reply pointed into another thread (%)', r; END IF;
  r := pg_temp.as_val(b, format('insert into public.messages (conversation_id, sender_id, content, reply_to_id) values (%L, %L, %L, %L) returning coalesce(reply_to_id::text, %L)', conv_ab, b, 'real reply', m1, 'null'));
  IF r <> m1::text THEN RAISE EXCEPTION 'CHAT-17: a same-thread reply lost its target (%)', r; END IF;
  -- 30 a minute: count what a has already sent this minute, fill to 30, the next one is refused.
  SELECT count(*) INTO n FROM public.messages WHERE sender_id = a AND created_at > now() - interval '1 minute';
  FOR i IN 1 .. (30 - n) LOOP
    r := pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_ab, a, 'burst ' || i));
    PERFORM pg_temp.expect('CHAT-12 burst ' || i, r, 'ok 1');
  END LOOP;
  PERFORM pg_temp.expect('CHAT-12 31st in a minute',
    pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_ab, a, 'one more')), 'ERR PT429');
  UPDATE public.messages SET created_at = now() - interval '30 minutes' WHERE sender_id = a AND conversation_id = conv_ab AND id <> m1;
  RAISE NOTICE 'PASS CHAT-05/07/12: no forged Roxy/system rows, media allow-list, 4000-char cap, 30/min';

  -- ── CHAT-13 unread from the server ──────────────────────────────────────
  UPDATE public.conversation_members SET last_read_at = now() - interval '1 hour', joined_at = now() - interval '2 hours'
   WHERE conversation_id = conv_ab AND user_id = b;
  SELECT count(*) INTO n FROM public.messages
   WHERE conversation_id = conv_ab AND sender_id = a AND deleted_at IS NULL AND created_at > now() - interval '1 hour';
  PERFORM pg_temp.expect('CHAT-13 unread before read',
    pg_temp.as_val(b, format('select unread::text from public.inbox_summary() where conversation_id = %L', conv_ab)), n::text);
  PERFORM pg_temp.expect('CHAT-13 mark read', pg_temp.as_exec(b, format('select public.mark_conversation_read(%L)', conv_ab)), 'ok');
  PERFORM pg_temp.expect('CHAT-13 unread after read',
    pg_temp.as_val(b, format('select unread::text from public.inbox_summary() where conversation_id = %L', conv_ab)), '0');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = b AND link_path = '/chat/' || conv_ab AND read_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'CHAT-13: reading the chat left % bell rows unread', n; END IF;
  RAISE NOTICE 'PASS CHAT-13: unread is the server''s count and reading clears it and the bell';

  -- Read receipts off: she reads, the sender's ticks do not move.
  PERFORM pg_temp.as_exec(b, 'select public.set_chat_settings(false, null)');
  m2 := pg_temp.as_val(a, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L) returning id::text', conv_ab, a, 'did you see'))::uuid;
  PERFORM pg_temp.as_exec(b, format('select public.mark_conversation_read(%L)', conv_ab));
  SELECT count(*) INTO n FROM public.messages WHERE id = m2 AND is_read;
  IF n <> 0 THEN RAISE EXCEPTION 'CHAT-17: read receipts off still sent a receipt'; END IF;
  -- A request recipient reading never tells the stranger.
  conv_legacy := NULL;
  RAISE NOTICE 'PASS receipts: optional, and never sent from Requests';

  -- ── CHAT-01 private groups ──────────────────────────────────────────────
  g := pg_temp.as_val(a, format('select public.create_group(%L, array[%L, %L, %L]::uuid[], %L)::text', 'Weekend crew', b, c, e, '🌈'))::uuid;
  SELECT count(*) INTO n FROM public.conversation_members WHERE conversation_id = g AND status = 'active';
  IF n <> 3 THEN RAISE EXCEPTION 'CHAT-01: expected owner + 2 friends (stranger skipped), got %', n; END IF;
  SELECT count(*) INTO n FROM public.conversation_members WHERE conversation_id = g AND user_id = e;
  IF n <> 0 THEN RAISE EXCEPTION 'CHAT-01: a non-friend was put in a group'; END IF;
  PERFORM pg_temp.expect('CHAT-01 one friend is a DM',
    pg_temp.as_val(a, format('select public.create_group(%L, array[%L]::uuid[])::text', 'x', b)), 'ERR 22023');
  PERFORM pg_temp.expect('CHAT-01 cap 32',
    pg_temp.as_val(a, format('select public.create_group(%L, %L::uuid[])::text', 'big', (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 32)))), 'ERR 22023');
  PERFORM pg_temp.expect('CHAT-01 outsider sees the group',
    pg_temp.as_val(e, format('select count(*)::text from public.conversations where id = %L', g)), '0');
  PERFORM pg_temp.expect('CHAT-01 outsider reads',
    pg_temp.as_val(e, format('select count(*)::text from public.messages where conversation_id = %L', g)), '0');
  PERFORM pg_temp.expect('CHAT-01 outsider writes',
    pg_temp.as_exec(e, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', g, e, 'let me in')), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-01 member writes',
    pg_temp.as_exec(b, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', g, b, 'hi crew')), 'ok 1');
  PERFORM pg_temp.expect('CHAT-01 member reads',
    pg_temp.as_val(c, format('select count(*)::text from public.messages where conversation_id = %L and sender_id = %L', g, b)), '1');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = c AND actor_id = b AND type = 'message' AND title LIKE '%Weekend crew%';
  IF n <> 1 THEN RAISE EXCEPTION 'CHAT-01: group message bell rows for c: %', n; END IF;
  PERFORM pg_temp.expect('CHAT-01 mute', pg_temp.as_exec(c, format('select public.mute_conversation(%L, now() + interval ''1 hour'')', g)), 'ok');
  PERFORM pg_temp.as_exec(b, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', g, b, 'muted?'));
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = c AND actor_id = b AND type = 'message' AND title LIKE '%Weekend crew%';
  IF n <> 1 THEN RAISE EXCEPTION 'CHAT-01: a muted group still rang the bell'; END IF;
  -- History before she joined stays private.
  UPDATE public.messages SET created_at = now() - interval '10 minutes' WHERE conversation_id = g;
  UPDATE public.conversation_members SET joined_at = now() - interval '1 hour' WHERE conversation_id = g;
  PERFORM pg_temp.expect('CHAT-01 add d', pg_temp.as_val(a, format('select public.add_group_members(%L, array[%L]::uuid[])::text', g, d)), '1');
  PERFORM pg_temp.expect('CHAT-01 new member sees old history',
    pg_temp.as_val(d, format('select count(*)::text from public.messages where conversation_id = %L and created_at < now()', g)), '0');
  PERFORM pg_temp.expect('CHAT-01 new member sees the welcome line',
    pg_temp.as_val(d, format('select count(*)::text from public.messages where conversation_id = %L and message_type = %L', g, 'system')), '1');
  PERFORM pg_temp.expect('CHAT-01 member removes member',
    pg_temp.as_exec(b, format('select public.remove_group_member(%L, %L)', g, c)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-01 member renames',
    pg_temp.as_exec(b, format('select public.rename_group(%L, %L)', g, 'mine now')), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-01 owner removes', pg_temp.as_exec(a, format('select public.remove_group_member(%L, %L)', g, c)), 'ok');
  PERFORM pg_temp.expect('CHAT-01 removed member reads',
    pg_temp.as_val(c, format('select count(*)::text from public.messages where conversation_id = %L', g)), '0');
  PERFORM pg_temp.expect('CHAT-01 removed member writes',
    pg_temp.as_exec(c, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', g, c, 'still here')), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-01 member cannot re-add the removed',
    pg_temp.as_val(b, format('select public.add_group_members(%L, array[%L]::uuid[])::text', g, c)), '0');
  PERFORM pg_temp.expect('CHAT-01 rename', pg_temp.as_exec(a, format('select public.rename_group(%L, %L, %L)', g, 'Brunch club', '🥞')), 'ok');
  PERFORM pg_temp.expect('CHAT-01 leave', pg_temp.as_exec(b, format('select public.leave_group(%L)', g)), 'ok');
  PERFORM pg_temp.expect('CHAT-01 owner leaves', pg_temp.as_exec(a, format('select public.leave_group(%L)', g)), 'ok');
  SELECT role INTO r FROM public.conversation_members WHERE conversation_id = g AND user_id = d;
  IF r <> 'owner' THEN RAISE EXCEPTION 'CHAT-01: owner left and ownership went to % (expected d as owner)', coalesce(r, 'nobody'); END IF;
  -- Never put two women who blocked each other in one room; respect 'nobody'.
  PERFORM pg_temp.as_exec(b, format('select public.block_user(%L)', d));
  PERFORM pg_temp.as_exec(c, 'select public.set_chat_settings(null, ''nobody'')');
  g2 := pg_temp.as_val(a, format('select public.create_group(%L, array[%L, %L, %L]::uuid[])::text', 'Mixed', b, c, d))::uuid;
  SELECT count(*) INTO n FROM public.conversation_members WHERE conversation_id = g2 AND user_id IN (c, d);
  IF n <> 0 THEN RAISE EXCEPTION 'CHAT-01: added someone blocked by a member, or who said nobody (% rows)', n; END IF;
  PERFORM pg_temp.as_exec(b, format('select public.unblock_user(%L)', d));
  RAISE NOTICE 'PASS CHAT-01: private groups — friends only, cap, roles, no history for newcomers, remove/leave/rename/mute, blocks respected';

  -- ── CHAT-15 reactions + private realtime topics ─────────────────────────
  PERFORM pg_temp.expect('CHAT-15 outsider reacts',
    pg_temp.as_exec(e, format('insert into public.message_reactions (message_id, user_id, emoji) values (%L, %L, %L)', m1, e, '💜')), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-15 member reacts',
    pg_temp.as_exec(b, format('insert into public.message_reactions (message_id, user_id, emoji) values (%L, %L, %L)', m1, b, '💜')), 'ok 1');
  PERFORM pg_temp.expect('CHAT-15 outsider topic',
    pg_temp.as_val(e, format('select public.realtime_conversation_topic_ok(%L)::text', 'conv:' || conv_ab || ':typing')), 'false');
  PERFORM pg_temp.expect('CHAT-15 member topic',
    pg_temp.as_val(b, format('select public.realtime_conversation_topic_ok(%L)::text', 'conv:' || conv_ab || ':typing')), 'true');
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
     AND policyname LIKE 'chat members % conversation broadcasts';
  IF n <> 2 THEN RAISE EXCEPTION 'CHAT-15: realtime.messages policies missing (%)', n; END IF;
  RAISE NOTICE 'PASS CHAT-15: reactions and typing/reaction topics are members-only';

  -- ── CHAT-09 / CHAT-10 communities ───────────────────────────────────────
  INSERT INTO public.communities (name, slug, category, is_private, created_by)
  VALUES ('Test 132 open', 'test-132-open', 'interest', false, a) RETURNING id INTO comm_pub;
  INSERT INTO public.communities (name, slug, category, is_private, created_by)
  VALUES ('Test 132 private', 'test-132-private', 'interest', true, a) RETURNING id INTO comm_priv;
  INSERT INTO public.community_members (community_id, user_id, role) VALUES (comm_pub, a, 'admin'), (comm_pub, c, 'member')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.community_channels (community_id, slug, name) VALUES (comm_pub, 'test-132', 'test') RETURNING id INTO chan;
  PERFORM pg_temp.expect('CHAT-09 join private',
    pg_temp.as_exec(d, format('insert into public.community_members (community_id, user_id) values (%L, %L)', comm_priv, d)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-09 join open',
    pg_temp.as_exec(e, format('insert into public.community_members (community_id, user_id) values (%L, %L)', comm_pub, e)), 'ok 1');
  PERFORM pg_temp.expect('CHAT-09 join open (b)',
    pg_temp.as_exec(b, format('insert into public.community_members (community_id, user_id) values (%L, %L)', comm_pub, b)), 'ok 1');
  PERFORM pg_temp.expect('CHAT-09 member removes member',
    pg_temp.as_exec(e, format('select public.remove_community_member(%L, %L)', comm_pub, b)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-09 admin bans', pg_temp.as_exec(a, format('select public.remove_community_member(%L, %L, true, %L)', comm_pub, b, 'harassment')), 'ok');
  PERFORM pg_temp.expect('CHAT-09 banned rejoins',
    pg_temp.as_exec(b, format('insert into public.community_members (community_id, user_id) values (%L, %L)', comm_pub, b)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-09 removed reads channel',
    pg_temp.as_val(b, format('select count(*)::text from public.community_channel_messages where channel_id = %L', chan)), '0');
  UPDATE public.community_members SET notify_messages = true WHERE community_id = comm_pub AND user_id = c;
  PERFORM pg_temp.as_exec(c, format('select public.block_user(%L)', e));
  PERFORM pg_temp.expect('CHAT-10 blocked posts',
    pg_temp.as_exec(e, format('insert into public.community_channel_messages (channel_id, sender_id, body) values (%L, %L, %L)', chan, e, 'hey all')), 'ok 1');
  PERFORM pg_temp.expect('CHAT-10 blocker sees blocked',
    pg_temp.as_val(c, format('select count(*)::text from public.community_channel_messages where channel_id = %L and sender_id = %L', chan, e)), '0');
  PERFORM pg_temp.as_exec(c, format('insert into public.community_channel_messages (channel_id, sender_id, body) values (%L, %L, %L)', chan, c, 'hello'));
  PERFORM pg_temp.expect('CHAT-10 blocked sees blocker',
    pg_temp.as_val(e, format('select count(*)::text from public.community_channel_messages where channel_id = %L and sender_id = %L', chan, c)), '0');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = c AND actor_id = e AND type = 'channel_message';
  IF n <> 0 THEN RAISE EXCEPTION 'CHAT-10: a blocked sender rang the channel bell'; END IF;
  PERFORM pg_temp.as_exec(c, format('select public.unblock_user(%L)', e));
  RAISE NOTICE 'PASS CHAT-09/10: private communities closed, moderators remove/ban, blocks hide both ways and silence the bell';

  -- ── CHAT-17 channel reactions + private typing/reaction topics ──────────
  INSERT INTO public.community_channel_messages (channel_id, sender_id, body) VALUES (chan, c, 'react to me')
    RETURNING id INTO cm;
  PERFORM pg_temp.expect('CHAT-17 outsider reacts in a channel',
    pg_temp.as_exec(f, format('insert into public.community_channel_reactions (message_id, user_id, emoji) values (%L, %L, %L)', cm, f, '💜')), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-17 banned woman reacts',
    pg_temp.as_exec(b, format('insert into public.community_channel_reactions (message_id, user_id, emoji) values (%L, %L, %L)', cm, b, '💜')), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-17 member reacts as someone else',
    pg_temp.as_exec(e, format('insert into public.community_channel_reactions (message_id, user_id, emoji) values (%L, %L, %L)', cm, a, '💜')), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-17 member reacts',
    pg_temp.as_exec(e, format('insert into public.community_channel_reactions (message_id, user_id, emoji) values (%L, %L, %L)', cm, e, '💜')), 'ok 1');
  PERFORM pg_temp.expect('CHAT-17 member sees the reaction',
    pg_temp.as_val(a, format('select count(*)::text from public.community_channel_reactions where message_id = %L', cm)), '1');
  PERFORM pg_temp.expect('CHAT-17 outsider sees no reaction',
    pg_temp.as_val(f, format('select count(*)::text from public.community_channel_reactions where message_id = %L', cm)), '0');
  PERFORM pg_temp.as_exec(c, format('select public.block_user(%L)', e));
  PERFORM pg_temp.expect('CHAT-17 blocker never sees a blocked reactor',
    pg_temp.as_val(c, format('select count(*)::text from public.community_channel_reactions where message_id = %L', cm)), '0');
  PERFORM pg_temp.expect('CHAT-17 blocked woman cannot react to her blocker',
    pg_temp.as_exec(e, format('insert into public.community_channel_reactions (message_id, user_id, emoji) values (%L, %L, %L)', cm, e, '🔥')), 'ERR 42501');
  PERFORM pg_temp.as_exec(c, format('select public.unblock_user(%L)', e));
  PERFORM pg_temp.expect('CHAT-17 nobody edits a reaction',
    pg_temp.as_exec(e, format('update public.community_channel_reactions set emoji = %L where message_id = %L', '😡', cm)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-17 nobody removes another woman''s reaction',
    pg_temp.as_exec(c, format('delete from public.community_channel_reactions where message_id = %L', cm)), 'ok 0');
  PERFORM pg_temp.expect('CHAT-17 she removes her own',
    pg_temp.as_exec(e, format('delete from public.community_channel_reactions where message_id = %L and user_id = %L', cm, e)), 'ok 1');
  PERFORM pg_temp.expect('CHAT-17 member typing topic',
    pg_temp.as_val(e, format('select public.realtime_channel_topic_ok(%L)::text', 'chan:' || chan || ':typing')), 'true');
  PERFORM pg_temp.expect('CHAT-17 member reactions topic',
    pg_temp.as_val(c, format('select public.realtime_channel_topic_ok(%L)::text', 'chan:' || chan || ':reactions')), 'true');
  PERFORM pg_temp.expect('CHAT-17 outsider topic',
    pg_temp.as_val(f, format('select public.realtime_channel_topic_ok(%L)::text', 'chan:' || chan || ':typing')), 'false');
  PERFORM pg_temp.expect('CHAT-17 banned topic',
    pg_temp.as_val(b, format('select public.realtime_channel_topic_ok(%L)::text', 'chan:' || chan || ':typing')), 'false');
  PERFORM pg_temp.expect('CHAT-17 unknown topic shape',
    pg_temp.as_val(e, format('select public.realtime_channel_topic_ok(%L)::text', 'chan:' || chan || ':presence')), 'false');
  -- A ban row written straight by staff leaves the membership row in place:
  -- the ban alone must still close the topics and the reactions.
  INSERT INTO public.community_bans (community_id, user_id, reason) VALUES (comm_pub, e, 'staff ban');
  PERFORM pg_temp.expect('CHAT-17 staff-banned member topic',
    pg_temp.as_val(e, format('select public.realtime_channel_topic_ok(%L)::text', 'chan:' || chan || ':typing')), 'false');
  PERFORM pg_temp.expect('CHAT-17 staff-banned member reacts',
    pg_temp.as_exec(e, format('insert into public.community_channel_reactions (message_id, user_id, emoji) values (%L, %L, %L)', cm, e, '💜')), 'ERR 42501');
  DELETE FROM public.community_bans WHERE community_id = comm_pub AND user_id = e;
  PERFORM pg_temp.expect('CHAT-17 anon has no reactions table',
    (SELECT CASE WHEN has_table_privilege('anon', 'public.community_channel_reactions', 'SELECT') THEN 'yes' ELSE 'no' END), 'no');
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
     AND policyname LIKE 'community members % channel broadcasts';
  IF n <> 2 THEN RAISE EXCEPTION 'CHAT-17: realtime.messages channel policies missing (%)', n; END IF;
  RAISE NOTICE 'PASS CHAT-17: channel reactions and typing/reaction topics are members-only and respect blocks and bans';

  -- ── CHAT-09 private communities: request → approve, invite → accept ──────
  INSERT INTO public.community_members (community_id, user_id, role) VALUES (comm_priv, a, 'admin') ON CONFLICT DO NOTHING;
  INSERT INTO public.community_channels (community_id, slug, name) VALUES (comm_priv, 'test-132-priv', 'priv') RETURNING id INTO chan_priv;
  INSERT INTO public.community_channel_messages (channel_id, sender_id, body) VALUES (chan_priv, a, 'members only');
  PERFORM pg_temp.expect('CHAT-09 outsider cannot see a private community',
    pg_temp.as_val(f, format('select count(*)::text from public.communities where id = %L', comm_priv)), '0');
  PERFORM pg_temp.expect('CHAT-09 public join via RPC',
    pg_temp.as_val(d, format('select public.request_to_join_community(%L)', comm_pub)), 'joined');
  PERFORM pg_temp.expect('CHAT-09 private join is a request',
    pg_temp.as_val(d, format('select public.request_to_join_community(%L, %L)', comm_priv, 'hi, Ana sent me')), 'requested');
  PERFORM pg_temp.expect('CHAT-09 asking twice stays one request',
    pg_temp.as_val(d, format('select public.request_to_join_community(%L)', comm_priv)), 'requested');
  PERFORM pg_temp.expect('CHAT-09 requester is not a member yet',
    pg_temp.as_val(d, format('select count(*)::text from public.community_channel_messages where channel_id = %L', chan_priv)), '0');
  PERFORM pg_temp.expect('CHAT-09 requester sees her own request',
    pg_temp.as_val(d, format('select status from public.community_join_requests where community_id = %L and user_id = %L', comm_priv, d)), 'pending');
  PERFORM pg_temp.expect('CHAT-09 a stranger cannot see the request',
    pg_temp.as_val(e, format('select count(*)::text from public.community_join_requests where community_id = %L', comm_priv)), '0');
  PERFORM pg_temp.expect('CHAT-09 member cannot approve',
    pg_temp.as_exec(d, format('select public.respond_join_request(%L, %L, true)', comm_priv, d)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-09 no direct write to requests',
    pg_temp.as_exec(d, format('update public.community_join_requests set status = %L where user_id = %L', 'approved', d)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-09 moderator sees the queue',
    pg_temp.as_val(a, format('select count(*)::text from public.community_join_requests where community_id = %L and status = %L', comm_priv, 'pending')), '1');
  PERFORM pg_temp.expect('CHAT-09 moderator approves',
    pg_temp.as_exec(a, format('select public.respond_join_request(%L, %L, true)', comm_priv, d)), 'ok');
  PERFORM pg_temp.expect('CHAT-09 approved member reads the channel',
    pg_temp.as_val(d, format('select count(*)::text from public.community_channel_messages where channel_id = %L', chan_priv)), '1');
  -- decline + cooldown
  PERFORM pg_temp.expect('CHAT-09 e asks', pg_temp.as_val(e, format('select public.request_to_join_community(%L)', comm_priv)), 'requested');
  PERFORM pg_temp.expect('CHAT-09 moderator declines',
    pg_temp.as_exec(a, format('select public.respond_join_request(%L, %L, false)', comm_priv, e)), 'ok');
  PERFORM pg_temp.expect('CHAT-09 declined cannot hammer',
    pg_temp.as_val(e, format('select public.request_to_join_community(%L)', comm_priv)), 'ERR 22023');
  PERFORM pg_temp.expect('CHAT-09 declined is not a member',
    pg_temp.as_val(e, format('select count(*)::text from public.community_channel_messages where channel_id = %L', chan_priv)), '0');
  -- invites
  PERFORM pg_temp.expect('CHAT-09 member cannot invite',
    pg_temp.as_val(d, format('select public.invite_to_community(%L, %L)', comm_priv, f)), 'ERR 42501');
  PERFORM pg_temp.as_exec(a, format('select public.block_user(%L)', f));
  PERFORM pg_temp.expect('CHAT-09 cannot invite someone block-paired',
    pg_temp.as_val(a, format('select public.invite_to_community(%L, %L)', comm_priv, f)), 'ERR 42501');
  PERFORM pg_temp.as_exec(a, format('select public.unblock_user(%L)', f));
  PERFORM pg_temp.expect('CHAT-09 moderator invites',
    pg_temp.as_val(a, format('select public.invite_to_community(%L, %L)', comm_priv, f)), 'invited');
  PERFORM pg_temp.expect('CHAT-09 invitee sees the community she was invited to',
    pg_temp.as_val(f, format('select count(*)::text from public.communities where id = %L', comm_priv)), '1');
  PERFORM pg_temp.expect('CHAT-09 invitee is not a member until she says yes',
    pg_temp.as_val(f, format('select count(*)::text from public.community_channel_messages where channel_id = %L', chan_priv)), '0');
  PERFORM pg_temp.expect('CHAT-09 invitee accepts',
    pg_temp.as_exec(f, format('select public.respond_community_invite(%L, true)', comm_priv)), 'ok');
  PERFORM pg_temp.expect('CHAT-09 accepted invitee reads the channel',
    pg_temp.as_val(f, format('select count(*)::text from public.community_channel_messages where channel_id = %L', chan_priv)), '1');
  -- moderators (not just admins) remove/ban; a ban closes the request door too
  UPDATE public.community_members SET role = 'moderator' WHERE community_id = comm_priv AND user_id = d;
  PERFORM pg_temp.expect('CHAT-09 moderator cannot remove the admin',
    pg_temp.as_exec(d, format('select public.remove_community_member(%L, %L)', comm_priv, a)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-09 moderator bans a member',
    pg_temp.as_exec(d, format('select public.remove_community_member(%L, %L, true, %L)', comm_priv, f, 'spam')), 'ok');
  PERFORM pg_temp.expect('CHAT-09 banned cannot ask to join',
    pg_temp.as_val(f, format('select public.request_to_join_community(%L)', comm_priv)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-09 banned cannot be invited',
    pg_temp.as_val(a, format('select public.invite_to_community(%L, %L)', comm_priv, f)), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-09 banned cannot post',
    pg_temp.as_exec(f, format('insert into public.community_channel_messages (channel_id, sender_id, body) values (%L, %L, %L)', chan_priv, f, 'back')), 'ERR 42501');
  PERFORM pg_temp.expect('CHAT-09 anon cannot call the join RPC',
    (SELECT CASE WHEN has_function_privilege('anon', 'public.request_to_join_community(uuid, text)', 'EXECUTE') THEN 'yes' ELSE 'no' END), 'no');
  -- The Members screen's Banned list (fetchCommunityBans) embeds the profile
  -- through this FK name and reads as a moderator.
  PERFORM pg_temp.expect('CHAT-09 ban FK name the client embeds',
    (SELECT conname::text FROM pg_constraint WHERE conrelid = 'public.community_bans'::regclass AND contype = 'f'
       AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.community_bans'::regclass AND attname = 'user_id')]),
    'community_bans_user_id_fkey');
  PERFORM pg_temp.expect('CHAT-09 moderator lists the bans',
    pg_temp.as_val(d, format('select count(*)::text from public.community_bans where community_id = %L', comm_priv)), '1');
  PERFORM pg_temp.expect('CHAT-09 a member cannot list the bans',
    pg_temp.as_val(c, format('select count(*)::text from public.community_bans where community_id = %L', comm_priv)), '0');
  RAISE NOTICE 'PASS CHAT-09 private: request/approve, decline cooldown, invite/accept, moderators ban, bans close every door';

  -- ── TO public → TO authenticated on the community + friendship tables ────
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('communities', 'community_members', 'friendships', 'community_bans', 'community_join_requests')
     AND roles::text LIKE '%public%';
  IF n <> 0 THEN RAISE EXCEPTION 'ROLES: % policies on community/friendship tables still apply TO public (anon)', n; END IF;
  RAISE NOTICE 'PASS roles: every community/friendship policy is TO authenticated';

  -- ── Old builds keep working (expand/contract) ───────────────────────────
  conv_legacy := pg_temp.as_val(a, format('insert into public.conversations (participant_ids, conversation_type) values (array[%L, %L]::uuid[], %L) returning id::text', a, f, 'direct'))::uuid;
  IF conv_legacy IS NULL THEN RAISE EXCEPTION 'LEGACY: the old direct insert no longer returns its row'; END IF;
  SELECT string_agg(status, ',' ORDER BY status) INTO r FROM public.conversation_members WHERE conversation_id = conv_legacy;
  IF r <> 'active,request' THEN RAISE EXCEPTION 'LEGACY: old-build thread seeded as %', r; END IF;
  PERFORM pg_temp.expect('LEGACY lookup by array',
    pg_temp.as_val(a, format('select id::text from public.conversations where participant_ids @> array[%L, %L]::uuid[] and conversation_type = %L', a, f, 'direct')), conv_legacy::text);
  PERFORM pg_temp.expect('LEGACY send',
    pg_temp.as_exec(a, format('insert into public.messages (conversation_id, sender_id, content) values (%L, %L, %L)', conv_legacy, a, 'old app')), 'ok 1');
  PERFORM pg_temp.expect('LEGACY last_message_at update is refused, not fatal',
    pg_temp.as_exec(a, format('update public.conversations set last_message_at = now() where id = %L', conv_legacy)), 'ERR 42501');
  SELECT count(*) INTO n FROM public.conversations WHERE id = conv_legacy AND last_message_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'LEGACY: the trigger stopped maintaining last_message_at'; END IF;
  RAISE NOTICE 'PASS legacy: old builds still open, find and write to DMs';

  -- ── CHAT-12 20 new conversations a day ──────────────────────────────────
  INSERT INTO public.conversations (participant_ids, conversation_type, created_by)
  SELECT ARRAY[a], 'speed_date', a FROM generate_series(1, 20);
  PERFORM pg_temp.expect('CHAT-12 21st new thread (RPC)', pg_temp.as_val(a, format('select public.start_direct(%L)::text', c)), 'ERR PT429');
  PERFORM pg_temp.expect('CHAT-12 21st new thread (legacy)',
    pg_temp.as_exec(a, format('insert into public.conversations (participant_ids, conversation_type) values (array[%L, %L]::uuid[], %L)', a, c, 'direct')), 'ERR PT429');
  PERFORM pg_temp.expect('CHAT-12 existing thread still opens', pg_temp.as_val(a, format('select public.start_direct(%L)::text', b)), conv_ab::text);
  RAISE NOTICE 'PASS CHAT-12: 20 new conversations a day';

  -- ── Report conversation: a whole DM or group can be reported ────────────
  INSERT INTO public.reports (reporter_id, reported_user_id, content_type, content_id, reason)
  VALUES (b, a, 'conversation', conv_ab, 'harassment');
  BEGIN
    INSERT INTO public.reports (reporter_id, reported_user_id, content_type, content_id, reason)
    VALUES (b, a, 'thread', conv_ab, 'harassment');
    RAISE EXCEPTION 'REPORTS: an unknown content_type was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SELECT count(*) INTO n FROM public.reports WHERE content_type = 'conversation' AND content_id = conv_ab AND reporter_id = b;
  IF n <> 1 THEN RAISE EXCEPTION 'REPORTS: conversation report not stored (%)', n; END IF;
  RAISE NOTICE 'PASS reports: a conversation can be reported, unknown types still refused';

  -- ── Grants: nothing for anon, no UPDATE/DELETE on conversations ─────────
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'anon'
     AND table_name IN ('conversations','messages','conversation_members','friendships','message_reactions',
                        'community_members','community_channel_messages','chat_settings','message_revisions','community_bans');
  IF n <> 0 THEN RAISE EXCEPTION 'GRANTS: anon still holds % privileges on chat tables', n; END IF;
  IF has_table_privilege('authenticated', 'public.conversations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.conversations', 'DELETE')
     OR has_table_privilege('authenticated', 'public.messages', 'DELETE')
     OR has_column_privilege('authenticated', 'public.messages', 'conversation_id', 'UPDATE') THEN
    RAISE EXCEPTION 'GRANTS: authenticated can still rewrite conversations or messages';
  END IF;
  RAISE NOTICE 'PASS grants';
END $$;
