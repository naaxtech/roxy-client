-- Behaviour proof for 140_supporter_entitlements.sql on a LOCAL database.
-- Runs inside one transaction that the runner ROLLS BACK (migration-proof.cjs);
-- it leaves nothing behind. Every block RAISEs on a failed expectation.
-- now() is the transaction's start time, so every period below is exact.
\set ON_ERROR_STOP on

DO $$
DECLARE
  a uuid; b uuid; d uuid; e uuid;
  ghost uuid := gen_random_uuid();
  t0 timestamptz := now();
  fn constant text :=
    'public.apply_supporter_event(text, text, text, uuid, timestamptz, text, timestamptz, text, text, text, uuid[], jsonb)';
  r text; st text; ok boolean; n int;
  rec record;
  es public.supporter_subscriptions%ROWTYPE;
  er public.supporter_entitlements%ROWTYPE;
BEGIN
  SELECT id INTO a FROM public.profiles ORDER BY created_at, id LIMIT 1;
  SELECT id INTO b FROM public.profiles WHERE id IS DISTINCT FROM a ORDER BY created_at, id LIMIT 1;
  SELECT id INTO d FROM public.profiles WHERE id NOT IN (a, b) ORDER BY created_at, id LIMIT 1;
  SELECT id INTO e FROM public.profiles WHERE id NOT IN (a, b, d) ORDER BY created_at, id LIMIT 1;
  IF e IS NULL THEN RAISE EXCEPTION 'need 4 profiles in the local db'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.supporter_subscriptions WHERE user_id IN (a, b, d, e);
  DELETE FROM public.supporter_entitlements WHERE user_id IN (a, b, d, e);
  DELETE FROM public.supporter_events WHERE id LIKE '140-%';
  UPDATE public.platform_settings
     SET supporter_enabled = true, supporter_sandbox_counts = false
   WHERE id = 1;

  -- ── T1 shape: RLS on, CHECKs hold, the switches default OFF ─────────────
  SELECT count(*) INTO n FROM pg_class
   WHERE oid IN ('public.supporter_entitlements'::regclass, 'public.supporter_subscriptions'::regclass,
                 'public.supporter_events'::regclass)
     AND relrowsecurity;
  IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'T1 RLS is on for % of 3 supporter tables', n; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.supporter_subscriptions (id, user_id, status, environment, last_event_at)
    VALUES ('140:t1', a, 'paused', 'production', t0);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T1 status ''paused'' was stored'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.supporter_subscriptions (id, user_id, status, environment, last_event_at)
    VALUES ('140:t1', a, 'active', 'staging', t0);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T1 environment ''staging'' was stored'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.supporter_entitlements (user_id, status, environment, last_event_at)
    VALUES (a, 'paused', 'production', t0);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T1 summary status ''paused'' was stored'; END IF;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'platform_settings'
     AND column_name IN ('supporter_enabled', 'supporter_sandbox_counts')
     AND column_default = 'false' AND is_nullable = 'NO';
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'T1 platform_settings switches missing or not default false (% of 2)', n; END IF;
  RAISE NOTICE 'PASS 140 T1 shape: RLS on all three tables, CHECKs hold, switches default off';

  -- ── T2 grants: owner SELECT only; events and apply are service-role only ──
  IF has_table_privilege('anon', 'public.supporter_entitlements', 'SELECT')
     OR has_table_privilege('anon', 'public.supporter_subscriptions', 'SELECT')
     OR has_table_privilege('anon', 'public.supporter_events', 'SELECT') THEN
    RAISE EXCEPTION 'T2 anon can read a supporter table';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.supporter_entitlements', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.supporter_subscriptions', 'SELECT') THEN
    RAISE EXCEPTION 'T2 authenticated cannot read her entitlement tables';
  END IF;
  FOR rec IN SELECT * FROM (VALUES ('public.supporter_entitlements'), ('public.supporter_subscriptions'),
                                   ('public.supporter_events')) v(t) LOOP
    IF has_table_privilege('authenticated', rec.t, 'INSERT')
       OR has_table_privilege('authenticated', rec.t, 'UPDATE')
       OR has_table_privilege('authenticated', rec.t, 'DELETE') THEN
      RAISE EXCEPTION 'T2 authenticated can write %', rec.t;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.supporter_events', 'SELECT') THEN
    RAISE EXCEPTION 'T2 authenticated can read supporter_events';
  END IF;
  IF has_function_privilege('authenticated', fn, 'EXECUTE')
     OR has_function_privilege('anon', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'T2 a client role can execute apply_supporter_event';
  END IF;
  IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'T2 service_role cannot execute apply_supporter_event';
  END IF;
  IF has_function_privilege('authenticated', 'public._supporter_refresh(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._supporter_refresh(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T2 a client role can execute _supporter_refresh';
  END IF;
  IF (SELECT bool_or(proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(proacl) x WHERE x.grantee = 0))
        FROM pg_proc WHERE oid IN (fn::regprocedure, 'public._supporter_refresh(uuid)'::regprocedure)) THEN
    RAISE EXCEPTION 'T2 PUBLIC can execute apply_supporter_event or _supporter_refresh';
  END IF;
  IF has_function_privilege('anon', 'public.is_supporter(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.supporter_enabled()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T2 anon can execute is_supporter / supporter_enabled';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.is_supporter(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.supporter_enabled()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T2 authenticated cannot execute is_supporter / supporter_enabled';
  END IF;
  SELECT count(*) INTO n FROM pg_proc
   WHERE oid IN ('public.is_supporter(uuid)'::regprocedure, 'public.supporter_enabled()'::regprocedure,
                 fn::regprocedure)
     AND prosecdef AND array_to_string(proconfig, ',') LIKE '%search_path=%';
  IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'T2 % of 3 definer functions pin search_path', n; END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.is_supporter(uuid)'::regprocedure) IS DISTINCT FROM 's' THEN
    RAISE EXCEPTION 'T2 is_supporter is not STABLE';
  END IF;
  RAISE NOTICE 'PASS 140 T2 grants: owner reads, nobody writes, apply is service-role only';

  -- Fixtures for T3–T5, written as the owner of the tables (bypasses RLS).
  INSERT INTO public.supporter_subscriptions
    (id, user_id, status, period_ends_at, store, product_id, environment, original_transaction_ref, last_event_at)
  VALUES ('txn:GPA.a', a, 'active', t0 + interval '30 days', 'play_store', 'roxy_supporter_monthly',
          'production', 'GPA.a', t0 - interval '1 day'),
         ('txn:rcb_b', b, 'active', t0 + interval '300 days', 'rc_billing', 'roxy_supporter_yearly',
          'production', 'rcb_b', t0 - interval '1 day');
  PERFORM public._supporter_refresh(a);
  PERFORM public._supporter_refresh(b);

  -- ── T3 a member cannot write any of it — refused, then re-read ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN
    INSERT INTO public.supporter_subscriptions (id, user_id, status, period_ends_at, environment, last_event_at)
    VALUES ('140:forged', d, 'active', 'infinity', 'production', t0);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 a member inserted her own subscription'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.supporter_entitlements (user_id, status, period_ends_at, environment, last_event_at)
    VALUES (d, 'active', 'infinity', 'production', t0);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 a member inserted her own entitlement'; END IF;
  ok := false;
  BEGIN PERFORM public._supporter_refresh(d);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 a member executed _supporter_refresh'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN UPDATE public.supporter_subscriptions SET period_ends_at = 'infinity' WHERE user_id = a;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 a member extended her own subscription'; END IF;
  ok := false;
  BEGIN UPDATE public.supporter_entitlements SET period_ends_at = 'infinity' WHERE user_id = a;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 a member extended her own entitlement'; END IF;
  ok := false;
  BEGIN DELETE FROM public.supporter_subscriptions WHERE user_id = a;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 a member deleted her subscription'; END IF;
  ok := false;
  BEGIN DELETE FROM public.supporter_entitlements WHERE user_id = a;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 a member deleted her entitlement'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.supporter_events (id, user_id, type, effect, payload, event_at)
    VALUES ('140-forged', a, 'INITIAL_PURCHASE', 'activate', '{}', t0);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 a member wrote supporter_events'; END IF;
  ok := false;
  BEGIN PERFORM 1 FROM public.supporter_events LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 a member read supporter_events'; END IF;
  RESET ROLE;
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.a';
  SELECT * INTO er FROM public.supporter_entitlements WHERE user_id = a;
  IF es.status IS DISTINCT FROM 'active' OR es.period_ends_at IS DISTINCT FROM t0 + interval '30 days'
     OR er.status IS DISTINCT FROM 'active' OR er.period_ends_at IS DISTINCT FROM t0 + interval '30 days' THEN
    RAISE EXCEPTION 'T3 re-read: her rows became % / %', es.status, er.status;
  END IF;
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.supporter_subscriptions WHERE user_id = d
    UNION ALL SELECT 1 FROM public.supporter_entitlements WHERE user_id = d
    UNION ALL SELECT 1 FROM public.supporter_events WHERE id = '140-forged') x;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'T3 re-read: % forged rows exist', n; END IF;
  RAISE NOTICE 'PASS 140 T3 members cannot insert, extend, delete or log; re-read unchanged';

  -- ── T4 she reads her own rows and nobody else's ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.supporter_entitlements;
  IF n IS DISTINCT FROM 1 OR NOT EXISTS (SELECT 1 FROM public.supporter_entitlements WHERE user_id = a) THEN
    RAISE EXCEPTION 'T4 a sees % summary rows (expected only her own)', n;
  END IF;
  SELECT count(*) INTO n FROM public.supporter_subscriptions;
  IF n IS DISTINCT FROM 1 OR NOT EXISTS (SELECT 1 FROM public.supporter_subscriptions WHERE user_id = a) THEN
    RAISE EXCEPTION 'T4 a sees % subscription rows (expected only her own)', n;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM (SELECT 1 FROM public.supporter_entitlements
                               UNION ALL SELECT 1 FROM public.supporter_subscriptions) x;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'T4 d (no entitlement) sees % rows', n; END IF;
  -- The boolean is public by design (S2 shows the mark): d may ask about a.
  IF NOT public.is_supporter(a) THEN RAISE EXCEPTION 'T4 is_supporter(a) is false for another member'; END IF;
  IF NOT public.supporter_enabled() THEN RAISE EXCEPTION 'T4 supporter_enabled() unreadable or false'; END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 140 T4 own rows only; is_supporter and the switch are readable';

  -- ── T5 is_supporter across states, periods, environments, the switch ────
  FOR rec IN
    SELECT * FROM (VALUES
      ('active',   t0 + interval '30 days', 'production', true),
      ('grace',    t0 + interval '3 days',  'production', true),
      ('active',   'infinity'::timestamptz, 'production', true),
      ('expired',  t0 + interval '30 days', 'production', false),
      ('refunded', t0 + interval '30 days', 'production', false),
      ('active',   t0 - interval '1 minute', 'production', false),
      ('grace',    t0 - interval '1 minute', 'production', false),
      ('active',   NULL::timestamptz,       'production', false),
      ('active',   t0 + interval '30 days', 'sandbox',    false)
    ) v(s, p, env, want)
  LOOP
    UPDATE public.supporter_subscriptions
       SET status = rec.s, period_ends_at = rec.p, environment = rec.env
     WHERE id = 'txn:GPA.a';
    IF public.is_supporter(a) IS DISTINCT FROM rec.want THEN
      RAISE EXCEPTION 'T5 % / % / % gave %, expected %', rec.s, rec.p, rec.env, public.is_supporter(a), rec.want;
    END IF;
  END LOOP;
  UPDATE public.platform_settings SET supporter_sandbox_counts = true WHERE id = 1;
  IF NOT public.is_supporter(a) THEN RAISE EXCEPTION 'T5 sandbox did not count with the switch on'; END IF;
  UPDATE public.platform_settings SET supporter_sandbox_counts = false WHERE id = 1;
  -- One lapsed subscription and one live one: she is a supporter.
  UPDATE public.supporter_subscriptions SET status = 'expired', environment = 'production' WHERE id = 'txn:GPA.a';
  INSERT INTO public.supporter_subscriptions
    (id, user_id, status, period_ends_at, store, environment, original_transaction_ref, last_event_at)
  VALUES ('txn:GPA.a2', a, 'active', t0 + interval '30 days', 'play_store', 'production', 'GPA.a2', t0 - interval '1 day');
  IF NOT public.is_supporter(a) THEN RAISE EXCEPTION 'T5 a live second subscription did not count'; END IF;
  UPDATE public.platform_settings SET supporter_enabled = false WHERE id = 1;
  IF public.is_supporter(a) THEN RAISE EXCEPTION 'T5 kill switch off but is_supporter(a) is true'; END IF;
  IF public.supporter_enabled() THEN RAISE EXCEPTION 'T5 supporter_enabled() ignores the switch'; END IF;
  UPDATE public.platform_settings SET supporter_enabled = true WHERE id = 1;
  IF public.is_supporter(NULL) OR public.is_supporter(d) OR public.is_supporter(ghost) THEN
    RAISE EXCEPTION 'T5 no row still counted as a supporter';
  END IF;
  RAISE NOTICE 'PASS 140 T5 is_supporter: any live production subscription, sandbox only by switch, kill switch wins';

  -- ── T6 apply_supporter_event: replay, ordering, every effect ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;

  r := public.apply_supporter_event(p_event_id => '140-e1', p_type => 'INITIAL_PURCHASE', p_effect => 'activate',
         p_user_id => d, p_event_at => t0 - interval '10 days', p_environment => 'production',
         p_period_ends_at => t0 + interval '20 days', p_store => 'play_store',
         p_product_id => 'roxy_supporter_monthly', p_original_transaction_ref => 'GPA.1',
         p_payload => '{"type":"INITIAL_PURCHASE"}');
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.1';
  SELECT * INTO er FROM public.supporter_entitlements WHERE user_id = d;
  IF r IS DISTINCT FROM 'applied' OR es.user_id IS DISTINCT FROM d OR es.status IS DISTINCT FROM 'active' OR es.period_ends_at IS DISTINCT FROM t0 + interval '20 days'
     OR es.last_event_at IS DISTINCT FROM t0 - interval '10 days'
     OR er.status IS DISTINCT FROM 'active' OR er.original_transaction_ref IS DISTINCT FROM 'GPA.1' THEN
    RAISE EXCEPTION 'T6 initial purchase: % -> % until % / summary %', r, es.status, es.period_ends_at, er.status;
  END IF;

  -- The same event id again, even claiming another effect, changes nothing.
  r := public.apply_supporter_event(p_event_id => '140-e1', p_type => 'EXPIRATION', p_effect => 'expire',
         p_user_id => d, p_event_at => t0, p_environment => 'production', p_period_ends_at => t0,
         p_store => 'play_store', p_original_transaction_ref => 'GPA.1');
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.1';
  SELECT count(*) INTO n FROM public.supporter_events WHERE id = '140-e1';
  IF r IS DISTINCT FROM 'duplicate' OR es.status IS DISTINCT FROM 'active' OR n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T6 replay: % -> %, % event rows', r, es.status, n;
  END IF;
  IF (SELECT effect FROM public.supporter_events WHERE id = '140-e1') IS DISTINCT FROM 'activate' THEN
    RAISE EXCEPTION 'T6 replay rewrote the logged event';
  END IF;

  -- Out of order: an EXPIRATION generated before the purchase lands after it.
  r := public.apply_supporter_event(p_event_id => '140-e2', p_type => 'EXPIRATION', p_effect => 'expire',
         p_user_id => d, p_event_at => t0 - interval '20 days', p_environment => 'production',
         p_period_ends_at => t0 - interval '20 days', p_store => 'play_store', p_original_transaction_ref => 'GPA.1');
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.1';
  IF r IS DISTINCT FROM 'stale' OR es.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'T6 out-of-order: an older EXPIRATION gave % and left her %', r, es.status;
  END IF;

  r := public.apply_supporter_event(p_event_id => '140-e3', p_type => 'BILLING_ISSUE', p_effect => 'grace',
         p_user_id => d, p_event_at => t0 - interval '5 days', p_environment => 'production',
         p_period_ends_at => t0 + interval '2 days', p_store => 'play_store', p_original_transaction_ref => 'GPA.1');
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.1';
  IF r IS DISTINCT FROM 'applied' OR es.status IS DISTINCT FROM 'grace' OR es.period_ends_at IS DISTINCT FROM t0 + interval '2 days'
     OR NOT public.is_supporter(d) THEN
    RAISE EXCEPTION 'T6 billing issue: % -> % until %', r, es.status, es.period_ends_at;
  END IF;

  -- Informational effects: logged, the row (and its clock) untouched.
  r := public.apply_supporter_event(p_event_id => '140-e4', p_type => 'CANCELLATION', p_effect => 'cancel',
         p_user_id => d, p_event_at => t0 - interval '4 days', p_environment => 'production',
         p_period_ends_at => t0 - interval '1 day', p_store => 'play_store', p_original_transaction_ref => 'GPA.1');
  st := public.apply_supporter_event(p_event_id => '140-e5', p_type => 'PRODUCT_CHANGE', p_effect => 'change',
         p_user_id => d, p_event_at => t0 - interval '3 days', p_environment => 'production',
         p_period_ends_at => t0 - interval '1 day', p_store => 'play_store', p_original_transaction_ref => 'GPA.1');
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.1';
  IF r IS DISTINCT FROM 'logged' OR st IS DISTINCT FROM 'logged' OR es.status IS DISTINCT FROM 'grace' OR es.period_ends_at IS DISTINCT FROM t0 + interval '2 days'
     OR es.last_event_at IS DISTINCT FROM t0 - interval '5 days' THEN
    RAISE EXCEPTION 'T6 cancel/change: % / % -> % until % (last %)', r, st, es.status, es.period_ends_at, es.last_event_at;
  END IF;

  r := public.apply_supporter_event(p_event_id => '140-e6', p_type => 'EXPIRATION', p_effect => 'expire',
         p_user_id => d, p_event_at => t0 - interval '1 day', p_environment => 'production',
         p_period_ends_at => t0 - interval '1 day', p_store => 'play_store', p_original_transaction_ref => 'GPA.1');
  SELECT * INTO er FROM public.supporter_entitlements WHERE user_id = d;
  IF r IS DISTINCT FROM 'applied' OR er.status IS DISTINCT FROM 'expired' OR public.is_supporter(d) THEN
    RAISE EXCEPTION 'T6 expiration: % -> summary %', r, er.status;
  END IF;

  -- A delayed RENEWAL from before the expiration cannot resurrect her.
  r := public.apply_supporter_event(p_event_id => '140-e7', p_type => 'RENEWAL', p_effect => 'activate',
         p_user_id => d, p_event_at => t0 - interval '2 days', p_environment => 'production',
         p_period_ends_at => t0 + interval '28 days', p_store => 'play_store', p_original_transaction_ref => 'GPA.1');
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.1';
  IF r IS DISTINCT FROM 'stale' OR es.status IS DISTINCT FROM 'expired' OR public.is_supporter(d) THEN
    RAISE EXCEPTION 'T6 out-of-order: an older RENEWAL resurrected an expired subscription (% -> %)', r, es.status;
  END IF;
  IF (SELECT result FROM public.supporter_events WHERE id = '140-e7') IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'T6 the stale RENEWAL was not logged as stale';
  END IF;

  -- Two Play subscriptions at once (a still-running cancelled monthly, then a
  -- yearly): the monthly's EXPIRATION must not take the yearly away.
  r := public.apply_supporter_event(p_event_id => '140-e8', p_type => 'RENEWAL', p_effect => 'activate',
         p_user_id => d, p_event_at => t0, p_environment => 'production', p_period_ends_at => t0 + interval '30 days',
         p_store => 'play_store', p_product_id => 'roxy_supporter_monthly', p_original_transaction_ref => 'GPA.1');
  st := public.apply_supporter_event(p_event_id => '140-e9', p_type => 'INITIAL_PURCHASE', p_effect => 'activate',
         p_user_id => d, p_event_at => t0 + interval '1 second', p_environment => 'production',
         p_period_ends_at => t0 + interval '365 days', p_store => 'play_store',
         p_product_id => 'roxy_supporter_yearly', p_original_transaction_ref => 'GPA.2');
  IF r IS DISTINCT FROM 'applied' OR st IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'T6 two subscriptions: % / %', r, st; END IF;
  r := public.apply_supporter_event(p_event_id => '140-e10', p_type => 'EXPIRATION', p_effect => 'expire',
         p_user_id => d, p_event_at => t0 + interval '2 seconds', p_environment => 'production',
         p_period_ends_at => t0, p_store => 'play_store', p_original_transaction_ref => 'GPA.1');
  SELECT * INTO er FROM public.supporter_entitlements WHERE user_id = d;
  IF r IS DISTINCT FROM 'applied' OR NOT public.is_supporter(d) THEN
    RAISE EXCEPTION 'T6 the monthly''s EXPIRATION took the yearly away (%, supporter=%)', r, public.is_supporter(d);
  END IF;
  IF er.status IS DISTINCT FROM 'active' OR er.original_transaction_ref IS DISTINCT FROM 'GPA.2' OR er.period_ends_at IS DISTINCT FROM t0 + interval '365 days'
     OR er.last_event_at IS DISTINCT FROM t0 + interval '2 seconds' THEN
    RAISE EXCEPTION 'T6 summary should show the yearly: % % until % (last %)',
      er.status, er.original_transaction_ref, er.period_ends_at, er.last_event_at;
  END IF;

  -- No store on this one (RevenueCat sends store only "sometimes"): it must
  -- still land on the same subscription, and keep the store it already had.
  r := public.apply_supporter_event(p_event_id => '140-e11', p_type => 'CANCELLATION', p_effect => 'refund',
         p_user_id => d, p_event_at => t0 + interval '3 seconds', p_environment => 'production',
         p_period_ends_at => t0, p_original_transaction_ref => 'GPA.2');
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.2';
  SELECT * INTO er FROM public.supporter_entitlements WHERE user_id = d;
  IF r IS DISTINCT FROM 'applied' OR es.status IS DISTINCT FROM 'refunded' OR es.store IS DISTINCT FROM 'play_store'
     OR public.is_supporter(d) OR coalesce(er.status, '') NOT IN ('expired', 'refunded') THEN
    RAISE EXCEPTION 'T6 refund: % -> % store % (summary %)', r, es.status, es.store, er.status;
  END IF;

  r := public.apply_supporter_event(p_event_id => '140-e12', p_type => 'TEST', p_effect => 'log',
         p_user_id => d, p_event_at => t0 + interval '4 seconds', p_environment => 'sandbox');
  SELECT count(*) INTO n FROM public.supporter_subscriptions WHERE user_id = d;
  IF r IS DISTINCT FROM 'logged' OR n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'T6 TEST event: % (% rows)', r, n; END IF;

  -- Informational effects never create a row.
  r := public.apply_supporter_event(p_event_id => '140-e13', p_type => 'CANCELLATION', p_effect => 'cancel',
         p_user_id => e, p_event_at => t0, p_environment => 'production', p_period_ends_at => t0 + interval '9 days',
         p_store => 'play_store', p_original_transaction_ref => 'GPA.e');
  st := public.apply_supporter_event(p_event_id => '140-e14', p_type => 'PRODUCT_CHANGE', p_effect => 'change',
         p_user_id => e, p_event_at => t0, p_environment => 'production', p_period_ends_at => t0 + interval '9 days',
         p_store => 'play_store', p_original_transaction_ref => 'GPA.e');
  SELECT count(*) INTO n FROM (SELECT 1 FROM public.supporter_subscriptions WHERE user_id = e
                               UNION ALL SELECT 1 FROM public.supporter_entitlements WHERE user_id = e) x;
  IF r IS DISTINCT FROM 'logged' OR st IS DISTINCT FROM 'logged' OR n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'T6 cancel/change for a member with no row: % / %, % rows', r, st, n;
  END IF;

  -- Not a member: logged with no user, nothing granted.
  r := public.apply_supporter_event(p_event_id => '140-e15', p_type => 'INITIAL_PURCHASE', p_effect => 'activate',
         p_user_id => ghost, p_event_at => t0, p_environment => 'production', p_period_ends_at => 'infinity',
         p_store => 'play_store', p_original_transaction_ref => 'GPA.ghost');
  st := public.apply_supporter_event(p_event_id => '140-e16', p_type => 'INITIAL_PURCHASE', p_effect => 'activate',
         p_user_id => NULL, p_event_at => t0, p_environment => 'production', p_period_ends_at => 'infinity',
         p_store => 'play_store', p_original_transaction_ref => 'GPA.nobody');
  IF r IS DISTINCT FROM 'unknown_user' OR st IS DISTINCT FROM 'unknown_user'
     OR (SELECT user_id FROM public.supporter_events WHERE id = '140-e15') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.supporter_subscriptions WHERE id IN ('txn:GPA.ghost', 'txn:GPA.nobody')) THEN
    RAISE EXCEPTION 'T6 unknown user: % / %', r, st;
  END IF;

  -- Sandbox is its own subscription: a sandbox expiry cannot touch production.
  r := public.apply_supporter_event(p_event_id => '140-e17', p_type => 'INITIAL_PURCHASE', p_effect => 'activate',
         p_user_id => e, p_event_at => t0, p_environment => 'production', p_period_ends_at => t0 + interval '30 days',
         p_store => 'play_store', p_original_transaction_ref => 'GPA.e1');
  st := public.apply_supporter_event(p_event_id => '140-e18', p_type => 'INITIAL_PURCHASE', p_effect => 'activate',
         p_user_id => e, p_event_at => t0 + interval '1 minute', p_environment => 'sandbox',
         p_period_ends_at => t0 + interval '5 minutes', p_store => 'play_store', p_original_transaction_ref => 'GPA.sbx');
  IF r IS DISTINCT FROM 'applied' OR st IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'T6 sandbox + production purchases: % / %', r, st; END IF;
  r := public.apply_supporter_event(p_event_id => '140-e19', p_type => 'EXPIRATION', p_effect => 'expire',
         p_user_id => e, p_event_at => t0 + interval '6 minutes', p_environment => 'sandbox',
         p_period_ends_at => t0 + interval '5 minutes', p_store => 'play_store', p_original_transaction_ref => 'GPA.sbx');
  SELECT * INTO er FROM public.supporter_entitlements WHERE user_id = e;
  IF r IS DISTINCT FROM 'applied' OR NOT public.is_supporter(e) OR er.environment IS DISTINCT FROM 'production' OR er.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'T6 sandbox expiry reached production: % supporter=% summary % %', r, public.is_supporter(e),
      er.environment, er.status;
  END IF;

  -- The subscription changed hands (TRANSFER still in flight): a newer event
  -- for the new owner moves it, and the old owner no longer has it.
  r := public.apply_supporter_event(p_event_id => '140-e20', p_type => 'RENEWAL', p_effect => 'activate',
         p_user_id => a, p_event_at => t0 + interval '1 hour', p_environment => 'production',
         p_period_ends_at => t0 + interval '60 days', p_store => 'play_store', p_original_transaction_ref => 'GPA.e1');
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.e1';
  IF r IS DISTINCT FROM 'applied' OR es.user_id IS DISTINCT FROM a OR public.is_supporter(e) THEN
    RAISE EXCEPTION 'T6 a subscription owned by another member did not move (% owner=% e=%)', r, es.user_id,
      public.is_supporter(e);
  END IF;

  ok := false;
  BEGIN
    PERFORM public.apply_supporter_event(p_event_id => '140-bad', p_type => 'INITIAL_PURCHASE', p_effect => 'grant_forever',
              p_user_id => d, p_event_at => t0, p_environment => 'production');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE; ok := st = '22023';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T6 an unknown effect was accepted (sqlstate %)', st; END IF;
  ok := false;
  BEGIN
    PERFORM public.apply_supporter_event(p_event_id => '140-bad2', p_type => 'RENEWAL', p_effect => 'activate',
              p_user_id => d, p_event_at => t0 + interval '1 day', p_environment => NULL,
              p_period_ends_at => t0 + interval '30 days', p_original_transaction_ref => 'GPA.1');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE; ok := st = '22023';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T6 a state effect without an environment was accepted (sqlstate %)', st; END IF;
  ok := false;
  BEGIN
    PERFORM public.apply_supporter_event(p_event_id => '140-bad3', p_type => 'RENEWAL', p_effect => 'activate',
              p_user_id => d, p_event_at => t0 + interval '1 day', p_environment => 'production',
              p_period_ends_at => t0 + interval '30 days');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE; ok := st = '22023';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T6 a state effect naming no subscription was accepted (sqlstate %)', st; END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 140 T6 apply: replay no-op, older events stale, subscriptions independent, every effect as mapped';

  -- ── T7 TRANSFER moves her subscriptions from that store ─────────────────
  INSERT INTO public.supporter_subscriptions
    (id, user_id, status, period_ends_at, store, environment, original_transaction_ref, last_event_at)
  VALUES ('txn:GPA.b', b, 'active', t0 + interval '30 days', 'play_store', 'production', 'GPA.b', t0 - interval '1 day');
  PERFORM public._supporter_refresh(b);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;

  r := public.apply_supporter_event(p_event_id => '140-e30', p_type => 'TRANSFER', p_effect => 'transfer',
         p_user_id => d, p_event_at => t0 + interval '2 hours', p_store => 'play_store',
         p_from_user_ids => ARRAY[b, ghost]);
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.b';
  IF r IS DISTINCT FROM 'applied' OR es.user_id IS DISTINCT FROM d OR es.status IS DISTINCT FROM 'active' OR es.last_event_at IS DISTINCT FROM t0 + interval '2 hours'
     OR NOT public.is_supporter(d) THEN
    RAISE EXCEPTION 'T7 Play transfer: % owner=% status=%', r, es.user_id, es.status;
  END IF;
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:rcb_b';
  IF es.user_id IS DISTINCT FROM b OR NOT public.is_supporter(b) THEN
    RAISE EXCEPTION 'T7 a Play transfer took her web subscription (owner=%, supporter=%)', es.user_id, public.is_supporter(b);
  END IF;

  -- A delayed pre-transfer event for the source cannot take it back.
  r := public.apply_supporter_event(p_event_id => '140-e31', p_type => 'RENEWAL', p_effect => 'activate',
         p_user_id => b, p_event_at => t0 + interval '1 hour', p_environment => 'production',
         p_period_ends_at => t0 + interval '60 days', p_store => 'play_store', p_original_transaction_ref => 'GPA.b');
  SELECT * INTO es FROM public.supporter_subscriptions WHERE id = 'txn:GPA.b';
  IF r IS DISTINCT FROM 'stale' OR es.user_id IS DISTINCT FROM d THEN
    RAISE EXCEPTION 'T7 a pre-transfer RENEWAL handed it back to the source (% owner=%)', r, es.user_id;
  END IF;

  -- No store on the event: everything she had moves; her summary lapses.
  r := public.apply_supporter_event(p_event_id => '140-e32', p_type => 'TRANSFER', p_effect => 'transfer',
         p_user_id => d, p_event_at => t0 + interval '3 hours', p_from_user_ids => ARRAY[b]);
  SELECT * INTO er FROM public.supporter_entitlements WHERE user_id = b;
  IF r IS DISTINCT FROM 'applied' OR public.is_supporter(b) OR er.status IS DISTINCT FROM 'expired'
     OR EXISTS (SELECT 1 FROM public.supporter_subscriptions WHERE user_id = b) THEN
    RAISE EXCEPTION 'T7 storeless transfer: % b supporter=% summary %', r, public.is_supporter(b), er.status;
  END IF;

  -- Moved to someone who is not a member: the source still loses it.
  r := public.apply_supporter_event(p_event_id => '140-e33', p_type => 'TRANSFER', p_effect => 'transfer',
         p_user_id => NULL, p_event_at => t0 + interval '4 hours', p_from_user_ids => ARRAY[d]);
  IF r IS DISTINCT FROM 'applied' OR public.is_supporter(d)
     OR EXISTS (SELECT 1 FROM public.supporter_subscriptions WHERE user_id = d AND status IN ('active', 'grace')) THEN
    RAISE EXCEPTION 'T7 transfer to a non-member left the source entitled (% supporter=%)', r, public.is_supporter(d);
  END IF;

  r := public.apply_supporter_event(p_event_id => '140-e34', p_type => 'TRANSFER', p_effect => 'transfer',
         p_user_id => a, p_event_at => t0 + interval '5 hours', p_from_user_ids => ARRAY[ghost]);
  st := public.apply_supporter_event(p_event_id => '140-e35', p_type => 'TRANSFER', p_effect => 'transfer',
         p_user_id => NULL, p_event_at => t0 + interval '5 hours', p_from_user_ids => ARRAY[ghost]);
  IF r IS DISTINCT FROM 'logged' OR st IS DISTINCT FROM 'unknown_user' OR NOT public.is_supporter(a) THEN
    RAISE EXCEPTION 'T7 nothing to move: % / %', r, st;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 140 T7 TRANSFER moves that store''s subscriptions, a late source event is stale, a non-member destination still revokes';

  -- ── T8 only the service role can apply — the grant AND the body say so ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN
    PERFORM public.apply_supporter_event(p_event_id => '140-self', p_type => 'INITIAL_PURCHASE', p_effect => 'activate',
              p_user_id => d, p_event_at => t0 + interval '1 day', p_environment => 'production',
              p_period_ends_at => 'infinity', p_original_transaction_ref => 'GPA.self');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T8 a member executed apply_supporter_event'; END IF;
  RESET ROLE;
  -- Even a role holding EXECUTE (here the owner) is refused without the service-role claim,
  -- so a later accidental GRANT TO authenticated still cannot mint an entitlement.
  ok := false;
  BEGIN
    PERFORM public.apply_supporter_event(p_event_id => '140-owner', p_type => 'INITIAL_PURCHASE', p_effect => 'activate',
              p_user_id => d, p_event_at => t0 + interval '1 day', p_environment => 'production',
              p_period_ends_at => 'infinity', p_original_transaction_ref => 'GPA.owner');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T8 apply_supporter_event ran without the service-role claim'; END IF;
  SELECT count(*) INTO n FROM public.supporter_events WHERE id IN ('140-self', '140-owner');
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'T8 a refused call left % event rows', n; END IF;
  RAISE NOTICE 'PASS 140 T8 apply_supporter_event: refused for members and without the service-role claim';

  -- ── T9 anon: no way in ──────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  FOR rec IN SELECT * FROM (VALUES ('public.supporter_entitlements'), ('public.supporter_subscriptions'),
                                   ('public.supporter_events')) v(t) LOOP
    ok := false;
    BEGIN EXECUTE format('SELECT 1 FROM %s LIMIT 1', rec.t);
    EXCEPTION WHEN insufficient_privilege THEN ok := true;
    END;
    IF NOT ok THEN RAISE EXCEPTION 'T9 anon read %', rec.t; END IF;
  END LOOP;
  ok := false;
  BEGIN PERFORM public.is_supporter(a);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T9 anon executed is_supporter'; END IF;
  ok := false;
  BEGIN PERFORM public.supporter_enabled();
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T9 anon executed supporter_enabled'; END IF;
  ok := false;
  BEGIN
    PERFORM public.apply_supporter_event(p_event_id => '140-anon', p_type => 'INITIAL_PURCHASE', p_effect => 'activate',
              p_user_id => d, p_event_at => t0 + interval '1 day', p_environment => 'production');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T9 anon executed apply_supporter_event'; END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 140 T9 anon can neither read, ask, nor apply';
END $$;

-- Leave no identity behind for a stacked check: auth.uid() reads claim.sub
-- first, then claims.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
