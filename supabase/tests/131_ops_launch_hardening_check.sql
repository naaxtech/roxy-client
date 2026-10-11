-- Behaviour proof for 131_ops_launch_hardening.sql on a LOCAL database.
-- Runs inside one transaction that is ROLLED BACK (scripts/migration-proof.cjs
-- feeds BEGIN; <migration>; <this file>; ROLLBACK). Leaves nothing behind.
\set ON_ERROR_STOP on

DO $$
DECLARE
  a uuid; b uuid; st uuid; co uuid;
  v_comm uuid;
  biz uuid; prod uuid; ev_free uuid; ev_paid uuid; pid uuid; pid2 uuid;
  rep uuid; rep2 uuid; room1 uuid; room2 uuid; eq uuid; susp uuid; gid uuid;
  n int; ok boolean; msg text; j jsonb; v_req bigint; v_ts timestamptz; v_sess uuid;
  heart text := U&'\+01F49C';
BEGIN
  -- ── fixtures (as postgres) ────────────────────────────────────────────
  SELECT p.id INTO a FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.vetting_status = 'approved' AND NOT coalesce(p.is_staff, false) ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO b FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.vetting_status = 'approved' AND NOT coalesce(p.is_staff, false) AND p.id <> a ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO st FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.vetting_status = 'approved' AND p.id NOT IN (a, b) ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO co FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.vetting_status = 'approved' AND p.id NOT IN (a, b, st) ORDER BY p.created_at LIMIT 1;
  IF a IS NULL OR b IS NULL OR st IS NULL OR co IS NULL THEN
    RAISE EXCEPTION 'fixture: need 4 approved profiles with auth users';
  END IF;
  UPDATE public.profiles SET is_staff = true, staff_role = 'staff' WHERE id = st;
  UPDATE public.profiles SET is_staff = true, staff_role = 'core'  WHERE id = co;
  SELECT id INTO v_comm FROM public.communities ORDER BY created_at LIMIT 1;

  INSERT INTO public.posts (author_id, content) VALUES (a, 'ops131 fixture post') RETURNING id INTO pid;
  -- b is signed in on a phone: one live session + refresh token, so the
  -- suspension test proves they are revoked (the seed has none for b).
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
  VALUES (gen_random_uuid(), b, now(), now()) RETURNING id INTO v_sess;
  INSERT INTO auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at)
  VALUES ('ops131-fixture-token', b::text, v_sess, false, now(), now());
  INSERT INTO public.events (host_id, title, starts_at, ends_at, is_paid, price_cents, currency, payout_delay_days)
  VALUES (a, 'ops131 paid', now() + interval '2 days', now() + interval '2 days 2 hours', true, 1500, 'usd', 7)
  RETURNING id INTO ev_paid;

  -- ── S1 grants: functions ─────────────────────────────────────────────
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF n <> 0 THEN RAISE EXCEPTION 'S1a: anon can execute % public functions (want 0)', n; END IF;

  SELECT count(*) INTO n FROM pg_proc p
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
   WHERE p.pronamespace = 'public'::regnamespace AND x.grantee = 0
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
  IF n <> 0 THEN RAISE EXCEPTION 'S1b: PUBLIC holds EXECUTE on % public functions', n; END IF;

  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND NOT coalesce(array_to_string(p.proconfig, ',') ~ 'search_path', false);
  IF n <> 0 THEN RAISE EXCEPTION 'S1c: % SECURITY DEFINER functions without search_path', n; END IF;

  IF has_function_privilege('authenticated', 'public.claim_email_queue_batch(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_ticket(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.increment_variant_stock(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.increment_participant_count(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'S1d: a service-only function is executable by members';
  END IF;
  -- S1e: claim_speed_date_partner trusts its p_user_id; 102 had re-granted it
  -- to authenticated (integration fix in 131 §2).
  IF has_function_privilege('authenticated', 'public.claim_speed_date_partner(uuid,uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_speed_date_partner(uuid,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'S1e: claim_speed_date_partner must be service-role only (it takes a user id)';
  END IF;
  -- S1f: a community game pitch needs no slug (Studio never sends one).
  IF (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'slug') IS NULL THEN
    RAISE EXCEPTION 'S1f: games.slug has no default; every Studio game pitch fails (23502)';
  END IF;

  -- ── S2 grants: tables ────────────────────────────────────────────────
  SELECT count(*) INTO n FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND (has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
          OR has_table_privilege('anon', c.oid, 'DELETE') OR has_table_privilege('anon', c.oid, 'TRUNCATE'));
  IF n <> 0 THEN RAISE EXCEPTION 'S2a: anon can write % public tables', n; END IF;

  SELECT count(*) INTO n FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND has_table_privilege('authenticated', c.oid, 'TRUNCATE');
  IF n <> 0 THEN RAISE EXCEPTION 'S2b: authenticated can TRUNCATE % tables', n; END IF;

  IF has_table_privilege('anon', 'public.reports', 'SELECT')
     OR has_table_privilege('anon', 'public.events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.platform_settings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.audit_log', 'INSERT') THEN
    RAISE EXCEPTION 'S2c: an ops table is still readable by anon or writable by members';
  END IF;

  -- New objects do not inherit the old defaults.
  CREATE FUNCTION public.ops131_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
  CREATE TABLE public.ops131_probe_t (id int);
  IF has_function_privilege('anon', 'public.ops131_probe_fn()', 'EXECUTE')
     OR has_table_privilege('anon', 'public.ops131_probe_t', 'SELECT')
     OR has_table_privilege('anon', 'public.ops131_probe_t', 'INSERT')
     OR has_table_privilege('authenticated', 'public.ops131_probe_t', 'TRUNCATE') THEN
    RAISE EXCEPTION 'S2d: default privileges still hand new objects to anon / TRUNCATE to members';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
   WHERE p.oid = 'public.ops131_probe_fn()'::regprocedure AND x.grantee = 0;
  IF n <> 0 THEN RAISE EXCEPTION 'S2e: a new function is executable by PUBLIC'; END IF;
  DROP FUNCTION public.ops131_probe_fn();
  DROP TABLE public.ops131_probe_t;

  -- ── S3 policies: no TO public left outside the chat lane's tables ──────
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname IN ('public', 'storage') AND 'public' = ANY (roles)
     AND NOT (schemaname = 'public' AND tablename IN ('communities', 'community_members', 'friendships'));
  IF n <> 0 THEN RAISE EXCEPTION 'S3: % TO public policies remain on ops-owned tables', n; END IF;

  -- ── S4 buckets ───────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM storage.buckets
   WHERE file_size_limit IS NULL OR allowed_mime_types IS NULL
      OR EXISTS (SELECT 1 FROM unnest(allowed_mime_types) m WHERE m ~* '(svg|html|xml|javascript)');
  IF n <> 0 THEN RAISE EXCEPTION 'S4: % buckets without size/MIME limits (or allowing svg/html)', n; END IF;

  -- ── R1 increment_reaction ────────────────────────────────────────────
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN PERFORM public.increment_reaction(pid, heart);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'R1a: anon could call increment_reaction'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.increment_reaction(pid, heart);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'Sign in to react'; msg := SQLERRM; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'R1b: increment_reaction without a user did not say "Sign in to react" (got %)', msg; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.increment_reaction(pid, 'hacked');
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'R1c: an arbitrary reaction key was accepted'; END IF;
  PERFORM public.increment_reaction(pid, heart);
  PERFORM public.increment_reaction(pid, 'poll:1');
  RESET ROLE;
  SELECT (reaction_counts->>heart)::int + (reaction_counts->>'poll:1')::int INTO n FROM public.posts WHERE id = pid;
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'R1d: a member''s reaction / poll vote did not land (got %)', n; END IF;

  -- ── R2 room counters: provider only ──────────────────────────────────
  INSERT INTO public.community_rooms (community_id, name, daily_room_name, status, started_at)
  VALUES (v_comm, 'ops131 live', 'ops131-room-live', 'live', now() - interval '1 hour') RETURNING id INTO room1;
  INSERT INTO public.community_rooms (community_id, name, daily_room_name, status, started_at)
  VALUES (v_comm, 'ops131 empty', 'ops131-room-empty', 'live', now() - interval '10 minutes') RETURNING id INTO room2;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.increment_participant_count('ops131-room-live');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'R2a: a member moved room occupancy'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  PERFORM public.increment_participant_count('ops131-room-live');
  RESET ROLE;
  SELECT participant_count INTO n FROM public.community_rooms WHERE id = room1;
  IF n <> 1 THEN RAISE EXCEPTION 'R2b: daily-webhook (service role) could not count a join (got %)', n; END IF;

  -- ── R3 stale rooms ───────────────────────────────────────────────────
  PERFORM public.ops_cleanup_stale_rooms();
  IF (SELECT status FROM public.community_rooms WHERE id = room1) <> 'live' THEN
    RAISE EXCEPTION 'R3a: an occupied room was closed';
  END IF;
  IF (SELECT status FROM public.community_rooms WHERE id = room2) <> 'closed' THEN
    RAISE EXCEPTION 'R3b: an empty room 10 minutes after start stayed live';
  END IF;

  -- ── M1 businesses: owner edits the profile, never trust fields ───────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.businesses (owner_id, name, description, category, location_city, is_wlw_owned,
                                 website_url, instagram_handle, tiktok_handle, facebook_url,
                                 contact_email, phone, logo_url)
  VALUES (a, 'ops131 shop', 'd', 'art', 'Austin', true, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
  RETURNING id INTO biz;
  UPDATE public.businesses SET name = 'ops131 shop 2', business_rejection_reason = NULL WHERE id = biz;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'M1a: the owner could not edit her business (Studio settings)'; END IF;
  ok := false;
  BEGIN UPDATE public.businesses SET can_sell = true WHERE id = biz;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M1b: an owner set can_sell on her own business'; END IF;
  ok := false;
  BEGIN UPDATE public.businesses SET is_verified = true WHERE id = biz;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M1c: an owner verified her own business'; END IF;

  -- ── M2 products: no self-approval ────────────────────────────────────
  INSERT INTO public.products (business_id, name, description, category, base_price_cents, is_active, status)
  VALUES (biz, 'ops131 tee', 'd', 'apparel', 2500, true, 'pending') RETURNING id INTO prod;
  ok := false;
  BEGIN INSERT INTO public.products (business_id, name, category, base_price_cents, status)
        VALUES (biz, 'ops131 sneaky', 'apparel', 100, 'approved');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M2a: a product was inserted already approved'; END IF;
  ok := false;
  BEGIN UPDATE public.products SET status = 'approved' WHERE id = prod;
  EXCEPTION WHEN insufficient_privilege THEN ok := SQLERRM LIKE 'Only Roxy staff can approve%'; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M2b: an owner approved her own product'; END IF;
  UPDATE public.products SET name = 'ops131 tee 2', base_price_cents = 2600, is_active = false WHERE id = prod;
  UPDATE public.products SET status = 'archived' WHERE id = prod;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'M2c: an owner could not archive her product'; END IF;

  -- ── M3 events: host edits text, never money ──────────────────────────
  INSERT INTO public.events (title, host_id, community_id, starts_at, ends_at, description,
                             location_text, is_paid, price_cents, currency, payout_delay_days)
  VALUES ('ops131 free', a, NULL, now() + interval '1 day', NULL, 'd', 'online', false, NULL, 'usd', NULL)
  RETURNING id INTO ev_free;
  UPDATE public.events SET title = 'ops131 paid (renamed)' WHERE id = ev_paid;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'M3a: a host could not rename her event'; END IF;
  ok := false;
  BEGIN UPDATE public.events SET payout_blocked = false WHERE id = ev_paid;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M3b: a host could unblock her own payout'; END IF;
  ok := false;
  BEGIN UPDATE public.events SET price_cents = 1 WHERE id = ev_paid;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M3c: a host repriced a paid event after sale'; END IF;
  ok := false;
  BEGIN UPDATE public.host_stripe_accounts SET fee_tier = 'zero' WHERE user_id = a;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M3d: a host could set her own fee tier'; END IF;
  RESET ROLE;

  -- ── M4 RSVPs: free yes, paid only through checkout ───────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.event_attendees (event_id, user_id, status) VALUES (ev_free, b, 'going');
  ok := false;
  BEGIN INSERT INTO public.event_attendees (event_id, user_id, status) VALUES (ev_paid, b, 'going');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M4a: a member RSVPd into a PAID event without paying'; END IF;
  ok := false;
  BEGIN INSERT INTO public.event_attendees (event_id, user_id, status, ticket_code, is_checked_in)
        VALUES (ev_free, b, 'going', 'FORGED', true);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M4b: a member forged a ticket code / check-in'; END IF;
  RESET ROLE;

  -- ── M5 posts: content yes, rank and counters no ──────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.posts (author_id, community_id, content, post_type, posted_as_community,
                            link_type, link_entity_id, link_community_id, media_urls)
  VALUES (a, NULL, 'ops131 composer post', 'photo', false, NULL, NULL, NULL, ARRAY['https://x/y.jpg'])
  RETURNING id INTO pid2;
  UPDATE public.posts SET content = 'edited' WHERE id = pid;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'M5a: an author could not edit her post'; END IF;
  ok := false;
  BEGIN UPDATE public.posts SET feed_score = 1e9 WHERE id = pid;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M5b: an author boosted her own feed_score'; END IF;
  ok := false;
  BEGIN UPDATE public.posts SET like_count = 9999, is_pinned = true WHERE id = pid;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M5c: an author faked her like count / pin'; END IF;
  ok := false;
  BEGIN INSERT INTO public.posts (author_id, content, feed_score) VALUES (a, 'x', 1e9);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M5d: a post was inserted with its own feed_score'; END IF;

  -- ── M6 games: a pitch cannot arrive live ─────────────────────────────
  ok := false;
  BEGIN INSERT INTO public.games (name, short_description, how_it_works, why_wlw, category, publisher_type, status, submitted_by)
        VALUES ('ops131 game', 's', 'h', 'w', 'party', 'community', 'live', a);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'M6a: a game pitch went straight to live'; END IF;
  INSERT INTO public.games (name, short_description, how_it_works, why_wlw, category, publisher_type, status, submitted_by)
  VALUES ('ops131 game', 's', 'h', 'w', 'party', 'community', 'pitch_pending', a) RETURNING id INTO gid;
  RESET ROLE;

  -- ── A1 audit log ─────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.staff_audit('x', 'profile', a, '{}');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'A1a: a member wrote the staff audit log'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.staff_audit('ops131_probe', 'profile', a, '{"k":1}');
  ok := false;
  BEGIN PERFORM public.staff_audit('ops131_probe', 'profile', NULL, '{}');
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'A1b: an audit row without a target was accepted silently'; END IF;
  SELECT count(*) INTO n FROM public.audit_log WHERE action = 'ops131_probe' AND staff_id = st AND target_id = a;
  IF n <> 1 THEN RAISE EXCEPTION 'A1c: staff audit row not written (got %)', n; END IF;

  -- ── U1 suspension ────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.suspend_member(b, 'members cannot do this');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'U1a: a member suspended another member'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.suspend_member(co, 'staff on staff');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'U1b: non-core staff suspended a staff member'; END IF;
  susp := public.suspend_member(b, 'harassment after two warnings');
  ok := false;
  BEGIN PERFORM public.suspend_member(b, 'again');
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  IF NOT ok THEN RESET ROLE; RAISE EXCEPTION 'U1c: a member was suspended twice'; END IF;
  ok := false;
  BEGIN PERFORM public.unsuspend_member(b, 'not core');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'U1d: non-core staff lifted a suspension'; END IF;

  IF NOT public.is_suspended(b) THEN RAISE EXCEPTION 'U1e: is_suspended() is false after suspension'; END IF;
  SELECT banned_until INTO v_ts FROM auth.users WHERE id = b;
  IF v_ts IS NULL OR v_ts < now() + interval '50 years' THEN RAISE EXCEPTION 'U1f: auth user not banned'; END IF;
  SELECT count(*) INTO n FROM auth.sessions WHERE user_id = b;
  IF n <> 0 THEN RAISE EXCEPTION 'U1g: suspended member still has % sessions', n; END IF;
  SELECT count(*) INTO n FROM auth.refresh_tokens WHERE user_id = b::text;
  IF n <> 0 THEN RAISE EXCEPTION 'U1k: suspended member still has % refresh tokens', n; END IF;
  SELECT count(*) INTO n FROM public.audit_log WHERE action = 'member_suspended' AND target_id = b AND staff_id = st;
  IF n <> 1 THEN RAISE EXCEPTION 'U1h: suspension not audited'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', co, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.unsuspend_member(b, 'appeal upheld');
  RESET ROLE;
  IF public.is_suspended(b) THEN RAISE EXCEPTION 'U1i: suspension not lifted'; END IF;
  IF (SELECT banned_until FROM auth.users WHERE id = b) IS NOT NULL THEN RAISE EXCEPTION 'U1j: ban not lifted'; END IF;

  -- ── Q1 reports queue ─────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.reports (reporter_id, reported_user_id, content_type, content_id, reason, detail)
  VALUES (b, a, 'post', pid, 'harassment', 'ops131') RETURNING id INTO rep;
  ok := false;
  BEGIN UPDATE public.reports SET status = 'dismissed' WHERE id = rep;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'Q1a: a reporter could change her report''s status'; END IF;
  -- a second report on the same post, closed by the same decision
  INSERT INTO public.reports (reporter_id, reported_user_id, content_type, content_id, reason)
  VALUES (co, a, 'post', pid, 'spam') RETURNING id INTO rep2;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.staff_resolve_report(rep, 'dismiss', NULL, false);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'Q1b: a member resolved a report'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  j := public.staff_resolve_report(rep, 'hide', 'Targeted harassment', true);
  ok := false;
  BEGIN PERFORM public.staff_resolve_report(rep, 'dismiss', NULL, false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'Q1c: a resolved report was resolved again'; END IF;
  IF (j->>'resolved')::int <> 2 OR NOT (j->>'hidden')::boolean OR j->>'suspension_id' IS NULL THEN
    RAISE EXCEPTION 'Q1d: unexpected resolve result %', j;
  END IF;
  IF (SELECT deleted_at FROM public.posts WHERE id = pid) IS NULL THEN RAISE EXCEPTION 'Q1e: reported post not hidden'; END IF;
  SELECT count(*) INTO n FROM public.reports
   WHERE id IN (rep, rep2) AND status = 'actioned' AND resolved_by = st AND resolved_at IS NOT NULL
     AND resolution_action = 'hide';
  IF n <> 2 THEN RAISE EXCEPTION 'Q1f: both reports should be actioned by staff (got %)', n; END IF;
  IF NOT public.is_suspended(a) THEN RAISE EXCEPTION 'Q1g: "action + suspend" did not suspend the author'; END IF;
  SELECT count(*) INTO n FROM public.audit_log WHERE action = 'report_hide' AND target_id = rep;
  IF n <> 1 THEN RAISE EXCEPTION 'Q1h: report resolution not audited'; END IF;

  -- ── P1 payout block: core only, honest ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.staff_set_payout_block(ev_paid, true, 'chargeback risk');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'P1a: non-core staff blocked a payout'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', co, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  j := public.staff_set_payout_block(ev_paid, true, 'chargeback risk');
  IF NOT (j->>'changed')::boolean THEN RESET ROLE; RAISE EXCEPTION 'P1b: core block reported no change'; END IF;
  j := public.staff_set_payout_block(ev_paid, true, 'chargeback risk');
  RESET ROLE;
  IF (j->>'changed')::boolean THEN RAISE EXCEPTION 'P1c: a no-op block reported a change'; END IF;
  IF NOT (SELECT payout_blocked FROM public.events WHERE id = ev_paid) THEN RAISE EXCEPTION 'P1d: payout not blocked'; END IF;
  SELECT count(*) INTO n FROM public.audit_log WHERE action = 'block_payout' AND target_id = ev_paid AND staff_id = co;
  IF n <> 1 THEN RAISE EXCEPTION 'P1e: payout block not audited exactly once (got %)', n; END IF;

  -- ── K1 Studio read models ────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM * FROM public.staff_search_members('ops', 5);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'K1a: a member searched the member directory'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.staff_search_members((SELECT username FROM public.profiles WHERE id = a), 10) s
   WHERE s.id = a AND s.suspended AND s.reports_total >= 2;
  j := public.staff_launch_funnel();
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'K1b: staff search did not find the suspended, reported member'; END IF;
  IF NOT (j ? 'accounts' AND j ? 'waves' AND j ? 'approved' AND (j->>'suspended')::int >= 1) THEN
    RAISE EXCEPTION 'K1c: funnel shape wrong: %', j;
  END IF;

  -- ── E1 email queue retry: staff only, only back to pending ───────────
  INSERT INTO public.email_queue (email_type, recipient_type, recipient_user_id, payload, status, last_error)
  VALUES ('application_received', 'applicant', b, '{}'::jsonb, 'failed', 'boom') RETURNING id INTO eq;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.email_queue SET status = 'pending', last_error = NULL WHERE id = eq;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'E1a: a member re-queued an email'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.email_queue SET status = 'pending', last_error = NULL WHERE id = eq;
  GET DIAGNOSTICS n = ROW_COUNT;
  ok := false;
  BEGIN UPDATE public.email_queue SET status = 'sent' WHERE id = eq;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'E1b: staff could not retry an email'; END IF;
  IF NOT ok THEN RAISE EXCEPTION 'E1c: staff marked an email sent by hand'; END IF;

  -- ── C1 cron helpers ──────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', co, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.ops_invoke_edge('push-dispatch', '{}');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'C1a: a member could make the database call an edge function'; END IF;

  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name IN ('roxy_functions_url', 'roxy_service_role_key')) THEN
    RAISE NOTICE 'C1b skipped: this database already has the cron secrets';
  ELSE
    IF public.ops_invoke_edge('push-dispatch') IS NOT NULL THEN
      RAISE EXCEPTION 'C1b: ops_invoke_edge did not return quietly without Vault secrets';
    END IF;
    IF to_regnamespace('net') IS NOT NULL THEN
      PERFORM vault.create_secret('http://127.0.0.1:9/never', 'roxy_functions_url', 'ops131 test');
      PERFORM vault.create_secret('test-key-not-real', 'roxy_service_role_key', 'ops131 test');
      v_req := public.ops_invoke_edge('process-email-queue');
      IF v_req IS NULL THEN RAISE EXCEPTION 'C1c: ops_invoke_edge queued no request with secrets present'; END IF;
    END IF;
  END IF;
  ok := false;
  BEGIN PERFORM public.ops_invoke_edge('../auth/v1/admin');
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'C1d: ops_invoke_edge accepted a path, not a function name'; END IF;
  IF public.ops_call_if_exists('public.ops131_not_there()') THEN RAISE EXCEPTION 'C1e: missing job reported as run'; END IF;
  IF NOT public.ops_call_if_exists('public.ops_cleanup_stale_rooms()') THEN RAISE EXCEPTION 'C1f: existing job not run'; END IF;
  ok := false;
  BEGIN PERFORM public.ops_call_if_exists('public.x(); DROP TABLE public.reports; --');
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'C1g: ops_call_if_exists accepted arbitrary SQL'; END IF;

  RAISE NOTICE '131 ops launch hardening: ALL PASS';
END $$;
