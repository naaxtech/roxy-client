-- ============================================================
-- 138_archive_search.sql
--
-- The Archive's search engine. Spec: docs/superpowers/specs/
-- 2026-10-26-archive-search-design.md, decision 3, slice 1.
--
-- WHAT WAS THERE. The browse screen searched with `title ILIKE '%q%' OR
-- creator ILIKE '%q%'`. "portrat" found nothing, "Celine" did not find Céline
-- Sciamma, and the weighted `search_tsv` that 097 built (with its GIN index)
-- was never queried by anything.
--
-- WHAT THIS ADDS.
--   * `search_tsv` rebuilt unaccented, with the weights the spec fixes: title
--     A, creator B, taxonomy C, summary D. Taxonomy (genres and tags) is
--     slice 2. The C slot is a real parameter of the document builder, so
--     slice 2 passes the names in and nothing else moves.
--   * `archive_search`: websearch syntax (quotes, `or`, `-word`) over the
--     vector, plus a trigram/substring path on title and creator for typos and
--     partial words. The substring arm is today's ILIKE, unaccented, so
--     nothing that matches today stops matching.
--   * `archive_search_facets`: entries per media type for the same query and
--     filters, one row per type.
--
-- SECURITY DEFINER, with visibility written into the function. Under a
-- member's RLS the planner may not evaluate a non-leakproof operator (LIKE,
-- @@, <%) before the policy's own qual, so none of the indexes below could
-- serve her and every search was a full scan (~120 ms at 10k entries). Both
-- RPCs therefore run as the table owner and read through one row set,
-- archive_search_rows, whose `status = 'published'` is the entire visibility
-- rule. That is exactly what she could see before:
--   * 096 "archive_entries_select_published": status = 'published' OR
--     is_roxy_staff(), TO authenticated. No vetting, block or report clause
--     (pending members browse on purpose, 079), and no other SELECT policy
--     exists on archive_entries (100's is UPDATE only).
--   * 123 archive_ranked_view adds WHERE status = 'published', so staff browse
--     is published-only too.
-- So: published rows, for every authenticated caller, staff included; nothing
-- else. 138's check proves browse equals the view row for row, as a member
-- and as staff (T16), and that pending, hidden and rejected entries never
-- surface (T10). If 096's policy or 123's view ever narrows, this function
-- must narrow in the same migration.
--
-- PREREQUISITE ON A HOSTED PROJECT. The extensions land in `extensions`
-- (011/049/051 put pgcrypto there) and every reference below is qualified.
-- If either extension was already installed in another schema, `IF NOT
-- EXISTS` skips it and the first qualified reference fails the migration:
-- loudly, and before anything half-works.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ── Folding ─────────────────────────────────────────────────────────────────
-- unaccent() is STABLE because it looks its dictionary up through
-- search_path. Naming the dictionary and pinning search_path makes the result
-- depend on the argument alone, which is what IMMUTABLE promises and what an
-- index expression requires.

CREATE OR REPLACE FUNCTION public.archive_unaccent(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT extensions.unaccent('extensions.unaccent'::regdictionary, p_text)
$$;

COMMENT ON FUNCTION public.archive_unaccent(text) IS
  'unaccent() with its dictionary pinned, so it can sit in an index. The Archive search folds both the index and the query through this.';

-- ── The document ────────────────────────────────────────────────────────────
-- Not the reviews, for the reason 097 gives: a search for "Sciamma" should
-- find her film, not the twenty reviews that mention her.

CREATE OR REPLACE FUNCTION public.archive_search_document(
  p_title    text,
  p_creator  text,
  p_summary  text,
  p_taxonomy text DEFAULT NULL
)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT setweight(to_tsvector('simple', coalesce(public.archive_unaccent(p_title), '')), 'A')
      || setweight(to_tsvector('simple', coalesce(public.archive_unaccent(p_creator), '')), 'B')
      || setweight(to_tsvector('simple', coalesce(public.archive_unaccent(p_taxonomy), '')), 'C')
      || setweight(to_tsvector('simple', coalesce(public.archive_unaccent(p_summary), '')), 'D')
$$;

COMMENT ON FUNCTION public.archive_search_document(text, text, text, text) IS
  'The Archive search vector: title A, creator B, taxonomy (genre and tag names) C, summary D, unaccented.';

-- The 097 trigger, the same columns and the same updated_at stamp; only the
-- vector it builds changed.
CREATE OR REPLACE FUNCTION public.archive_entries_search_tsv()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_tsv := public.archive_search_document(NEW.title, NEW.creator, NEW.summary);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Rebuild every existing vector. Only search_tsv is assigned, so the
-- `UPDATE OF title, creator, summary` trigger does not fire and no entry's
-- updated_at moves for a change she did not make.
UPDATE public.archive_entries
SET search_tsv = public.archive_search_document(title, creator, summary)
WHERE search_tsv IS DISTINCT FROM public.archive_search_document(title, creator, summary);

-- idx_archive_entries_search (097, GIN on search_tsv) is kept as it is. The
-- trigram indexes serve the substring and word_similarity arms; the
-- expressions match the ones archive_search filters on, character for character.
CREATE INDEX IF NOT EXISTS idx_archive_entries_title_trgm
  ON public.archive_entries USING gin (public.archive_unaccent(lower(title)) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_archive_entries_creator_trgm
  ON public.archive_entries USING gin (public.archive_unaccent(lower(creator)) extensions.gin_trgm_ops);

-- ── Input ───────────────────────────────────────────────────────────────────
-- One parser and one set of bounds for both RPCs, so a query cannot mean one
-- thing to the list and another to the counts beside it.
--
--   q_browse   no query at all: every published entry, in the chosen sort.
--   q_tsquery  websearch_to_tsquery over the folded query: quotes, `or`, `-word`.
--   q_exclude  the negated words and phrases alone. The fuzzy arm has no
--              operators of its own, so it is told what to keep out.
--   q_fuzzy    the positive text, operators stripped, for trigram and substring.
--   q_like     q_fuzzy as a LIKE pattern (`%text%`), its own wildcards escaped.
--   q_prefix   the same, anchored at the start (`text%`), for the title boost.
--
-- A query that is not empty but has no words (`"`, `-`, `?!`) is NOT browse:
-- q_browse is false and every match part is NULL, so it finds nothing. And
-- `or` is an operator only between two terms, as websearch reads it; a query
-- that is nothing but `or` keeps it as its fuzzy text.

CREATE OR REPLACE FUNCTION public.archive_search_input(
  p_q         text,
  p_types     public.archive_media_type[],
  p_year_from integer,
  p_year_to   integer,
  p_min_stars numeric,
  OUT q_browse  boolean,
  OUT q_tsquery tsquery,
  OUT q_exclude tsquery,
  OUT q_fuzzy   text,
  OUT q_like    text,
  OUT q_prefix  text
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_q text := btrim(coalesce(p_q, ''));
  v_negated text[];
  v_positive text;
  v_escaped text;
BEGIN
  IF length(v_q) > 100 THEN
    RAISE EXCEPTION 'archive_search: q is longer than 100 characters' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_types) > 20 THEN
    RAISE EXCEPTION 'archive_search: at most 20 types' USING ERRCODE = '22023';
  END IF;
  IF p_year_from NOT BETWEEN 1800 AND 2200 OR p_year_to NOT BETWEEN 1800 AND 2200 THEN
    RAISE EXCEPTION 'archive_search: years run from 1800 to 2200' USING ERRCODE = '22023';
  END IF;
  IF p_year_from > p_year_to THEN
    RAISE EXCEPTION 'archive_search: year_from is after year_to' USING ERRCODE = '22023';
  END IF;
  IF p_min_stars NOT BETWEEN 0 AND 5 THEN
    RAISE EXCEPTION 'archive_search: min_stars runs from 0 to 5' USING ERRCODE = '22023';
  END IF;

  q_browse := v_q = '';
  IF q_browse THEN
    RETURN;
  END IF;
  v_q := public.archive_unaccent(lower(v_q));

  q_tsquery := websearch_to_tsquery('simple', v_q);
  IF numnode(q_tsquery) = 0 THEN
    q_tsquery := NULL;
  END IF;

  v_negated := ARRAY(
    SELECT m[1] FROM regexp_matches(v_q, '(?:^|\s)-("[^"]*"|[^\s"]+)', 'g') AS m
  );
  IF cardinality(v_negated) > 0 THEN
    q_exclude := websearch_to_tsquery('simple', array_to_string(v_negated, ' or '));
    IF numnode(q_exclude) = 0 THEN
      q_exclude := NULL;
    END IF;
  END IF;

  v_positive := regexp_replace(v_q, '(?:^|\s)-("[^"]*"|[^\s"]+)', ' ', 'g');
  v_positive := btrim(regexp_replace(replace(v_positive, '"', ' '), '\s+', ' ', 'g'));
  q_fuzzy := btrim(regexp_replace(regexp_replace(v_positive, '(^|\s)or(?=\s|$)', ' ', 'g'), '\s+', ' ', 'g'));
  IF q_fuzzy = '' THEN
    q_fuzzy := v_positive;
  END IF;
  -- No words left (punctuation, a lone `-`): nothing for the fuzzy arm to
  -- match, rather than a LIKE '%-%' that finds every hyphenated name.
  IF to_tsvector('simple', q_fuzzy) = ''::tsvector THEN
    q_fuzzy := NULL;
  ELSE
    v_escaped := replace(replace(replace(q_fuzzy, '\', '\\'), '%', '\%'), '_', '\_');
    q_like := '%' || v_escaped || '%';
    q_prefix := v_escaped || '%';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.archive_search_input(text, public.archive_media_type[], integer, integer, numeric) IS
  'Bounds and parsing shared by archive_search and archive_search_facets. Raises 22023 on out-of-bounds input.';

-- ── The row set ─────────────────────────────────────────────────────────────
-- The one place a query, the filters and visibility become rows. Both RPCs
-- read it, so the list and the counts beside it cannot disagree on what
-- matches, and `status = 'published'` is written exactly once.
--
-- A row matches a non-empty query when the vector matches the websearch query
-- (quotes, `or` and `-word` are honoured), or when the positive text is a
-- substring of, or a word_similarity >= 0.5 to, the folded title or creator,
-- unless the vector matches one of the excluded words. The threshold is
-- pinned on the function so the `<%` operator, which the trigram index
-- serves, means the same thing on every connection.
--
-- Index use. Browse and search are the two arms of a UNION ALL, each gated by
-- q_browse alone. A gate on a parameter becomes a one-time filter, so the arm
-- that does not apply never runs, and the search arm is nothing but indexable
-- ORs (GIN on the tsv, GIN trigram on the folded title and creator), which the
-- planner serves with a BitmapOr in a generic plan too. A single WHERE with a
-- `q IS NULL OR ...` arm cannot use any index once plpgsql caches a generic
-- plan, which it does after five calls on a pooled connection.
--
-- match_rank, for a query (0 for browse):
--     ts_rank_cd, normalised into [0, 1) (flag 32: rank / (rank + 1))
--   + the best word_similarity on title or creator, [0, 1]
--   + 2 for an exact folded title, else 1 for a title that starts with the text
-- An exact title scores at least 3 and anything else less than 3, so "carol"
-- puts Carol first whatever the summaries say.
--
-- rank_priority and calculated_percent are 123's view expressions, character
-- for character; 138's check compares every column with the view (T16).
--
-- Members cannot call it: they reach it only through the two DEFINER RPCs,
-- inside which it runs as the table owner.

CREATE OR REPLACE FUNCTION public.archive_search_rows(
  p_q            text,
  p_types        public.archive_media_type[],
  p_year_from    integer,
  p_year_to      integer,
  p_min_stars    numeric,
  p_scored_only  boolean,
  p_filter_types boolean
)
RETURNS TABLE (
  id                 uuid,
  slug               text,
  title              text,
  media_type         public.archive_media_type,
  release_year       integer,
  creator            text,
  length_label       text,
  summary            text,
  cover_url          text,
  cover_gradient     text,
  vote_count         integer,
  up_count           integer,
  star_sum           integer,
  review_count       integer,
  has_score          boolean,
  published_at       timestamptz,
  rank_priority      integer,
  calculated_percent numeric,
  match_rank         real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET pg_trgm.word_similarity_threshold = '0.5'
AS $$
DECLARE
  v_in record;
BEGIN
  v_in := public.archive_search_input(p_q, p_types, p_year_from, p_year_to, p_min_stars);

  RETURN QUERY
  SELECT
    c.id, c.slug, c.title, c.media_type, c.release_year, c.creator, c.length_label, c.summary,
    c.cover_url, c.cover_gradient, c.vote_count, c.up_count, c.star_sum, c.review_count,
    c.has_score, c.published_at, c.rank_priority, c.calculated_percent,
    CASE
      WHEN v_in.q_browse THEN 0::real
      ELSE (
        coalesce(ts_rank_cd(c.search_tsv, v_in.q_tsquery, 32), 0)
        + greatest(
            coalesce(extensions.word_similarity(v_in.q_fuzzy, public.archive_unaccent(lower(c.title))), 0),
            coalesce(extensions.word_similarity(v_in.q_fuzzy, public.archive_unaccent(lower(c.creator))), 0)
          )
        + CASE
            WHEN public.archive_unaccent(lower(c.title)) = v_in.q_fuzzy THEN 2
            WHEN public.archive_unaccent(lower(c.title)) LIKE v_in.q_prefix THEN 1
            ELSE 0
          END
      )::real
    END
  FROM (
    SELECT
      e.*,
      CASE
        WHEN e.has_score THEN 0
        WHEN e.vote_count > 0 THEN 1
        ELSE 2
      END AS rank_priority,
      CASE
        WHEN e.vote_count <= 0 THEN 0::numeric
        WHEN e.star_sum > 0 THEN ((e.star_sum::numeric / e.vote_count) / 5.0) * 100
        ELSE (e.up_count::numeric / e.vote_count) * 100
      END AS calculated_percent
    FROM (
      SELECT b.* FROM public.archive_entries b
      WHERE v_in.q_browse
      UNION ALL
      SELECT h.* FROM public.archive_entries h
      WHERE NOT v_in.q_browse
        AND (
          h.search_tsv @@ v_in.q_tsquery
          OR (
            NOT coalesce(h.search_tsv @@ v_in.q_exclude, false)
            AND (
              public.archive_unaccent(lower(h.title)) LIKE v_in.q_like
              OR public.archive_unaccent(lower(h.creator)) LIKE v_in.q_like
              OR v_in.q_fuzzy OPERATOR(extensions.<%) public.archive_unaccent(lower(h.title))
              OR v_in.q_fuzzy OPERATOR(extensions.<%) public.archive_unaccent(lower(h.creator))
            )
          )
        )
    ) e
    -- Visibility, the whole of it (see the header): published, for everyone.
    WHERE e.status = 'published'
  ) c
  WHERE (NOT p_filter_types OR p_types IS NULL OR c.media_type = ANY (p_types))
    AND (p_year_from IS NULL OR c.release_year >= p_year_from)
    AND (p_year_to IS NULL OR c.release_year <= p_year_to)
    -- In stars, the score the row shows: calculated_percent is the star
    -- average as a percentage (or the recommend % before stars existed).
    AND (p_min_stars IS NULL OR (c.vote_count > 0 AND c.calculated_percent >= p_min_stars * 20))
    AND (NOT coalesce(p_scored_only, false) OR c.has_score);
END;
$$;

COMMENT ON FUNCTION public.archive_search_rows(text, public.archive_media_type[], integer, integer, numeric, boolean, boolean) IS
  'The Archive row set behind archive_search and archive_search_facets: published entries matching a query and filters, with match_rank. Visibility lives here. Not executable by members.';

-- ── archive_search ──────────────────────────────────────────────────────────
-- Rows are archive_ranked_view's columns, the ones lib/archive.ts reads today,
-- plus match_rank.
--
-- A query always leads with match_rank, whatever the sort: her sort chip is
-- the tiebreak among equally good matches, never a reason to bury the title
-- she typed. With no query every rank is 0 and the chosen sort is the whole
-- order. `relevance` is therefore `top` under another name, kept so a client
-- may send it. The four sorts are fetchArchiveEntries' orders (lib/archive.ts),
-- and every one ends on `id` so a page edge between equal rows is stable.

CREATE OR REPLACE FUNCTION public.archive_search(
  p_q           text DEFAULT NULL,
  p_types       public.archive_media_type[] DEFAULT NULL,
  p_year_from   integer DEFAULT NULL,
  p_year_to     integer DEFAULT NULL,
  p_min_stars   numeric DEFAULT NULL,
  p_scored_only boolean DEFAULT false,
  p_sort        text DEFAULT 'top',
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE (
  id                 uuid,
  slug               text,
  title              text,
  media_type         public.archive_media_type,
  release_year       integer,
  creator            text,
  length_label       text,
  summary            text,
  cover_url          text,
  cover_gradient     text,
  vote_count         integer,
  up_count           integer,
  star_sum           integer,
  review_count       integer,
  has_score          boolean,
  published_at       timestamptz,
  rank_priority      integer,
  calculated_percent numeric,
  match_rank         real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sort   text    := coalesce(p_sort, 'top');
  v_limit  integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
BEGIN
  IF v_sort NOT IN ('top', 'voted', 'newest', 'needs', 'relevance') THEN
    RAISE EXCEPTION 'archive_search: sort is one of top, voted, newest, needs, relevance' USING ERRCODE = '22023';
  END IF;
  IF v_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'archive_search: limit runs from 1 to 50' USING ERRCODE = '22023';
  END IF;
  IF v_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'archive_search: offset runs from 0 to 10000' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.slug, r.title, r.media_type, r.release_year, r.creator, r.length_label, r.summary,
    r.cover_url, r.cover_gradient, r.vote_count, r.up_count, r.star_sum, r.review_count,
    r.has_score, r.published_at, r.rank_priority, r.calculated_percent, r.match_rank
  FROM public.archive_search_rows(p_q, p_types, p_year_from, p_year_to, p_min_stars, p_scored_only, true) r
  ORDER BY
    r.match_rank DESC,
    CASE WHEN v_sort IN ('top', 'relevance') THEN r.rank_priority END ASC,
    CASE WHEN v_sort IN ('top', 'relevance') THEN r.calculated_percent END DESC,
    CASE WHEN v_sort IN ('top', 'relevance', 'voted') THEN r.vote_count END DESC,
    CASE WHEN v_sort = 'needs' THEN r.rank_priority END DESC,
    CASE WHEN v_sort = 'needs' THEN r.vote_count END ASC,
    CASE WHEN v_sort = 'newest' THEN r.published_at END DESC,
    r.id ASC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION public.archive_search(text, public.archive_media_type[], integer, integer, numeric, boolean, text, integer, integer) IS
  'Archive browse and search: published entries shaped like archive_ranked_view, plus match_rank; a query leads with relevance. SECURITY DEFINER (indexes serve members); visibility in archive_search_rows; bounded inputs (22023).';

-- ── archive_search_facets ───────────────────────────────────────────────────
-- One row per media type, zero included, for the same query and filters.
-- p_types is validated like archive_search's, so one filter object serves both
-- calls, and it does NOT narrow the type counts: a dimension's own filter never
-- narrows its own counts, or picking Film would make every other chip read 0
-- and offer her nothing to switch to. (Slice 2's genre and tag counts will be
-- narrowed by it.)

CREATE OR REPLACE FUNCTION public.archive_search_facets(
  p_q           text DEFAULT NULL,
  p_types       public.archive_media_type[] DEFAULT NULL,
  p_year_from   integer DEFAULT NULL,
  p_year_to     integer DEFAULT NULL,
  p_min_stars   numeric DEFAULT NULL,
  p_scored_only boolean DEFAULT false
)
RETURNS TABLE (
  media_type  public.archive_media_type,
  entry_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.kind, count(r.id)::integer
  FROM unnest(enum_range(NULL::public.archive_media_type)) AS t(kind)
  LEFT JOIN public.archive_search_rows(p_q, p_types, p_year_from, p_year_to, p_min_stars, p_scored_only, false) r
    ON r.media_type = t.kind
  GROUP BY t.kind
  ORDER BY t.kind
$$;

COMMENT ON FUNCTION public.archive_search_facets(text, public.archive_media_type[], integer, integer, numeric, boolean) IS
  'Entries per media type for an Archive query, one row per type. Type counts ignore p_types. SECURITY DEFINER; visibility in archive_search_rows.';

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Members only. The Archive's read policies are TO authenticated (096), and an
-- anon caller has nothing to search. The row set is reached only through the
-- two RPCs, so nobody but its owner may call it directly. The two folding
-- helpers are also run by service_role: edge-function writes to
-- archive_entries fire the trigger and compute the index expressions.

REVOKE ALL ON FUNCTION public.archive_search(text, public.archive_media_type[], integer, integer, numeric, boolean, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.archive_search_facets(text, public.archive_media_type[], integer, integer, numeric, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.archive_search_rows(text, public.archive_media_type[], integer, integer, numeric, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_search_input(text, public.archive_media_type[], integer, integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.archive_search_document(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.archive_unaccent(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.archive_search(text, public.archive_media_type[], integer, integer, numeric, boolean, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_search_facets(text, public.archive_media_type[], integer, integer, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_search_input(text, public.archive_media_type[], integer, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_search_document(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_unaccent(text) TO authenticated, service_role;
