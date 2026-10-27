-- Behaviour proof for 139_nearby_communities.sql on a LOCAL database.
-- Runs inside one transaction that the runner ROLLS BACK (migration-proof.cjs);
-- it leaves nothing behind. Every block RAISEs on a failed expectation.
-- Test cities use ids from 2100000001, above every GeoNames geonameid.
\set ON_ERROR_STOP on

-- Run q as member u (NULL = anon) and return its single text value, or
-- 'ERR <sqlstate> <message>'. Called by postgres; it sets and resets the role
-- itself, because authenticated cannot execute pg_temp functions.
CREATE OR REPLACE FUNCTION pg_temp.as139(u uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  IF u IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    SET LOCAL ROLE anon;
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u::text, true);
    SET LOCAL ROLE authenticated;
  END IF;
  EXECUTE q INTO r;
  RESET ROLE;
  RETURN coalesce(r, 'NULL');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR ' || SQLSTATE || ' ' || SQLERRM;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.is139(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION '% -- expected "%", got "%"', label, want, coalesce(got, 'NULL');
  END IF;
END $f$;

-- Rows written to any table so far in this transaction (backend-local stats).
CREATE OR REPLACE FUNCTION pg_temp.writes139() RETURNS bigint LANGUAGE sql AS $f$
  SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint FROM pg_stat_xact_all_tables;
$f$;

DO $$
DECLARE
  ids uuid[];
  a uuid; b uuid; d uuid; s uuid;
  k_near uuid; k_bravo uuid; k_priv uuid; k_charlie uuid; k_delta uuid; k_echo uuid; k_fox uuid;
  k_online uuid; k_joined uuid; k_banned uuid; k_blocked uuid; k_noloc uuid; k_invited uuid;
  k_modded uuid; k_wrap uuid; k_pole uuid; k_round uuid; k_half uuid;
  c_a constant int := 2100000001; c_b constant int := 2100000002; c_c constant int := 2100000003;
  c_d constant int := 2100000004; c_e constant int := 2100000005; c_f constant int := 2100000006;
  c_p constant int := 2100000007; c_r constant int := 2100000008; c_w constant int := 2100000009;
  c_n constant int := 2100000010; c_z constant int := 2100000011;
  near_q constant text := 'SELECT string_agg(slug || '':'' || distance_band, '','' ORDER BY slug) FROM public.suggest_nearby_communities(';
  r text; n int; ok boolean; w0 bigint; w1 bigint; w2 bigint;
  fn regprocedure; v_def text;
  la double precision; ln double precision; cid int; mt text;
