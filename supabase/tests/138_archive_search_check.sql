-- Behaviour proof for 138_archive_search.sql on a LOCAL database.
-- Runs inside one transaction that the runner ROLLS BACK (migration-proof.cjs);
-- it leaves nothing behind. Every block RAISEs on a failed expectation.
-- Expectations are computed from the database (the seeded 098 catalogue plus
-- the fixtures below), never hard-coded counts, so the check survives a
-- catalogue that grows.
\set ON_ERROR_STOP on

DO $$
DECLARE
  a uuid; s uuid;
  e_pending uuid; e_hidden uuid; e_rejected uuid; e_new uuid;
  srt text;
  n int; m int; k int;
  ok boolean; st text; stmt text;
  got text[]; want text[];
  ids uuid[]; ids2 uuid[];
  t public.archive_media_type;
  r record;
  old_at timestamptz;
BEGIN
  SELECT id INTO a FROM public.profiles ORDER BY created_at, id LIMIT 1;
  SELECT id INTO s FROM public.profiles WHERE id <> a ORDER BY created_at, id LIMIT 1;
  IF s IS NULL THEN RAISE EXCEPTION 'need 2 profiles in the local db'; END IF;
  -- A PENDING member: the Archive is the one surface she can use (096), and
  -- search is part of it. s is staff for the browse-stays-published test.
  UPDATE public.profiles SET vetting_status = 'pending', is_staff = false WHERE id = a;
  UPDATE public.profiles SET vetting_status = 'approved', is_staff = true WHERE id = s;

  -- Fixtures. Cleared first so the check can run twice in one transaction (the down cycle).
  DELETE FROM public.archive_entries WHERE slug LIKE 'zz138-%';
  INSERT INTO public.archive_entries (slug, title, media_type, release_year, creator, summary, status)
  VALUES ('zz138-pending', 'Portrait 138 Pending Fixture', 'film', 2019, 'Fixture Maker', 'Waiting for the mods.', 'pending')
  RETURNING id INTO e_pending;
  INSERT INTO public.archive_entries (slug, title, media_type, release_year, creator, summary, status, published_at)
  VALUES ('zz138-hidden', 'Portrait 138 Hidden Fixture', 'film', 2019, 'Fixture Maker', 'Taken down.', 'hidden', now())
  RETURNING id INTO e_hidden;
  INSERT INTO public.archive_entries (slug, title, media_type, release_year, creator, summary, status)
  VALUES ('zz138-rejected', 'Portrait 138 Rejected Fixture', 'film', 2019, 'Fixture Maker', 'Not for the Archive.', 'rejected')
  RETURNING id INTO e_rejected;
  -- A title that says "bound" four times, starts with it, and is the newest
  -- entry: every signal but an exact title match points at it, so only the
  -- exact-title boost can keep Bound first (T17).
  INSERT INTO public.archive_entries (slug, title, media_type, release_year, creator, summary, status, published_at)
  VALUES ('zz138-bound-echo', 'Bound Bound 138 Echo', 'film', 2020, 'Bound Maker', 'Bound, bound and bound again.', 'published', now());
  INSERT INTO public.archive_entries (slug, title, media_type, release_year, creator, summary, status, published_at)
  VALUES ('zz138-amelie', 'Amélie 138 Fixture', 'film', 2001, 'Zoë 138 Maker', 'A café in Montmartre.', 'published', now())
  RETURNING id INTO e_new;
  -- 20 votes at 4.5 stars: past the ranking gate, and an exact min-stars edge.
  UPDATE public.archive_entries SET vote_count = 20, up_count = 18, star_sum = 90 WHERE id = e_new;

  SELECT count(*) INTO n FROM public.archive_entries WHERE status = 'published';
  IF n >= 50 THEN RAISE EXCEPTION 'this check reads whole result sets at limit 50; % published entries', n; END IF;

  -- ── T1 catalogue: extensions, definer RPCs, pinned search_path, indexes, grants ──
  IF (SELECT count(*) FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')) <> 2 THEN
    RAISE EXCEPTION 'T1 pg_trgm / unaccent are not installed';
  END IF;
  FOR r IN
    SELECT p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('archive_search', 'archive_search_facets', 'archive_search_input')
  LOOP
    -- The two RPCs are DEFINER: under a member's RLS the planner may not use
    -- the trigram / tsv indexes for non-leakproof operators (LIKE, @@, <%), so
    -- every search was a full scan. They enforce visibility themselves (T10,
    -- T16). The input helper reads no table and stays INVOKER.
    IF r.proname IN ('archive_search', 'archive_search_facets') AND NOT r.prosecdef THEN
      RAISE EXCEPTION 'T1 % is SECURITY INVOKER; it must be DEFINER so the indexes serve members', r.proname;
    END IF;
    IF r.proname = 'archive_search_input' AND r.prosecdef THEN
      RAISE EXCEPTION 'T1 archive_search_input reads no table and must not be SECURITY DEFINER';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
      RAISE EXCEPTION 'T1 % has no pinned search_path', r.proname;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN RAISE EXCEPTION 'T1 anon can execute %', r.proname; END IF;
    IF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'T1 authenticated cannot execute %', r.proname;
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(r.proacl) x WHERE x.grantee = 0) THEN
      RAISE EXCEPTION 'T1 % is executable by PUBLIC', r.proname;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname IN ('archive_search', 'archive_search_facets', 'archive_search_input');
  IF n <> 3 THEN RAISE EXCEPTION 'T1 expected 3 search functions, found %', n; END IF;
  -- The row set holds the visibility rule and runs with the RPCs' rights, so a
  -- member must not be able to call it on its own.
  SELECT p.oid, p.prosecdef, p.proconfig, p.proacl INTO r FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.archive_search_rows(text, public.archive_media_type[], integer, integer, numeric, boolean, boolean)');
  IF r.oid IS NULL THEN RAISE EXCEPTION 'T1 archive_search_rows is missing'; END IF;
  IF r.prosecdef THEN RAISE EXCEPTION 'T1 archive_search_rows must be INVOKER; the RPCs carry the rights'; END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'T1 archive_search_rows has no pinned search_path';
  END IF;
  IF has_function_privilege('authenticated', r.oid, 'EXECUTE') OR has_function_privilege('anon', r.oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM aclexplode(r.proacl) x WHERE x.grantee = 0) THEN
    RAISE EXCEPTION 'T1 archive_search_rows is executable by a member, anon or PUBLIC';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.archive_unaccent(text)'::regprocedure) <> 'i' THEN
    RAISE EXCEPTION 'T1 archive_unaccent must be IMMUTABLE to sit in an index';
  END IF;
  SELECT count(*) INTO n FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'archive_entries'
    AND indexname IN ('idx_archive_entries_title_trgm', 'idx_archive_entries_creator_trgm')
    AND indexdef LIKE '%USING gin%' AND indexdef LIKE '%gin_trgm_ops%' AND indexdef LIKE '%archive_unaccent(lower(%';
  IF n <> 2 THEN RAISE EXCEPTION 'T1 expected 2 trigram GIN indexes on unaccented lower(title/creator), found %', n; END IF;
  IF to_regclass('public.idx_archive_entries_search') IS NULL THEN RAISE EXCEPTION 'T1 the tsv GIN index is gone'; END IF;
  RAISE NOTICE 'PASS 138 T1 catalogue: extensions, DEFINER RPCs + INVOKER helper, search_path, trigram indexes, authenticated-only';

  -- ── T2 the vector: weighted, unaccented, with the taxonomy weight free ──
  SELECT search_tsv INTO STRICT r FROM public.archive_entries WHERE slug = 'portrait-of-a-lady-on-fire';
  IF NOT ts_filter(r.search_tsv, '{a}') @@ 'portrait & lady & fire'::tsquery THEN RAISE EXCEPTION 'T2 title is not weight A'; END IF;
  IF NOT ts_filter(r.search_tsv, '{b}') @@ 'celine & sciamma'::tsquery THEN RAISE EXCEPTION 'T2 creator is not weight B, unaccented'; END IF;
  IF ts_filter(r.search_tsv, '{d}') = ''::tsvector THEN RAISE EXCEPTION 'T2 summary is not weight D'; END IF;
  IF ts_filter(r.search_tsv, '{c}') <> ''::tsvector THEN RAISE EXCEPTION 'T2 weight C is taxonomy only; found %', ts_filter(r.search_tsv, '{c}'); END IF;
  IF r.search_tsv @@ to_tsquery('simple', 'céline') THEN RAISE EXCEPTION 'T2 the vector kept an accent'; END IF;
  IF NOT ts_filter(public.archive_search_document('T', 'C', 'S', 'Romance Drama'), '{c}') @@ 'romance & drama'::tsquery THEN
    RAISE EXCEPTION 'T2 the taxonomy hook does not land at weight C';
  END IF;
  SELECT count(*) INTO n FROM public.archive_entries
  WHERE search_tsv IS DISTINCT FROM public.archive_search_document(title, creator, summary);
  IF n <> 0 THEN RAISE EXCEPTION 'T2 % entries carry a vector the document builder would not produce (backfill)', n; END IF;
  RAISE NOTICE 'PASS 138 T2 search_tsv: title A, creator B, taxonomy C (hook), summary D, unaccented, backfilled';

  -- From here on she is a pending member.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ── T3 typos and partial words ───────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM public.archive_ranked_view WHERE title ILIKE '%portrat%' OR creator ILIKE '%portrat%') THEN
    RAISE EXCEPTION 'T3 precondition: the old ILIKE already finds "portrat"';
  END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'portrat');
  IF NOT 'portrait-of-a-lady-on-fire' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T3 "portrat" found %', got; END IF;
  IF cardinality(got) > 5 THEN RAISE EXCEPTION 'T3 "portrat" matched % entries; fuzzy is too loose', cardinality(got); END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'portrat of a lady');
  IF NOT 'portrait-of-a-lady-on-fire' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T3 "portrat of a lady" found %', got; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'handmai');
  IF NOT 'the-handmaiden' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T3 the partial word "handmai" found %', got; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'sciama');
  IF NOT got @> ARRAY['portrait-of-a-lady-on-fire', 'water-lilies'] THEN RAISE EXCEPTION 'T3 the creator typo "sciama" found %', got; END IF;
  RAISE NOTICE 'PASS 138 T3 typos and partial words: portrat, portrat of a lady, handmai, sciama';

  -- ── T4 accents fold both ways ─────────────────────────────────────────────
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'celine sciamma');
  IF NOT got @> ARRAY['portrait-of-a-lady-on-fire', 'water-lilies'] THEN RAISE EXCEPTION 'T4 "celine sciamma" found %', got; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'Céline');
  IF NOT got @> ARRAY['portrait-of-a-lady-on-fire', 'water-lilies'] THEN RAISE EXCEPTION 'T4 "Céline" found %', got; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'monae');
  IF NOT 'dirty-computer' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T4 "monae" found %', got; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'MONÁE');
  IF NOT 'dirty-computer' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T4 "MONÁE" found %', got; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'sebastian lelio');
  IF NOT 'disobedience' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T4 "sebastian lelio" found %', got; END IF;
  RAISE NOTICE 'PASS 138 T4 accent-insensitive: celine/Céline, monae/MONÁE, sebastian';

  -- ── T5 websearch operators: -word, -"phrase", quotes, or ─────────────────
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'sciamma -portrait');
  IF NOT 'water-lilies' = ANY (coalesce(got, '{}')) OR 'portrait-of-a-lady-on-fire' = ANY (got) THEN
    RAISE EXCEPTION 'T5 "sciamma -portrait" found %', got;
  END IF;
  -- The fuzzy path must honour the exclusion too: "sciama" is a typo, so only
  -- trigram finds these, and "-water" must still take Water Lilies out.
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'sciama -water');
  IF NOT 'portrait-of-a-lady-on-fire' = ANY (coalesce(got, '{}')) OR 'water-lilies' = ANY (got) THEN
    RAISE EXCEPTION 'T5 fuzzy path ignored the exclusion: "sciama -water" found %', got;
  END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'sciamma -"lady on fire"');
  IF NOT 'water-lilies' = ANY (coalesce(got, '{}')) OR 'portrait-of-a-lady-on-fire' = ANY (got) THEN
    RAISE EXCEPTION 'T5 phrase exclusion: found %', got;
  END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => '"lady on fire"');
  IF NOT 'portrait-of-a-lady-on-fire' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T5 a quoted phrase found %', got; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'carol or bound');
  IF NOT got @> ARRAY['carol', 'bound'] THEN RAISE EXCEPTION 'T5 "carol or bound" found %', got; END IF;
  RAISE NOTICE 'PASS 138 T5 -word and -"phrase" exclude on both paths; quotes and or work';

  -- ── T6 type filter ─────────────────────────────────────────────────────────
  SELECT array_agg(slug), count(*) FILTER (WHERE media_type <> 'book') INTO got, n
  FROM public.archive_search(p_q => 'sarah waters', p_types => ARRAY['book']::public.archive_media_type[]);
  IF n <> 0 OR NOT got @> ARRAY['fingersmith', 'tipping-the-velvet'] THEN RAISE EXCEPTION 'T6 books by Sarah Waters: % (non-books %)', got, n; END IF;
  SELECT count(*), count(*) FILTER (WHERE media_type NOT IN ('film', 'tv')) INTO n, k
  FROM public.archive_search(p_types => ARRAY['film', 'tv']::public.archive_media_type[]);
  SELECT count(*) INTO m FROM public.archive_ranked_view WHERE media_type IN ('film', 'tv');
  IF n <> m OR k <> 0 THEN RAISE EXCEPTION 'T6 film+tv browse: % rows (% outside), view has %', n, k, m; END IF;
  RAISE NOTICE 'PASS 138 T6 the type filter keeps exactly the chosen types';

  -- ── T7 year range ──────────────────────────────────────────────────────────
  SELECT count(*), count(*) FILTER (WHERE release_year IS DISTINCT FROM 2019) INTO n, k
  FROM public.archive_search(p_year_from => 2019, p_year_to => 2019);
  SELECT count(*) INTO m FROM public.archive_ranked_view WHERE release_year = 2019;
  IF n <> m OR k <> 0 OR n = 0 THEN RAISE EXCEPTION 'T7 2019 only: % rows (% outside), view has %', n, k, m; END IF;
  SELECT count(*), count(*) FILTER (WHERE release_year < 2020) INTO n, k FROM public.archive_search(p_year_from => 2020);
  SELECT count(*) INTO m FROM public.archive_ranked_view WHERE release_year >= 2020;
  IF n <> m OR k <> 0 THEN RAISE EXCEPTION 'T7 from 2020: % rows (% before), view has %', n, k, m; END IF;
  RAISE NOTICE 'PASS 138 T7 year range is inclusive and exact';

  -- ── T8 browse sorts are the client's view order; paging slices it ────────
  SELECT array_agg(id ORDER BY ordinality) INTO ids FROM public.archive_search(p_sort => 'top') WITH ORDINALITY;
  SELECT array_agg(id ORDER BY rank_priority, calculated_percent DESC, vote_count DESC, id) INTO ids2 FROM public.archive_ranked_view;
  IF ids IS DISTINCT FROM ids2 THEN RAISE EXCEPTION 'T8 top order differs from the view order'; END IF;
  SELECT array_agg(id ORDER BY ordinality) INTO ids FROM public.archive_search(p_sort => 'voted') WITH ORDINALITY;
  SELECT array_agg(id ORDER BY vote_count DESC, id) INTO ids2 FROM public.archive_ranked_view;
  IF ids IS DISTINCT FROM ids2 THEN RAISE EXCEPTION 'T8 voted order differs'; END IF;
  SELECT array_agg(id ORDER BY ordinality) INTO ids FROM public.archive_search(p_sort => 'needs') WITH ORDINALITY;
  SELECT array_agg(id ORDER BY rank_priority DESC, vote_count, id) INTO ids2 FROM public.archive_ranked_view;
  IF ids IS DISTINCT FROM ids2 THEN RAISE EXCEPTION 'T8 needs order differs'; END IF;
  SELECT array_agg(id ORDER BY ordinality) INTO ids FROM public.archive_search(p_sort => 'newest') WITH ORDINALITY;
  SELECT array_agg(id ORDER BY published_at DESC, id) INTO ids2 FROM public.archive_ranked_view;
  IF ids IS DISTINCT FROM ids2 THEN RAISE EXCEPTION 'T8 newest order differs'; END IF;
  SELECT array_agg(id ORDER BY ordinality) INTO ids FROM public.archive_search(p_sort => 'top', p_limit => 10, p_offset => 10) WITH ORDINALITY;
  SELECT array_agg(x ORDER BY o) INTO ids2 FROM (
    SELECT id AS x, row_number() OVER (ORDER BY rank_priority, calculated_percent DESC, vote_count DESC, id) AS o
    FROM public.archive_ranked_view
  ) z WHERE o BETWEEN 11 AND 20;
  IF ids IS DISTINCT FROM ids2 THEN RAISE EXCEPTION 'T8 page 2 (offset 10, limit 10) is not rows 11-20 of the order'; END IF;
  RAISE NOTICE 'PASS 138 T8 top / voted / needs / newest match the client order; paging is a slice';

  -- ── T9 facets: one row per type, they add up, a type's own filter ignored ─
  SELECT count(*), count(DISTINCT media_type) INTO n, k FROM public.archive_search_facets();
  SELECT cardinality(enum_range(NULL::public.archive_media_type)) INTO m;
  IF n <> m OR k <> m THEN RAISE EXCEPTION 'T9 facets returned % rows (% types), the enum has %', n, k, m; END IF;
  FOREACH stmt IN ARRAY ARRAY['', 'sciamma', 'portrat', 'sciamma -portrait', 'the', 'carol or bound', 'monae', 'carol', 'bound', 'or', '"', '-'] LOOP
    SELECT coalesce(sum(entry_count), 0) INTO n FROM public.archive_search_facets(p_q => stmt);
    SELECT count(*) INTO m FROM public.archive_search(p_q => stmt);
    IF n <> m THEN RAISE EXCEPTION 'T9 "%": facets add to %, search returned %', stmt, n, m; END IF;
  END LOOP;
  SELECT coalesce(sum(entry_count), 0) INTO n FROM public.archive_search_facets(p_year_from => 2019, p_year_to => 2019, p_scored_only => true);
  SELECT count(*) INTO m FROM public.archive_search(p_year_from => 2019, p_year_to => 2019, p_scored_only => true);
  IF n <> m THEN RAISE EXCEPTION 'T9 with filters: facets add to %, search returned %', n, m; END IF;
  FOREACH t IN ARRAY enum_range(NULL::public.archive_media_type) LOOP
    SELECT entry_count INTO n FROM public.archive_search_facets() f WHERE f.media_type = t;
    SELECT count(*) INTO m FROM public.archive_search(p_types => ARRAY[t]);
    IF n <> m THEN RAISE EXCEPTION 'T9 % facet says %, a % search returns %', t, n, t, m; END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.archive_search_facets() f
    FULL JOIN public.archive_search_facets(p_types => ARRAY['film']::public.archive_media_type[]) g USING (media_type)
    WHERE f.entry_count IS DISTINCT FROM g.entry_count
  ) THEN
    RAISE EXCEPTION 'T9 picking Film narrowed the type counts; TV would read 0';
  END IF;
  RAISE NOTICE 'PASS 138 T9 facets: one row per type, sum = search total, per-type = typed search, own filter ignored';

  -- ── T10 pending, hidden and rejected entries never surface ────────────────
  -- The RPCs are SECURITY DEFINER, so RLS no longer stands behind them: this
  -- is the proof that their own `status = 'published'` is the whole rule.
  SELECT count(*) INTO n FROM public.archive_entries WHERE id IN (e_pending, e_hidden, e_rejected);
  IF n <> 0 THEN RAISE EXCEPTION 'T10 precondition: RLS shows her % unpublished fixtures', n; END IF;
  FOREACH stmt IN ARRAY ARRAY['portrait 138', 'portrait 138 pending fixture', 'fixture maker', 'portrat 138', 'rejected', 'hidden'] LOOP
    SELECT count(*) INTO n FROM public.archive_search(p_q => stmt) WHERE id IN (e_pending, e_hidden, e_rejected);
    IF n <> 0 THEN RAISE EXCEPTION 'T10 a pending member searching "%" found % unpublished entries', stmt, n; END IF;
    SELECT coalesce(sum(entry_count), 0) INTO n FROM public.archive_search_facets(p_q => stmt);
    SELECT count(*) INTO m FROM public.archive_search(p_q => stmt);
    IF n <> m THEN RAISE EXCEPTION 'T10 facets for "%" count %, search returns %', stmt, n, m; END IF;
  END LOOP;
  FOREACH srt IN ARRAY ARRAY['top', 'voted', 'newest', 'needs', 'relevance'] LOOP
    SELECT count(*) INTO n FROM public.archive_search(p_sort => srt) WHERE id IN (e_pending, e_hidden, e_rejected);
    IF n <> 0 THEN RAISE EXCEPTION 'T10 browse (%) showed a pending member % unpublished entries', srt, n; END IF;
  END LOOP;
  SELECT coalesce(sum(entry_count), 0) INTO n FROM public.archive_search_facets();
  SELECT count(*) INTO m FROM public.archive_ranked_view;
  IF n <> m THEN RAISE EXCEPTION 'T10 facets count % entries, she can see %', n, m; END IF;
  -- Staff can read the unpublished rows directly, and browse still shows only
  -- the published catalogue, exactly as archive_ranked_view does.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.archive_entries WHERE id IN (e_pending, e_hidden, e_rejected);
  IF n <> 3 THEN RAISE EXCEPTION 'T10 precondition: staff should see all three fixtures directly, saw %', n; END IF;
  SELECT count(*) INTO n FROM public.archive_search(p_q => 'portrait 138') WHERE id IN (e_pending, e_hidden, e_rejected);
  SELECT count(*) INTO m FROM public.archive_search() WHERE id IN (e_pending, e_hidden, e_rejected);
  IF n + m <> 0 THEN RAISE EXCEPTION 'T10 staff search / browse showed unpublished entries (search %, browse %)', n, m; END IF;
  SELECT coalesce(sum(entry_count), 0) INTO n FROM public.archive_search_facets(p_q => 'portrait 138');
  SELECT count(*) INTO m FROM public.archive_search(p_q => 'portrait 138');
  IF n <> m THEN RAISE EXCEPTION 'T10 staff facets count % for "portrait 138", search returns %', n, m; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  -- And she cannot go round the RPCs to the row set they read.
  ok := false;
  BEGIN PERFORM count(*) FROM public.archive_search_rows('portrait', NULL, NULL, NULL, NULL, false, true);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T10 a member called archive_search_rows directly'; END IF;
  RAISE NOTICE 'PASS 138 T10 pending/hidden/rejected entries invisible to a member and to staff, in search, browse and facets';

  -- ── T11 the trigger keeps new and renamed rows findable ───────────────────
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'amelie 138');
  IF NOT 'zz138-amelie' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T11 a new row is not findable unaccented: %', got; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'zoe');
  IF NOT 'zz138-amelie' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T11 the new creator is not findable: %', got; END IF;
  RESET ROLE;
  UPDATE public.archive_entries SET updated_at = '2000-01-01' WHERE id = e_new;
  UPDATE public.archive_entries SET title = 'Amélie Poulain 138 Fixture', summary = 'A café near the Sacré-Cœur.' WHERE id = e_new;
  SELECT updated_at INTO old_at FROM public.archive_entries WHERE id = e_new;
  IF old_at <= '2000-01-02' THEN RAISE EXCEPTION 'T11 the trigger no longer stamps updated_at'; END IF;
  SET LOCAL ROLE authenticated;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'poulain');
  IF NOT 'zz138-amelie' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T11 a renamed row is not findable: %', got; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => 'sacre coeur');
  IF NOT 'zz138-amelie' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T11 a new summary is not findable: %', got; END IF;
  RAISE NOTICE 'PASS 138 T11 insert and rename re-index through the trigger, unaccented, updated_at kept';

  -- ── T12 min stars and scored only ─────────────────────────────────────────
  SELECT count(*), count(*) FILTER (WHERE NOT has_score) INTO n, k FROM public.archive_search(p_scored_only => true);
  SELECT count(*) INTO m FROM public.archive_ranked_view WHERE has_score;
  IF n <> m OR k <> 0 OR n = 0 THEN RAISE EXCEPTION 'T12 scored only: % rows (% unscored), view has %', n, k, m; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_min_stars => 4.5);
  IF NOT 'zz138-amelie' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T12 a 4.5-star entry fell below min 4.5: %', got; END IF;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_min_stars => 4.6);
  IF 'zz138-amelie' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T12 a 4.5-star entry passed min 4.6'; END IF;
  SELECT count(*), count(*) FILTER (WHERE vote_count = 0 OR calculated_percent < 80) INTO n, k FROM public.archive_search(p_min_stars => 4);
  SELECT count(*) INTO m FROM public.archive_ranked_view WHERE vote_count > 0 AND calculated_percent >= 80;
  IF n <> m OR k <> 0 THEN RAISE EXCEPTION 'T12 min 4 stars: % rows (% below), view has %', n, k, m; END IF;
  RAISE NOTICE 'PASS 138 T12 min stars reads the score the row shows; scored only keeps has_score';

  -- ── T13 relevance ──────────────────────────────────────────────────────────
  SELECT slug INTO stmt FROM public.archive_search(p_q => 'portrait of a lady', p_sort => 'relevance') LIMIT 1;
  IF stmt IS DISTINCT FROM 'portrait-of-a-lady-on-fire' THEN RAISE EXCEPTION 'T13 relevance put % first', stmt; END IF;
  SELECT slug INTO stmt FROM public.archive_search(p_q => 'portrat', p_sort => 'relevance') LIMIT 1;
  IF stmt IS DISTINCT FROM 'portrait-of-a-lady-on-fire' THEN RAISE EXCEPTION 'T13 relevance for a typo put % first', stmt; END IF;
  SELECT count(*) INTO n FROM public.archive_search(p_q => 'sciamma') WHERE match_rank <= 0;
  IF n <> 0 THEN RAISE EXCEPTION 'T13 % hits carry no rank', n; END IF;
  SELECT count(*) INTO n FROM public.archive_search() WHERE match_rank <> 0;
  IF n <> 0 THEN RAISE EXCEPTION 'T13 browse rows carry a rank (%)', n; END IF;
  SELECT array_agg(id ORDER BY ordinality) INTO ids FROM public.archive_search(p_sort => 'relevance') WITH ORDINALITY;
  SELECT array_agg(id ORDER BY ordinality) INTO ids2 FROM public.archive_search(p_sort => 'top') WITH ORDINALITY;
  IF ids IS DISTINCT FROM ids2 THEN RAISE EXCEPTION 'T13 relevance with no query is not the top order'; END IF;
  RAISE NOTICE 'PASS 138 T13 relevance leads with the closest match; browse has rank 0 and falls back to top';

  -- ── T16 browse returns exactly what the view returns her ──────────────────
  -- Row for row, every column, as a pending member and as staff. The DEFINER
  -- RPC computes rank_priority and calculated_percent itself, so a drift from
  -- 123's view, or a row the view would not show her, fails here.
  FOREACH srt IN ARRAY ARRAY['top', 'voted', 'needs', 'newest', 'relevance'] LOOP
    FOR k IN 1..2 LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('sub', CASE k WHEN 1 THEN a ELSE s END, 'role', 'authenticated')::text, true);
      SELECT array_agg(row(id, slug, title, media_type, release_year, creator, length_label, summary, cover_url, cover_gradient,
                           vote_count, up_count, star_sum, review_count, has_score, published_at, rank_priority, calculated_percent)::text
                       ORDER BY id)
        INTO got FROM public.archive_search(p_sort => srt);
      SELECT array_agg(row(id, slug, title, media_type, release_year, creator, length_label, summary, cover_url, cover_gradient,
                           vote_count, up_count, star_sum, review_count, has_score, published_at, rank_priority, calculated_percent)::text
                       ORDER BY id)
        INTO want FROM public.archive_ranked_view;
      IF got IS DISTINCT FROM want THEN
        RAISE EXCEPTION 'T16 % browse (sort %) differs from the view: % rows vs %, first difference %',
          CASE k WHEN 1 THEN 'member' ELSE 'staff' END, srt, cardinality(got), cardinality(want),
          (SELECT x FROM unnest(got) x EXCEPT SELECT y FROM unnest(want) y LIMIT 1);
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  RAISE NOTICE 'PASS 138 T16 browse equals archive_ranked_view row for row, every column, for a member and for staff';

  -- ── T17 a query ranks by relevance first, under every sort ────────────────
  -- Her sort chip is the tiebreak, not the order: "carol" sorted Top rated used
  -- to put The Price of Salt above Carol. An exact title always leads, even
  -- against a newer entry whose title starts with and repeats the word.
  FOREACH srt IN ARRAY ARRAY['top', 'voted', 'newest', 'needs', 'relevance'] LOOP
    FOR r IN
      SELECT * FROM (VALUES
        ('carol', 'carol'), ('Carol', 'carol'), ('bound', 'bound'), ('portrat', 'portrait-of-a-lady-on-fire'),
        ('portrat of a lady', 'portrait-of-a-lady-on-fire'), ('portrait of a lady on fire', 'portrait-of-a-lady-on-fire'),
        ('the handmaiden', 'the-handmaiden')
      ) AS v(q, want_first)
    LOOP
      SELECT x.slug INTO stmt FROM public.archive_search(p_q => r.q, p_sort => srt) WITH ORDINALITY x ORDER BY x.ordinality LIMIT 1;
      IF stmt IS DISTINCT FROM r.want_first THEN
        RAISE EXCEPTION 'T17 "%" sorted by % put % first, not %', r.q, srt, stmt, r.want_first;
      END IF;
    END LOOP;
  END LOOP;
  SELECT array_agg(x.slug ORDER BY x.ordinality) INTO got FROM public.archive_search(p_q => 'bound', p_sort => 'newest') WITH ORDINALITY x;
  IF NOT 'zz138-bound-echo' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T17 the echo fixture is not a hit for "bound": %', got; END IF;
  RAISE NOTICE 'PASS 138 T17 relevance leads under every sort; an exact title beats a newer, repeated, prefix title; typos still lead';

  -- ── T18 a query with no words finds nothing; "or" alone is a word ─────────
  -- A query that tokenises to nothing is a search for nothing, not a browse:
  -- `"` used to return the whole Archive. `or` on its own is not an operator
  -- (websearch reads it as one only between two terms), so it matches titles
  -- and creators containing it, as the old ILIKE did, instead of nothing.
  FOREACH stmt IN ARRAY ARRAY['"', '""', '-', '- -', '"-"', '.', '?!'] LOOP
    SELECT count(*) INTO n FROM public.archive_search(p_q => stmt);
    SELECT coalesce(sum(entry_count), 0) INTO m FROM public.archive_search_facets(p_q => stmt);
    IF n <> 0 OR m <> 0 THEN
      RAISE EXCEPTION 'T18 "%" has no words and returned % entries (facets %); it must return none, not a browse', stmt, n, m;
    END IF;
  END LOOP;
  FOREACH stmt IN ARRAY ARRAY['or', 'OR', ' or '] LOOP
    SELECT count(*) INTO m FROM public.archive_ranked_view v
    WHERE public.archive_unaccent(lower(v.title)) LIKE '%or%' OR public.archive_unaccent(lower(v.creator)) LIKE '%or%';
    IF m = 0 THEN RAISE EXCEPTION 'T18 precondition: no title or creator contains "or"'; END IF;
    SELECT count(*) INTO n FROM public.archive_search(p_q => stmt) x
    WHERE x.id IN (
      SELECT v.id FROM public.archive_ranked_view v
      WHERE public.archive_unaccent(lower(v.title)) LIKE '%or%' OR public.archive_unaccent(lower(v.creator)) LIKE '%or%'
    );
    IF n <> m THEN RAISE EXCEPTION 'T18 "%" found % of the % entries whose title or creator contains it', stmt, n, m; END IF;
  END LOOP;
  SELECT array_agg(slug) INTO got FROM public.archive_search(p_q => '"carol"');
  IF NOT 'carol' = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'T18 a quoted single word found %', got; END IF;
  RAISE NOTICE 'PASS 138 T18 a wordless query returns nothing (not a browse); "or" alone matches like a word';

  -- ── T15 bounds (before anon, which ends her session) ──────────────────────
  FOREACH stmt IN ARRAY ARRAY[
    $q$SELECT count(*) FROM public.archive_search(p_q => repeat('a', 101))$q$,
    $q$SELECT count(*) FROM public.archive_search_facets(p_q => repeat('a', 101))$q$,
    $q$SELECT count(*) FROM public.archive_search(p_limit => 51)$q$,
    $q$SELECT count(*) FROM public.archive_search(p_limit => 0)$q$,
    $q$SELECT count(*) FROM public.archive_search(p_offset => -1)$q$,
    $q$SELECT count(*) FROM public.archive_search(p_offset => 10001)$q$,
    $q$SELECT count(*) FROM public.archive_search(p_sort => 'random')$q$,
    $q$SELECT count(*) FROM public.archive_search(p_types => array_fill('film'::public.archive_media_type, ARRAY[21]))$q$,
    $q$SELECT count(*) FROM public.archive_search_facets(p_types => array_fill('film'::public.archive_media_type, ARRAY[21]))$q$,
    $q$SELECT count(*) FROM public.archive_search(p_year_from => 1799)$q$,
    $q$SELECT count(*) FROM public.archive_search(p_year_to => 2201)$q$,
    $q$SELECT count(*) FROM public.archive_search(p_year_from => 2020, p_year_to => 2019)$q$,
    $q$SELECT count(*) FROM public.archive_search(p_min_stars => 5.1)$q$,
    $q$SELECT count(*) FROM public.archive_search_facets(p_min_stars => -1)$q$
  ] LOOP
    ok := false; st := NULL;
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE; ok := st = '22023';
    END;
    IF NOT ok THEN RAISE EXCEPTION 'T15 accepted, or refused with % instead of 22023: %', coalesce(st, 'no error'), stmt; END IF;
  END LOOP;
  -- The edges are allowed: 100 characters once trimmed, limit 50, nulls take defaults.
  PERFORM count(*) FROM public.archive_search(p_q => '   ' || repeat('a', 100) || '   ', p_limit => 50, p_offset => 0);
  PERFORM count(*) FROM public.archive_search(p_q => NULL, p_sort => NULL, p_limit => NULL, p_offset => NULL);
  PERFORM count(*) FROM public.archive_search_facets(p_q => repeat('é', 100));
  RAISE NOTICE 'PASS 138 T15 out-of-bounds q, limit, offset, sort, types, years and stars refused with 22023';

  -- ── T14 anon: no way in ─────────────────────────────────────────────────────
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN PERFORM count(*) FROM public.archive_search(p_q => 'carol');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T14 anon could call archive_search'; END IF;
  ok := false;
  BEGIN PERFORM count(*) FROM public.archive_search_facets();
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T14 anon could call archive_search_facets'; END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS 138 T14 anon can call neither RPC';
END $$;

-- Leave no identity behind for a stacked check: auth.uid() reads claim.sub
-- first, then claims.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
-- And no fixture rows, so a down cycle can compare the catalogue to its start.
DELETE FROM public.archive_entries WHERE slug LIKE 'zz138-%';
