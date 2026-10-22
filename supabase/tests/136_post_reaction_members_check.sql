-- Behaviour proof for 136_post_reaction_members.sql on a LOCAL database.
-- Runs inside one transaction that the runner ROLLS BACK (migration-proof.cjs);
-- it leaves nothing behind. Every block RAISEs on a failed expectation.
\set ON_ERROR_STOP on

DO $$
DECLARE
  a uuid; b uuid; d uuid;
  p uuid; p_gone uuid;
  heart text := U&'\2764\FE0F';
  laugh text := U&'\+01F602';
  wow   text := U&'\+01F62E';
  res jsonb;
  n int; likes0 int; likes1 int;
  ok boolean; msg text; st text;
  t text;
BEGIN
  SELECT id INTO a FROM public.profiles ORDER BY created_at, id LIMIT 1;
  SELECT id INTO b FROM public.profiles WHERE id <> a ORDER BY created_at, id LIMIT 1;
  SELECT id INTO d FROM public.profiles WHERE id NOT IN (a, b) ORDER BY created_at, id LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'need 3 profiles in the local db'; END IF;
  -- Reset whatever earlier checks in a stacked proof left on these rows.
  UPDATE public.profiles SET vetting_status = 'approved', is_staff = false WHERE id IN (a, b, d);
  DELETE FROM public.friendships WHERE requester_id IN (a, b, d) AND addressee_id IN (a, b, d);
  DELETE FROM public.mutes WHERE user_id IN (a, b, d);
  DELETE FROM public.notifications WHERE user_id = d AND type = 'post_reaction';

  -- Fixture: a post by d that a can read, and one that is gone. Cleared first
  -- so the check can run twice in one transaction (--cycle).
  DELETE FROM public.posts WHERE author_id = d AND content IN ('136 react to me', '136 gone');
  INSERT INTO public.posts (author_id, content, post_type)
  VALUES (d, '136 react to me', 'standard') RETURNING id INTO p;
  INSERT INTO public.posts (author_id, content, post_type, deleted_at)
  VALUES (d, '136 gone', 'standard', now()) RETURNING id INTO p_gone;

  -- ── T1 shape: RLS on, one row per (post, member), only the six ─────────
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.post_reaction_members'::regclass) THEN
    RAISE EXCEPTION 'T1 RLS is off on post_reaction_members';
  END IF;
  ok := false;
  BEGIN
    INSERT INTO public.post_reaction_members (post_id, user_id, emoji) VALUES (p, a, 'poll:1');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T1 a non-reaction key was stored as a reaction'; END IF;
  RAISE NOTICE 'PASS 136 T1 shape: RLS on, CHECK keeps only POST_REACTIONS';

  -- ── T2 grants: members read, nobody writes directly, anon gets nothing ──
  IF has_table_privilege('anon', 'public.post_reaction_members', 'SELECT') THEN
    RAISE EXCEPTION 'T2 anon can read post_reaction_members';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.post_reaction_members', 'SELECT') THEN
    RAISE EXCEPTION 'T2 authenticated cannot read post_reaction_members';
  END IF;
  IF has_table_privilege('authenticated', 'public.post_reaction_members', 'INSERT')
     OR has_table_privilege('authenticated', 'public.post_reaction_members', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.post_reaction_members', 'DELETE') THEN
    RAISE EXCEPTION 'T2 authenticated can write post_reaction_members directly';
  END IF;
  IF has_function_privilege('anon', 'public.set_post_reaction(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T2 anon can execute set_post_reaction';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.set_post_reaction(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T2 authenticated cannot execute set_post_reaction';
  END IF;
  RAISE NOTICE 'PASS 136 T2 grants: SELECT for members, writes only through the RPC';

  -- ── T3 set, repeat, switch, clear — the tally follows her ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  res := public.set_post_reaction(p, heart);
  IF res->>'mine' IS DISTINCT FROM heart THEN RAISE EXCEPTION 'T3 set: mine is %', res->>'mine'; END IF;
  IF (res->'counts'->>heart)::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T3 set: heart tally %', res->'counts'->>heart;
  END IF;
  SELECT count(*) INTO n FROM public.post_reaction_members WHERE post_id = p;
  IF n <> 1 THEN RAISE EXCEPTION 'T3 set: % rows visible to her', n; END IF;

  -- The double tap again: adds nothing.
  res := public.set_post_reaction(p, heart);
  IF (res->'counts'->>heart)::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T3 repeat counted twice: heart tally %', res->'counts'->>heart;
  END IF;

  res := public.set_post_reaction(p, laugh);
  IF (res->'counts'->>heart)::int IS DISTINCT FROM 0 OR (res->'counts'->>laugh)::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T3 switch: tally %', res->'counts';
  END IF;
  SELECT emoji INTO t FROM public.post_reaction_members WHERE post_id = p AND user_id = a;
  IF t IS DISTINCT FROM laugh THEN RAISE EXCEPTION 'T3 switch: her row says %', t; END IF;

  res := public.set_post_reaction(p, NULL);
  IF (res->'counts'->>laugh)::int IS DISTINCT FROM 0 OR res->>'mine' IS NOT NULL THEN
    RAISE EXCEPTION 'T3 clear: %', res;
  END IF;
  SELECT count(*) INTO n FROM public.post_reaction_members WHERE post_id = p;
  IF n <> 0 THEN RAISE EXCEPTION 'T3 clear left % rows', n; END IF;
  RAISE NOTICE 'PASS 136 T3 set / repeat / switch / clear keep the tally exact';

  -- ── T4 her legacy like is her heart, counted once ───────────────────────
  INSERT INTO public.post_likes (post_id, user_id) VALUES (p, a);
  SELECT like_count INTO likes0 FROM public.posts WHERE id = p;
  res := public.set_post_reaction(p, heart);
  SELECT like_count INTO likes1 FROM public.posts WHERE id = p;
  IF likes1 <> likes0 - 1 THEN RAISE EXCEPTION 'T4 like not folded in: like_count % -> %', likes0, likes1; END IF;
  IF (res->>'like_count')::int IS DISTINCT FROM likes1 THEN
    RAISE EXCEPTION 'T4 RPC reported like_count % but the post has %', res->>'like_count', likes1;
  END IF;
  SELECT count(*) INTO n FROM public.post_likes WHERE post_id = p AND user_id = a;
  IF n <> 0 THEN RAISE EXCEPTION 'T4 her legacy like survived'; END IF;
  IF (res->'counts'->>heart)::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T4 heart tally %', res->'counts'->>heart;
  END IF;
  RAISE NOTICE 'PASS 136 T4 a legacy like becomes her heart, counted once';

  -- ── T5 refusals: not a reaction, a poll key, a post that is gone ────────
  ok := false;
  BEGIN PERFORM public.set_post_reaction(p, 'hacked');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE; ok := st = '22023';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T5 a non-reaction was accepted (sqlstate %)', st; END IF;
  ok := false;
  BEGIN PERFORM public.set_post_reaction(p, 'poll:1');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE; ok := st = '22023';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T5 a poll key was accepted as a reaction (sqlstate %)', st; END IF;
  ok := false;
  BEGIN PERFORM public.set_post_reaction(p_gone, heart);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; ok := msg = 'Post not found';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T5 reacted to a deleted post (got %)', msg; END IF;
  RAISE NOTICE 'PASS 136 T5 refuses non-reactions, poll keys and deleted posts';

  -- ── T6 RLS: no direct writes, and she never sees anyone else's row ──────
  ok := false;
  BEGIN INSERT INTO public.post_reaction_members (post_id, user_id, emoji) VALUES (p, a, wow);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T6 direct INSERT was allowed'; END IF;
  ok := false;
  BEGIN UPDATE public.post_reaction_members SET emoji = wow WHERE post_id = p;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T6 direct UPDATE was allowed'; END IF;
  ok := false;
  BEGIN DELETE FROM public.post_reaction_members WHERE post_id = p;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T6 direct DELETE was allowed'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.post_reaction_members WHERE post_id = p;
  IF n <> 0 THEN RAISE EXCEPTION 'T6 b can see % of a''s reaction rows', n; END IF;
  res := public.set_post_reaction(p, wow);
  IF (res->'counts'->>heart)::int IS DISTINCT FROM 1 OR (res->'counts'->>wow)::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'T6 two members: tally %', res->'counts';
  END IF;
  SELECT count(*) INTO n FROM public.post_reaction_members WHERE post_id = p;
  IF n <> 1 THEN RAISE EXCEPTION 'T6 b sees % rows, expected only her own', n; END IF;
  RAISE NOTICE 'PASS 136 T6 RLS: own rows only, no direct writes';

  -- ── T7 installed builds: the old tally RPC still works, writes no ballot ─
  PERFORM public.increment_reaction(p, wow);
  SELECT (reaction_counts->>wow)::int INTO n FROM public.posts WHERE id = p;
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'T7 increment_reaction tally % (expected 2)', n; END IF;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.post_reaction_members WHERE post_id = p;
  IF n <> 2 THEN RAISE EXCEPTION 'T7 increment_reaction wrote a member row (% rows)', n; END IF;
  RAISE NOTICE 'PASS 136 T7 increment_reaction still counts for installed builds';

  -- ── T8 the author is told, without a flower; a clear takes it back ──────
  SELECT title INTO t FROM public.notifications
   WHERE user_id = d AND actor_id = a AND type = 'post_reaction'
   ORDER BY created_at DESC LIMIT 1;
  IF t IS NULL THEN RAISE EXCEPTION 'T8 no notification for a''s reaction'; END IF;
  IF position(U&'\273F' IN t) > 0 OR t NOT LIKE '% reacted to your post' THEN
    RAISE EXCEPTION 'T8 notification title is %', t;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.set_post_reaction(p, NULL);
  RESET ROLE;
  SELECT count(*) INTO n FROM public.notifications
   WHERE user_id = d AND actor_id = b AND type = 'post_reaction' AND read_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'T8 cleared reaction left % unread notifications', n; END IF;
  RAISE NOTICE 'PASS 136 T8 the author hears "reacted to your post"; a clear takes it back';

  -- ── T9 anon: no way in ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN PERFORM public.set_post_reaction(p, heart);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T9 anon could call set_post_reaction'; END IF;
  ok := false;
  BEGIN PERFORM 1 FROM public.post_reaction_members LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T9 anon could read post_reaction_members'; END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 136 T9 anon can neither react nor read';
END $$;

-- Leave no identity behind for a stacked check: auth.uid() reads claim.sub
-- first, then claims.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