BEGIN
  SELECT array_agg(id ORDER BY created_at, id) INTO ids FROM (
    SELECT id, created_at FROM public.profiles ORDER BY created_at, id LIMIT 4
  ) x;
  IF cardinality(ids) < 4 THEN RAISE EXCEPTION 'need 4 profiles in the local db'; END IF;
  a := ids[1];  -- she is looking
  b := ids[2];  -- a woman she has blocked, who runs one community
  d := ids[3];  -- runs most of the fixture communities
  s := ids[4];  -- Roxy staff
  -- Reset whatever earlier checks in a stacked proof left on these rows.
  UPDATE public.profiles SET vetting_status = 'approved', is_staff = false, deleted_at = NULL WHERE id = ANY (ids);
  UPDATE public.profiles SET is_staff = true WHERE id = s;
  IF to_regclass('public.account_suspensions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.account_suspensions WHERE user_id = ANY ($1)' USING ids;
  END IF;
  DELETE FROM public.friendships WHERE requester_id = ANY (ids) AND addressee_id = ANY (ids);
  DELETE FROM public.communities WHERE slug LIKE '139-%';
  DELETE FROM public.cities WHERE id >= 2100000001;

  -- ── Fixture: cities north of her (14.6, 121.0), one band each ─────────────
  INSERT INTO public.cities (id, name, ascii_name, admin1, country_code, lat, lng, population) VALUES
    (c_a, 'Nearbytest Alpha',   'Nearbytest Alpha',   'Test Region', 'PH', 14.65, 121.0, 500000), --   5.6 km
    (c_b, 'Nearbytest Bravo',   'Nearbytest Bravo',   'Test Region', 'PH', 14.75, 121.0, 400000), --  16.7 km
    (c_c, 'Nearbytest Charlie', 'Nearbytest Charlie', 'Test Region', 'PH', 14.95, 121.0, 300000), --  38.9 km
    (c_d, 'Nearbytest Delta',   'Nearbytest Delta',   'Test Region', 'PH', 15.30, 121.0, 200000), --  77.8 km
    (c_e, 'Nearbytest Echo',    'Nearbytest Echo',    'Test Region', 'PH', 16.00, 121.0, 100000), -- 155.7 km
    (c_f, 'Nearbytest Foxtrot', 'Nearbytest Foxtrot', 'Test Region', 'TW', 24.60, 121.0,  50000), -- 1112 km
    (c_p, U&'Para\00F1aquetest', 'Paranaquetest',     'Test Region', 'PH', 14.48, 121.02, 600000),
    (c_r, 'Roundingtest',       'Roundingtest',       NULL,          'PH', 14.123456, 121.987654, 1),
    (c_w, 'Wraptest',           'Wraptest',           NULL,          'FJ', 0.0, -179.95, 10),
    (c_n, 'Poletest',           'Poletest',           NULL,          'AQ', 89.95, 180.0, 10),
    (c_z, U&'Z\00FCrichtest',     'Zuerichtest',        NULL,          'CH', 47.37, 8.55, 10);
  INSERT INTO public.cities (id, name, ascii_name, country_code, lat, lng, population)
  SELECT 2100000100 + i, 'Zzlimittest ' || i, 'Zzlimittest ' || i, 'PH', 0, 0, i
  FROM generate_series(1, 12) AS i;

  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Near',     '139-near',     'location', false, d, c_a, 'in_person') RETURNING id INTO k_near;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Bravo',    '139-bravo',    'interest', false, d, c_b, 'both')      RETURNING id INTO k_bravo;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Private',  '139-private',  'support',  true,  d, c_c, 'in_person') RETURNING id INTO k_priv;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Charlie',  '139-charlie',  'support',  false, d, c_c, 'in_person') RETURNING id INTO k_charlie;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Delta',    '139-delta',    'identity', false, d, c_d, 'in_person') RETURNING id INTO k_delta;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Echo',     '139-echo',     'interest', false, d, c_e, 'both')      RETURNING id INTO k_echo;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Foxtrot',  '139-foxtrot',  'location', false, d, c_f, 'in_person') RETURNING id INTO k_fox;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Online',   '139-online',   'location', false, d, c_a, 'online')    RETURNING id INTO k_online;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Joined',   '139-joined',   'location', false, d, c_a, 'in_person') RETURNING id INTO k_joined;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Banned',   '139-banned',   'location', false, d, c_a, 'in_person') RETURNING id INTO k_banned;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Blocked',  '139-blocked',  'location', false, b, c_a, 'in_person') RETURNING id INTO k_blocked;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 No place', '139-noloc',    'location', false, d, NULL, 'online') RETURNING id INTO k_noloc;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Invited',  '139-invited',  'identity', true,  d, c_b, 'in_person') RETURNING id INTO k_invited;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Modded',   '139-modded',   'interest', false, d, NULL, 'online')   RETURNING id INTO k_modded;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Wrap',     '139-wrap',     'interest', false, d, c_w, 'in_person') RETURNING id INTO k_wrap;
  INSERT INTO public.communities (name, slug, category, is_private, created_by, city_id, meets) VALUES
    ('139 Pole',     '139-pole',     'interest', false, d, c_n, 'in_person') RETURNING id INTO k_pole;

  INSERT INTO public.community_members (community_id, user_id, role) VALUES
    (k_joined, a, 'member'), (k_modded, a, 'moderator');
  INSERT INTO public.community_bans (community_id, user_id, banned_by, reason) VALUES (k_banned, a, d, '139');
  INSERT INTO public.community_join_requests (community_id, user_id, kind, status, invited_by)
  VALUES (k_invited, a, 'invite', 'pending', d);
  INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES (a, b, 'blocked');

  -- ── T1 shape: cities is RLS'd reference data members can only read ─────
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cities'::regclass) THEN
    RAISE EXCEPTION 'T1 RLS is off on cities';
  END IF;
  IF has_table_privilege('anon', 'public.cities', 'SELECT') THEN RAISE EXCEPTION 'T1 anon can read cities'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.cities', 'SELECT') THEN
    RAISE EXCEPTION 'T1 authenticated cannot read cities';
  END IF;
  IF has_table_privilege('authenticated', 'public.cities', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cities', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cities', 'DELETE') THEN
    RAISE EXCEPTION 'T1 authenticated can write cities';
  END IF;
  PERFORM pg_temp.is139('T1 member reads a city',
    pg_temp.as139(a, format('SELECT name FROM public.cities WHERE id = %s', c_a)), 'Nearbytest Alpha');
  PERFORM pg_temp.is139('T1 member writes a city',
    left(pg_temp.as139(a, format('WITH u AS (UPDATE public.cities SET population = 1 WHERE id = %s RETURNING 1) SELECT count(*)::text FROM u', c_a)), 9),
    'ERR 42501');
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'cities'
                 AND indexdef ILIKE '%lower(ascii_name) text_pattern_ops%population%') THEN
    RAISE EXCEPTION 'T1 no prefix index on lower(ascii_name) text_pattern_ops + population';
  END IF;
  RAISE NOTICE 'PASS 139 T1 cities: RLS on, members read only, anon nothing, prefix index';

  -- ── T2 the location columns are not hers to write; the old ones still are ─
  IF has_column_privilege('authenticated', 'public.communities', 'lat', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.communities', 'lng', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.communities', 'city_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.communities', 'meets', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.communities', 'lat', 'INSERT')
     OR has_column_privilege('authenticated', 'public.communities', 'lng', 'INSERT')
     OR has_column_privilege('authenticated', 'public.communities', 'city_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.communities', 'meets', 'INSERT') THEN
    RAISE EXCEPTION 'T2 authenticated can write a location column directly';
  END IF;
  IF NOT (has_column_privilege('authenticated', 'public.communities', 'description', 'UPDATE')
          AND has_column_privilege('authenticated', 'public.communities', 'name', 'INSERT')
          AND has_column_privilege('authenticated', 'public.communities', 'meets', 'SELECT')
          AND has_column_privilege('authenticated', 'public.communities', 'lat', 'SELECT')) THEN
    RAISE EXCEPTION 'T2 lost an existing communities privilege (select * would break)';
  END IF;

  -- The owner (d, created_by) is refused on each new column, and nothing moves.
  PERFORM pg_temp.is139('T2 owner writes lat',
    left(pg_temp.as139(d, format('WITH u AS (UPDATE public.communities SET lat = 0 WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u', k_near)), 9), 'ERR 42501');
  PERFORM pg_temp.is139('T2 owner writes lng',
    left(pg_temp.as139(d, format('WITH u AS (UPDATE public.communities SET lng = 0 WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u', k_near)), 9), 'ERR 42501');
  PERFORM pg_temp.is139('T2 owner writes city_id',
    left(pg_temp.as139(d, format('WITH u AS (UPDATE public.communities SET city_id = %s WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u', c_f, k_near)), 9), 'ERR 42501');
  PERFORM pg_temp.is139('T2 owner writes meets',
    left(pg_temp.as139(d, format('WITH u AS (UPDATE public.communities SET meets = %L WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u', 'online', k_near)), 9), 'ERR 42501');
  SELECT lat, lng, city_id, meets INTO la, ln, cid, mt FROM public.communities WHERE id = k_near;
  IF la IS DISTINCT FROM 14.65 OR ln IS DISTINCT FROM 121.0 OR cid IS DISTINCT FROM c_a OR mt IS DISTINCT FROM 'in_person' THEN
    RAISE EXCEPTION 'T2 a refused write moved the row: % % % %', la, ln, cid, mt;
  END IF;
  -- Existing behaviour holds: she still edits her own description directly.
  PERFORM pg_temp.is139('T2 owner edits description',
    pg_temp.as139(d, format('WITH u AS (UPDATE public.communities SET description = %L WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u', '139 still hers', k_near)), '1');
  -- A member's direct create still works (old columns only) and lands online.
  PERFORM pg_temp.is139('T2 member creates directly',
    pg_temp.as139(a, format('WITH i AS (INSERT INTO public.communities (name, slug, category, created_by) VALUES (%L, %L, %L, %L) RETURNING meets, city_id, lat) SELECT meets || coalesce(city_id::text, ''-'') || coalesce(lat::text, ''-'') FROM i',
      '139 Direct', '139-direct', 'interest', a)), 'online--');
  PERFORM pg_temp.is139('T2 member creates with a city',
    left(pg_temp.as139(a, format('WITH i AS (INSERT INTO public.communities (name, slug, category, created_by, city_id) VALUES (%L, %L, %L, %L, %s) RETURNING 1) SELECT count(*)::text FROM i',
      '139 Direct2', '139-direct2', 'interest', a, c_a)), 9), 'ERR 42501');
  PERFORM pg_temp.is139('T2 member creates with lat',
    left(pg_temp.as139(a, format('WITH i AS (INSERT INTO public.communities (name, slug, category, created_by, lat) VALUES (%L, %L, %L, %L, 1) RETURNING 1) SELECT count(*)::text FROM i',
      '139 Direct3', '139-direct3', 'interest', a)), 9), 'ERR 42501');
  RAISE NOTICE 'PASS 139 T2 owners and members cannot write lat/lng/city_id/meets; old columns unchanged';

  -- ── T3 the point is always the rounded city centroid ────────────────────
  UPDATE public.communities SET lat = 1, lng = 2 WHERE id = k_near;  -- postgres, past every grant
  SELECT lat, lng INTO la, ln FROM public.communities WHERE id = k_near;
  IF la IS DISTINCT FROM 14.65 OR ln IS DISTINCT FROM 121.0 THEN
    RAISE EXCEPTION 'T3 a spoofed point survived: % %', la, ln;
  END IF;
  INSERT INTO public.communities (name, slug, category, created_by, city_id, meets)
  VALUES ('139 Round', '139-round', 'interest', d, c_r, 'both') RETURNING id INTO k_round;
  SELECT lat, lng INTO la, ln FROM public.communities WHERE id = k_round;
  IF la IS DISTINCT FROM 14.12 OR ln IS DISTINCT FROM 121.99 THEN
    RAISE EXCEPTION 'T3 centroid not rounded to 2 dp: % %', la, ln;
  END IF;
  DELETE FROM public.communities WHERE id = k_round;  -- ~118 km from her; keep T5's set exact
  RAISE NOTICE 'PASS 139 T3 lat/lng come only from the city, rounded to 2 dp';

  -- ── T4 CHECKs: meets vocabulary; a point never without its city ─────────
  ok := false;
  BEGIN UPDATE public.communities SET meets = 'weekly' WHERE id = k_near;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T4 meets accepted "weekly"'; END IF;
  ok := false;
  BEGIN INSERT INTO public.communities (name, slug, category, created_by, meets) VALUES ('139 Nowhere', '139-nowhere', 'interest', d, 'in_person');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T4 an in-person community without a city was stored'; END IF;
  INSERT INTO public.communities (name, slug, category, created_by)
  VALUES ('139 Half', '139-half', 'interest', d) RETURNING id INTO k_half;
  -- Triggers off for this statement, so only the CHECK stands in the way.
  SET LOCAL session_replication_role = replica;
  ok := false;
  BEGIN UPDATE public.communities SET lat = 5, lng = 5 WHERE id = k_half;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN SET LOCAL session_replication_role = origin; RAISE EXCEPTION 'T4 a point without a city was stored'; END IF;
  ok := false;
  BEGIN UPDATE public.communities SET lat = NULL WHERE id = k_near;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  SET LOCAL session_replication_role = origin;
  IF NOT ok THEN RAISE EXCEPTION 'T4 a city without its point was stored'; END IF;
  ok := false;
  BEGIN INSERT INTO public.cities (id, name, ascii_name, country_code, lat, lng) VALUES (2100000099, 'x', 'x', 'ph', 0, 0);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T4 cities accepted a lower-case country code'; END IF;
  ok := false;
  BEGIN INSERT INTO public.cities (id, name, ascii_name, country_code, lat, lng) VALUES (2100000099, 'x', 'x', 'PH', 91, 0);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T4 cities accepted latitude 91'; END IF;
  RAISE NOTICE 'PASS 139 T4 CHECKs reject a bad meets, in person without a city, a half location and a bad city';

  -- ── T5 bands from her rounded position; the right communities only ───────
  PERFORM pg_temp.is139('T5 radius 1000',
    pg_temp.as139(a, near_q || '14.6, 121.0, 1000, NULL, NULL, false, 50)'),
    '139-bravo:under_25,139-charlie:under_50,139-delta:under_100,139-echo:farther,139-invited:under_25,139-near:under_10');
  PERFORM pg_temp.is139('T5 radius 100',
    pg_temp.as139(a, near_q || '14.6, 121.0, 100, NULL, NULL, false, 50)'),
    '139-bravo:under_25,139-charlie:under_50,139-delta:under_100,139-invited:under_25,139-near:under_10');
  PERFORM pg_temp.is139('T5 radius 25',
    pg_temp.as139(a, near_q || '14.6, 121.0, 25, NULL, NULL, false, 50)'),
    '139-bravo:under_25,139-invited:under_25,139-near:under_10');
  PERFORM pg_temp.is139('T5 radius 10',
    pg_temp.as139(a, near_q || '14.6, 121.0, 10, NULL, NULL, false, 50)'), '139-near:under_10');
  PERFORM pg_temp.is139('T5 nearest first',
    pg_temp.as139(a, 'SELECT slug FROM public.suggest_nearby_communities(14.6, 121.0, 1000, NULL, NULL, false, 50) LIMIT 1'), '139-near');
  PERFORM pg_temp.is139('T5 limit',
    pg_temp.as139(a, 'SELECT count(*)::text FROM public.suggest_nearby_communities(14.6, 121.0, 1000, NULL, NULL, false, 2)'), '2');
  -- Across the antimeridian and over the pole, the box still holds the circle.
  PERFORM pg_temp.is139('T5 antimeridian',
    pg_temp.as139(a, near_q || '0.0, 179.9, 25, NULL, NULL, false, 50)'), '139-wrap:under_25');
  PERFORM pg_temp.is139('T5 pole',
    pg_temp.as139(a, near_q || '89.9, 0.0, 25, NULL, NULL, false, 50)'), '139-pole:under_25');
  -- The result carries a band, never kilometres or a point.
  SELECT pg_get_function_result('public.suggest_nearby_communities(double precision, double precision, integer, text[], text[], boolean, integer)'::regprocedure) INTO v_def;
  IF v_def ~* '\m(lat|lng|km|distance_km|distance)\M' OR v_def !~* '\mdistance_band\M' THEN
    RAISE EXCEPTION 'T5 result shape leaks distance: %', v_def;
  END IF;
  RAISE NOTICE 'PASS 139 T5 bands are right; online-only, joined, banned, blocked, private and placeless are out';

  -- ── T6 filters ──────────────────────────────────────────────────────────
  PERFORM pg_temp.is139('T6 open only',
    pg_temp.as139(a, near_q || '14.6, 121.0, 25, NULL, NULL, true, 50)'), '139-bravo:under_25,139-near:under_10');
  PERFORM pg_temp.is139('T6 category',
    pg_temp.as139(a, near_q || '14.6, 121.0, 1000, ARRAY[''interest''], NULL, false, 50)'), '139-bravo:under_25,139-echo:farther');
  PERFORM pg_temp.is139('T6 meets both',
    pg_temp.as139(a, near_q || '14.6, 121.0, 1000, NULL, ARRAY[''both''], false, 50)'), '139-bravo:under_25,139-echo:farther');
  PERFORM pg_temp.is139('T6 meets in person',
    pg_temp.as139(a, near_q || '14.6, 121.0, 1000, NULL, ARRAY[''in_person''], false, 50)'),
    '139-charlie:under_50,139-delta:under_100,139-invited:under_25,139-near:under_10');
  PERFORM pg_temp.is139('T6 empty arrays mean all',
    pg_temp.as139(a, 'SELECT count(*)::text FROM public.suggest_nearby_communities(14.6, 121.0, 1000, ''{}'', ''{}'', false, 50)'), '6');
  RAISE NOTICE 'PASS 139 T6 category, meets and open-only filters';

  -- ── T7 refusals: her position must arrive rounded; filters must be real ──
  PERFORM pg_temp.is139('T7 unrounded lat',
    left(pg_temp.as139(a, near_q || '14.61, 121.0, 25, NULL, NULL, false, 20)'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T7 unrounded lng',
    left(pg_temp.as139(a, near_q || '14.6, 121.05, 25, NULL, NULL, false, 20)'), 9), 'ERR 22023');
  r := pg_temp.as139(a, near_q || '14.6123, 121.0456, 25, NULL, NULL, false, 20)');
  IF r NOT LIKE 'ERR 22023%' OR r LIKE '%14.6%' OR r LIKE '%121.0%' THEN
    RAISE EXCEPTION 'T7 refusal missing or echoes her coordinates: %', r;
  END IF;
  PERFORM pg_temp.is139('T7 null lat',
    left(pg_temp.as139(a, near_q || 'NULL, 121.0, 25, NULL, NULL, false, 20)'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T7 lat out of range',
    left(pg_temp.as139(a, near_q || '91.0, 121.0, 25, NULL, NULL, false, 20)'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T7 NaN',
    left(pg_temp.as139(a, near_q || '''NaN''::float8, 121.0, 25, NULL, NULL, false, 20)'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T7 radius 30',
    left(pg_temp.as139(a, near_q || '14.6, 121.0, 30, NULL, NULL, false, 20)'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T7 limit 51',
    left(pg_temp.as139(a, near_q || '14.6, 121.0, 25, NULL, NULL, false, 51)'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T7 limit 0',
    left(pg_temp.as139(a, near_q || '14.6, 121.0, 25, NULL, NULL, false, 0)'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T7 meets online',
    left(pg_temp.as139(a, near_q || '14.6, 121.0, 25, NULL, ARRAY[''online''], false, 20)'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T7 unknown category',
    left(pg_temp.as139(a, near_q || '14.6, 121.0, 25, ARRAY[''dating''], NULL, false, 20)'), 9), 'ERR 22023');
  -- The internal takes coordinates under the same rule, so it is no way around it.
  PERFORM pg_temp.is139('T7 internal unrounded',
    left(pg_temp.as139(a, 'SELECT count(*)::text FROM public._community_suggestions(14.61, 121.0, NULL, 25, NULL, NULL, false, 20)'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T7 internal both origins',
    left(pg_temp.as139(a, format('SELECT count(*)::text FROM public._community_suggestions(14.6, 121.0, %s, 25, NULL, NULL, false, 20)', c_a)), 9), 'ERR 22023');
  RAISE NOTICE 'PASS 139 T7 unrounded or impossible coordinates and unknown filters are refused, without an echo';

  -- ── T8 choose a city: distance from its centroid ───────────────────────
  PERFORM pg_temp.is139('T8 in Alpha, 25 km',
    pg_temp.as139(a, format('SELECT string_agg(slug || '':'' || distance_band, '','' ORDER BY slug) FROM public.suggest_communities_in_city(%s, 25, NULL, NULL, false, 50)', c_a)),
    '139-bravo:under_25,139-invited:under_25,139-near:under_10');
  PERFORM pg_temp.is139('T8 city name returned',
    pg_temp.as139(a, format('SELECT city_name FROM public.suggest_communities_in_city(%s, 10, NULL, NULL, false, 50)', c_a)), 'Nearbytest Alpha');
  PERFORM pg_temp.is139('T8 unknown city',
    left(pg_temp.as139(a, 'SELECT count(*)::text FROM public.suggest_communities_in_city(2100099999, 25, NULL, NULL, false, 50)'), 9), 'ERR P0002');
  PERFORM pg_temp.is139('T8 radius still checked',
    left(pg_temp.as139(a, format('SELECT count(*)::text FROM public.suggest_communities_in_city(%s, 7, NULL, NULL, false, 50)', c_a)), 9), 'ERR 22023');
  RAISE NOTICE 'PASS 139 T8 suggest_communities_in_city bands from the city centroid';

  -- ── T9 search_cities: prefix, accents, escaping, top 10 by population ────
  PERFORM pg_temp.is139('T9 prefix by population',
    pg_temp.as139(a, 'SELECT string_agg(name, ''|'') FROM public.search_cities(''nearbytest'')'),
    'Nearbytest Alpha|Nearbytest Bravo|Nearbytest Charlie|Nearbytest Delta|Nearbytest Echo|Nearbytest Foxtrot');
  PERFORM pg_temp.is139('T9 case and spaces',
    pg_temp.as139(a, 'SELECT string_agg(name, ''|'') FROM public.search_cities(''  NEARBYTEST a '')'), 'Nearbytest Alpha');
  PERFORM pg_temp.is139('T9 accent folded',
    pg_temp.as139(a, 'SELECT string_agg(name, ''|'') FROM public.search_cities(' || quote_literal(U&'Para\00F1') || ')'), U&'Para\00F1aquetest');
  PERFORM pg_temp.is139('T9 upper-case accent folded',
    pg_temp.as139(a, 'SELECT string_agg(name, ''|'') FROM public.search_cities(' || quote_literal(U&'PARA\00D1') || ')'), U&'Para\00F1aquetest');
  -- GeoNames spells Zürich's ASCII name "Zuerich": the folded native name finds it too.
  PERFORM pg_temp.is139('T9 native name folded',
    pg_temp.as139(a, 'SELECT string_agg(name, ''|'') FROM public.search_cities(''zurichtest'')'), U&'Z\00FCrichtest');
  PERFORM pg_temp.is139('T9 GeoNames ascii spelling',
    pg_temp.as139(a, 'SELECT string_agg(name, ''|'') FROM public.search_cities(''zuerich'')'), U&'Z\00FCrichtest');
  PERFORM pg_temp.is139('T9 typed with the accent',
    pg_temp.as139(a, 'SELECT string_agg(name, ''|'') FROM public.search_cities(' || quote_literal(U&'Z\00FCr') || ')'), U&'Z\00FCrichtest');
  PERFORM pg_temp.is139('T9 underscore is literal',
    pg_temp.as139(a, 'SELECT count(*)::text FROM public.search_cities(''nearbytes_'')'), '0');
  PERFORM pg_temp.is139('T9 percent is literal',
    pg_temp.as139(a, 'SELECT count(*)::text FROM public.search_cities(''nearby%'')'), '0');
  PERFORM pg_temp.is139('T9 ten at most, biggest first',
    pg_temp.as139(a, 'SELECT count(*)::text || '':'' || max(population)::text || '':'' || min(population)::text FROM public.search_cities(''zzlimittest'')'), '10:12:3');
  PERFORM pg_temp.is139('T9 one character',
    left(pg_temp.as139(a, 'SELECT count(*)::text FROM public.search_cities('' a '')'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T9 sixty-one characters',
    left(pg_temp.as139(a, 'SELECT count(*)::text FROM public.search_cities(repeat(''a'', 61))'), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T9 null',
    left(pg_temp.as139(a, 'SELECT count(*)::text FROM public.search_cities(NULL)'), 9), 'ERR 22023');
  RAISE NOTICE 'PASS 139 T9 search_cities';

  -- ── T10 her position is never stored: the reads write nothing ────────────
  w0 := pg_temp.writes139();
  INSERT INTO public.cities (id, name, ascii_name, country_code, lat, lng) VALUES (2100000098, 'Probe', 'Probe', 'PH', 0, 0);
  w1 := pg_temp.writes139();
  IF w1 <> w0 + 1 THEN RAISE EXCEPTION 'T10 the write probe does not see writes (% -> %)', w0, w1; END IF;
  PERFORM pg_temp.as139(a, near_q || '14.6, 121.0, 1000, NULL, NULL, false, 50)');
  PERFORM pg_temp.as139(a, format('SELECT count(*)::text FROM public.suggest_communities_in_city(%s, 100, NULL, NULL, false, 50)', c_a));
  PERFORM pg_temp.as139(a, 'SELECT count(*)::text FROM public.search_cities(''nearbytest'')');
  w2 := pg_temp.writes139();
  IF w2 <> w1 THEN RAISE EXCEPTION 'T10 a suggestion call wrote % rows', w2 - w1; END IF;
  FOREACH fn IN ARRAY ARRAY[
    'public.suggest_nearby_communities(double precision, double precision, integer, text[], text[], boolean, integer)'::regprocedure,
    'public.suggest_communities_in_city(integer, integer, text[], text[], boolean, integer)'::regprocedure,
    'public._community_suggestions(double precision, double precision, integer, integer, text[], text[], boolean, integer)'::regprocedure,
    'public.search_cities(text)'::regprocedure,
    'public.fold_city_name(text)'::regprocedure,
    'public.haversine_km(double precision, double precision, double precision, double precision)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(fn);
    IF v_def ~* '\m(insert|update|delete|merge|copy|truncate)\M' THEN
      RAISE EXCEPTION 'T10 % contains a write statement', fn;
    END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = fn) THEN RAISE EXCEPTION 'T10 % is SECURITY DEFINER', fn; END IF;
    IF (SELECT provolatile FROM pg_proc WHERE oid = fn) NOT IN ('s', 'i') THEN RAISE EXCEPTION 'T10 % is VOLATILE', fn; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = fn AND array_to_string(proconfig, ',') LIKE '%search_path=%') THEN
      RAISE EXCEPTION 'T10 % has no pinned search_path', fn;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS 139 T10 suggestion RPCs write nothing, are INVOKER and STABLE, search_path pinned';

  -- ── T11 set_community_location: the people who run it, or staff ─────────
  PERFORM pg_temp.is139('T11 stranger refused',
    left(pg_temp.as139(a, format('SELECT (public.set_community_location(%L, %s, %L)).meets', k_near, c_f, 'both')), 9), 'ERR 42501');
  SELECT city_id, meets INTO cid, mt FROM public.communities WHERE id = k_near;
  IF cid IS DISTINCT FROM c_a OR mt IS DISTINCT FROM 'in_person' THEN RAISE EXCEPTION 'T11 refused call moved the row'; END IF;
  PERFORM pg_temp.is139('T11 owner sets city',
    pg_temp.as139(d, format('SELECT (r).meets || '':'' || (r).city_id || '':'' || (r).lat || '':'' || (r).lng FROM (SELECT public.set_community_location(%L, %s, %L) AS r) x', k_noloc, c_c, 'both')),
    'both:' || c_c || ':14.95:121');
  PERFORM pg_temp.is139('T11 moderator sets city',
    pg_temp.as139(a, format('SELECT (public.set_community_location(%L, %s, %L)).city_id::text', k_modded, c_d, 'in_person')), c_d::text);
  PERFORM pg_temp.is139('T11 staff sets city',
    pg_temp.as139(s, format('SELECT (public.set_community_location(%L, %s, %L)).city_id::text', k_echo, c_b, 'both')), c_b::text);
  PERFORM pg_temp.is139('T11 online clears the point',
    pg_temp.as139(d, format('SELECT coalesce((r).lat::text, ''none'') || '':'' || (r).meets FROM (SELECT public.set_community_location(%L, NULL, %L) AS r) x', k_noloc, 'online')),
    'none:online');
  PERFORM pg_temp.is139('T11 in person needs a city',
    left(pg_temp.as139(d, format('SELECT (public.set_community_location(%L, NULL, %L)).meets', k_near, 'in_person')), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T11 bad meets',
    left(pg_temp.as139(d, format('SELECT (public.set_community_location(%L, %s, %L)).meets', k_near, c_a, 'weekly')), 9), 'ERR 22023');
  PERFORM pg_temp.is139('T11 unknown city',
    left(pg_temp.as139(d, format('SELECT (public.set_community_location(%L, 2100099999, %L)).meets', k_near, 'both')), 9), 'ERR 22023');
  -- A stranger cannot tell a missing community from one she may not touch.
  PERFORM pg_temp.is139('T11 unknown community, stranger',
    left(pg_temp.as139(d, format('SELECT (public.set_community_location(%L, %s, %L)).meets', gen_random_uuid(), c_a, 'both')), 9), 'ERR 42501');
  PERFORM pg_temp.is139('T11 private community, stranger',
    left(pg_temp.as139(a, format('SELECT (public.set_community_location(%L, %s, %L)).meets', k_priv, c_a, 'both')), 9), 'ERR 42501');
  PERFORM pg_temp.is139('T11 unknown community, staff',
    left(pg_temp.as139(s, format('SELECT (public.set_community_location(%L, %s, %L)).meets', gen_random_uuid(), c_a, 'both')), 9), 'ERR P0002');
  UPDATE public.profiles SET vetting_status = 'pending' WHERE id = d;
  PERFORM pg_temp.is139('T11 unapproved owner refused',
    left(pg_temp.as139(d, format('SELECT (public.set_community_location(%L, %s, %L)).meets', k_near, c_b, 'both')), 9), 'ERR 42501');
  UPDATE public.profiles SET vetting_status = 'approved' WHERE id = d;
  PERFORM pg_temp.is139('T11 anon refused',
    left(pg_temp.as139(NULL, format('SELECT (public.set_community_location(%L, %s, %L)).meets', k_near, c_b, 'both')), 9), 'ERR 42501');
  RAISE NOTICE 'PASS 139 T11 set_community_location: owner, moderator, staff yes; anyone else no';

  -- ── T12 the city moves or goes: its communities follow ──────────────────
  UPDATE public.cities SET lat = 14.66 WHERE id = c_a;
  SELECT lat INTO la FROM public.communities WHERE id = k_near;
  IF la IS DISTINCT FROM 14.66 THEN RAISE EXCEPTION 'T12 community kept the old centroid: %', la; END IF;
  DELETE FROM public.cities WHERE id = c_f;
  SELECT city_id, lat, lng, meets INTO cid, la, ln, mt FROM public.communities WHERE id = k_fox;
  IF cid IS NOT NULL OR la IS NOT NULL OR ln IS NOT NULL OR mt IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'T12 deleted city left % % % %', cid, la, ln, mt;
  END IF;
  RAISE NOTICE 'PASS 139 T12 a moved city re-points its communities; a deleted one clears them to online';

  -- ── T14 POST only: a GET or HEAD would carry her position in a logged URL ─
  PERFORM set_config('request.method', 'GET', true);
  PERFORM pg_temp.is139('T14 GET nearby',
    left(pg_temp.as139(a, near_q || '14.6, 121.0, 10, NULL, NULL, false, 20)'), 9), 'ERR 0A000');
  PERFORM pg_temp.is139('T14 GET in city',
    left(pg_temp.as139(a, format('SELECT count(*)::text FROM public.suggest_communities_in_city(%s, 10, NULL, NULL, false, 20)', c_a)), 9), 'ERR 0A000');
  PERFORM pg_temp.is139('T14 GET search',
    left(pg_temp.as139(a, 'SELECT count(*)::text FROM public.search_cities(''nearbytest'')'), 9), 'ERR 0A000');
  -- HEAD is GET without the body: PostgREST runs it the same way, with the
  -- arguments in the same logged query string.
  -- src: https://docs.postgrest.org/en/v14/references/transactions.html · PostgREST v14.4 · 2026-10-28
  PERFORM set_config('request.method', 'HEAD', true);
  PERFORM pg_temp.is139('T14 HEAD nearby',
    left(pg_temp.as139(a, near_q || '14.6, 121.0, 10, NULL, NULL, false, 20)'), 9), 'ERR 0A000');
  PERFORM pg_temp.is139('T14 HEAD in city',
    left(pg_temp.as139(a, format('SELECT count(*)::text FROM public.suggest_communities_in_city(%s, 10, NULL, NULL, false, 20)', c_a)), 9), 'ERR 0A000');
  PERFORM pg_temp.is139('T14 HEAD search',
    left(pg_temp.as139(a, 'SELECT count(*)::text FROM public.search_cities(''nearbytest'')'), 9), 'ERR 0A000');
  PERFORM set_config('request.method', 'POST', true);
  PERFORM pg_temp.is139('T14 POST nearby',
    pg_temp.as139(a, near_q || '14.6, 121.0, 10, NULL, NULL, false, 20)'), '139-near:under_10');
  PERFORM set_config('request.method', '', true);
  RAISE NOTICE 'PASS 139 T14 GET and HEAD are refused for every location read; POST works';

  -- ── T13 anon: no way in ──────────────────────────────────────────────────
  PERFORM pg_temp.is139('T13 anon nearby',
    left(pg_temp.as139(NULL, near_q || '14.6, 121.0, 25, NULL, NULL, false, 20)'), 9), 'ERR 42501');
  PERFORM pg_temp.is139('T13 anon in city',
    left(pg_temp.as139(NULL, format('SELECT count(*)::text FROM public.suggest_communities_in_city(%s, 25, NULL, NULL, false, 20)', c_b)), 9), 'ERR 42501');
  PERFORM pg_temp.is139('T13 anon internal',
    left(pg_temp.as139(NULL, 'SELECT count(*)::text FROM public._community_suggestions(14.6, 121.0, NULL, 25, NULL, NULL, false, 20)'), 9), 'ERR 42501');
  PERFORM pg_temp.is139('T13 anon search',
    left(pg_temp.as139(NULL, 'SELECT count(*)::text FROM public.search_cities(''nearbytest'')'), 9), 'ERR 42501');
  PERFORM pg_temp.is139('T13 anon reads cities',
    left(pg_temp.as139(NULL, 'SELECT count(*)::text FROM public.cities'), 9), 'ERR 42501');
  -- The authenticated role with no member behind it (no sub) is refused too.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM 1 FROM public.suggest_nearby_communities(14.6, 121.0, 25, NULL, NULL, false, 20);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'T13 a token without a member got suggestions'; END IF;
  RAISE NOTICE 'PASS 139 T13 anon can neither suggest, search nor read cities; no sub, no suggestions';
END $$;

-- Leave no identity behind for a stacked check: auth.uid() reads claim.sub
-- first, then claims.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.method', '', true);
