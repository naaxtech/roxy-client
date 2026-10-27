-- 138 down: reverses 138_archive_search.sql.
-- Run only inside a transaction you have backed up.
--
-- What it restores:
--   * the 097 trigger body, byte for byte;
--   * the 097 vectors (accented, summary at weight C);
--   * no trigram indexes, no search RPCs.
--
-- The extensions stay installed. `CREATE EXTENSION IF NOT EXISTS` cannot tell
-- whether 138 installed pg_trgm / unaccent or found them already there.
-- Dropping one that something else uses does more harm than leaving an unused
-- one in place, and leaving it is harmless.
-- destructive-ok: down file

DROP FUNCTION IF EXISTS public.archive_search(text, public.archive_media_type[], integer, integer, numeric, boolean, text, integer, integer);
DROP FUNCTION IF EXISTS public.archive_search_facets(text, public.archive_media_type[], integer, integer, numeric, boolean);
DROP FUNCTION IF EXISTS public.archive_search_rows(text, public.archive_media_type[], integer, integer, numeric, boolean, boolean);
DROP FUNCTION IF EXISTS public.archive_search_input(text, public.archive_media_type[], integer, integer, numeric);

-- archive_entries_search_tsv exactly as 097 left it.
CREATE OR REPLACE FUNCTION public.archive_entries_search_tsv()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_tsv :=
      setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A')
   || setweight(to_tsvector('simple', coalesce(NEW.creator, '')), 'B')
   || setweight(to_tsvector('simple', coalesce(NEW.summary, '')), 'C');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- The 097 vectors. Only search_tsv is assigned, so the trigger does not fire
-- and updated_at stays where it was.
UPDATE public.archive_entries
SET search_tsv =
      setweight(to_tsvector('simple', coalesce(title, '')), 'A')
   || setweight(to_tsvector('simple', coalesce(creator, '')), 'B')
   || setweight(to_tsvector('simple', coalesce(summary, '')), 'C')
WHERE search_tsv IS DISTINCT FROM (
      setweight(to_tsvector('simple', coalesce(title, '')), 'A')
   || setweight(to_tsvector('simple', coalesce(creator, '')), 'B')
   || setweight(to_tsvector('simple', coalesce(summary, '')), 'C'));

DROP INDEX IF EXISTS public.idx_archive_entries_title_trgm;
DROP INDEX IF EXISTS public.idx_archive_entries_creator_trgm;

DROP FUNCTION IF EXISTS public.archive_search_document(text, text, text, text);
DROP FUNCTION IF EXISTS public.archive_unaccent(text);
