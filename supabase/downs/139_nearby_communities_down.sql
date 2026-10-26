-- 139 down — reverses 139_nearby_communities.sql.
-- Run only inside a transaction you have backed up. Drops every community's
-- city and meets setting and the whole cities table (reload it with
-- scripts/load-cities.mjs after re-applying 139); communities themselves stay.
-- destructive-ok: down file

DROP FUNCTION IF EXISTS public.suggest_nearby_communities(double precision, double precision, integer, text[], text[], boolean, integer);
DROP FUNCTION IF EXISTS public.suggest_communities_in_city(integer, integer, text[], text[], boolean, integer);
DROP FUNCTION IF EXISTS public._community_suggestions(double precision, double precision, integer, integer, text[], text[], boolean, integer);
DROP FUNCTION IF EXISTS public.search_cities(text);
DROP FUNCTION IF EXISTS public.haversine_km(double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.set_community_location(uuid, integer, text);

-- Writes go back to the table-level INSERT/UPDATE authenticated had before.
REVOKE INSERT (id, name, slug, description, cover_image_url, category, is_private, member_count, created_by, created_at),
       UPDATE (id, name, slug, description, cover_image_url, category, is_private, member_count, created_by, created_at)
  ON public.communities FROM authenticated;
GRANT INSERT, UPDATE ON public.communities TO authenticated;

DROP TRIGGER IF EXISTS trg_communities_point_from_city ON public.communities;
DROP FUNCTION IF EXISTS public.communities_point_from_city();
DROP INDEX IF EXISTS public.idx_communities_point;
DROP INDEX IF EXISTS public.idx_communities_city_id;
ALTER TABLE public.communities
  DROP CONSTRAINT IF EXISTS communities_in_person_needs_city,
  DROP CONSTRAINT IF EXISTS communities_point_needs_city,
  DROP CONSTRAINT IF EXISTS communities_meets_check,
  DROP COLUMN IF EXISTS lat,
  DROP COLUMN IF EXISTS lng,
  DROP COLUMN IF EXISTS meets,
  DROP COLUMN IF EXISTS city_id;

DROP TABLE IF EXISTS public.cities;
DROP FUNCTION IF EXISTS public.cities_repoint_communities();
DROP FUNCTION IF EXISTS public.fold_city_name(text);
