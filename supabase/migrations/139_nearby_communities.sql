-- 139 — nearby communities (slice/roxy/nearby-communities, S1 backend).
--
-- Why: "User should be able to get suggestions from communities nearby if
-- their location GPS is turned on, then also, by filter" (owner 2026-10-26).
-- Spec: docs/superpowers/specs/2026-10-26-nearby-communities-design.md.
--
-- Safety rules this file is built around (a location leak can out a member):
--   * HER position is never stored. The device rounds it to 0.1° (~11 km); the
--     rounded pair reaches only suggest_nearby_communities, which refuses
--     anything finer, is STABLE (so it cannot write) and never echoes it back
--     in an error. Results carry a distance BAND, never kilometres.
--   * A COMMUNITY's place is its owner's choice, at city level: a city centroid
--     rounded to 2 dp, copied by trigger from `cities`, never typed in. Online
--     communities have no place and are never "nearby".
--
-- What:
--   1. `cities` — GeoNames cities15000 reference data (CC-BY 4.0), id = the
--      GeoNames geonameid, so it is a stable key for later references (the
--      Supporter slice's private profiles.home_city_id). Loaded by
--      scripts/load-cities.mjs, not here. Members read; nobody writes.
--   2. `communities.city_id / meets / lat / lng`. lat/lng are always the
--      city's rounded centroid (trigger), NULL exactly when city_id is NULL
--      (CHECK). Members and owners lose direct write access to the four new
--      columns (column grants replace the table-level INSERT/UPDATE; every old
--      column keeps exactly the rights it had), so the only door is (3).
--   3. `set_community_location(community, city, meets)` — SECURITY DEFINER,
--      for the owner (created_by), its moderators (is_community_moderator) or
--      Roxy staff. create_community (132) is left untouched: Studio calls this
--      right after create. An overload with extra defaulted arguments would make
--      PostgREST's choice ambiguous, and a failed second call leaves the safe
--      default (meets = 'online', never nearby).
--   4. `suggest_nearby_communities`, `suggest_communities_in_city` — SECURITY
--      INVOKER, so communities RLS still decides what she can see; both run the
--      one query in `_community_suggestions`, which applies the same rounding
--      rule to raw coordinates, so calling it directly gains nothing.
--   5. `search_cities(q)` for the city picker; `haversine_km` helper.
--
-- Expand only: no existing column, policy or function changes behaviour.
-- Down: supabase/downs/139_nearby_communities_down.sql.
-- Proof: supabase/tests/139_nearby_communities_check.sql.

-- ── 1. cities ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cities (
  id           integer          PRIMARY KEY CHECK (id > 0),
  name         text             NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  ascii_name   text             NOT NULL CHECK (char_length(ascii_name) BETWEEN 1 AND 200),
  admin1       text             CHECK (admin1 IS NULL OR char_length(admin1) BETWEEN 1 AND 200),
  country_code character(2)     NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  lat          double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng          double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  population   integer          NOT NULL DEFAULT 0 CHECK (population >= 0)
);

COMMENT ON TABLE public.cities IS
  'GeoNames cities15000 (CC-BY 4.0, geonames.org; attribution in About). id = geonameid, stable across reloads. Loaded by scripts/load-cities.mjs. Members read only.';
COMMENT ON COLUMN public.cities.admin1 IS
  'First-level region name from admin1CodesASCII.txt when the loader had it, else the GeoNames admin1 code.';

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cities_read ON public.cities;
CREATE POLICY cities_read ON public.cities
  FOR SELECT TO authenticated
  USING (true);

-- Reference data: members read, nobody writes (the loader runs as postgres).
-- service_role keeps the grant Supabase default privileges gave it.
REVOKE ALL ON public.cities FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cities TO authenticated;

-- What she types and what GeoNames stores, folded the same way: lower case,
-- common Latin accents dropped (Parañaque -> paranaque). GeoNames' own ASCII
-- name transliterates some letters differently (Zürich -> "Zuerich"), so the
-- picker matches the folded native name too.
CREATE OR REPLACE FUNCTION public.fold_city_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT lower(translate(p,
    'ÁÀÂÄÃÅĀĂĄáàâäãåāăąÉÈÊËĒĖĘĚéèêëēėęěÍÌÎÏĪĮíìîïīįÓÒÔÖÕØŌóòôöõøōÚÙÛÜŪŮúùûüūůÑŃŇñńňÇĆČçćčÝŸýÿŠŚšśŽŹŻžźżĐđŁł',
    'AAAAAAAAAaaaaaaaaaEEEEEEEEeeeeeeeeIIIIIIiiiiiiOOOOOOOoooooooUUUUUUuuuuuuNNNnnnCCCcccYYyySSssZZZzzzDdLl'))
$$;

-- The city picker: prefix on the ASCII name (and the folded native name),
-- biggest city first.
CREATE INDEX IF NOT EXISTS cities_ascii_name_prefix_idx
  ON public.cities (lower(ascii_name) text_pattern_ops, population DESC);
CREATE INDEX IF NOT EXISTS cities_name_fold_prefix_idx
  ON public.cities (public.fold_city_name(name) text_pattern_ops);

-- ── 2. where a community meets ─────────────────────────────────────────────
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS city_id integer REFERENCES public.cities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meets   text NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS lat     double precision,
  ADD COLUMN IF NOT EXISTS lng     double precision;

ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_meets_check;
ALTER TABLE public.communities
  ADD CONSTRAINT communities_meets_check CHECK (meets IN ('online', 'in_person', 'both'));

-- A point exists exactly when a city does: never coordinates without a city.
ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_point_needs_city;
ALTER TABLE public.communities
  ADD CONSTRAINT communities_point_needs_city
  CHECK ((city_id IS NULL) = (lat IS NULL) AND (city_id IS NULL) = (lng IS NULL));

-- Meeting in person means meeting somewhere.
ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_in_person_needs_city;
ALTER TABLE public.communities
  ADD CONSTRAINT communities_in_person_needs_city CHECK (meets = 'online' OR city_id IS NOT NULL);

COMMENT ON COLUMN public.communities.city_id IS
  'Where the community meets, at city level (owner''s choice). Set only through set_community_location().';
COMMENT ON COLUMN public.communities.meets IS
  'online | in_person | both. Online-only communities are never suggested as nearby.';
COMMENT ON COLUMN public.communities.lat IS
  'The city centroid rounded to 2 dp, copied by trigger. Never written directly.';
COMMENT ON COLUMN public.communities.lng IS
  'The city centroid rounded to 2 dp, copied by trigger. Never written directly.';

CREATE INDEX IF NOT EXISTS idx_communities_city_id
  ON public.communities (city_id) WHERE city_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_communities_point
  ON public.communities (lat, lng) WHERE lat IS NOT NULL AND meets <> 'online';

-- The point is always recomputed from the city, whatever the statement said,
-- so not even definer code or service_role can store a point that is not a
-- city centroid. Fires for the FK's ON DELETE SET NULL too, which clears it;
-- a community whose city is taken away falls back to online (never nearby)
-- until its owner picks a city again.
CREATE OR REPLACE FUNCTION public.communities_point_from_city()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lat double precision;
  v_lng double precision;
BEGIN
  IF NEW.city_id IS NOT NULL THEN
    SELECT ci.lat, ci.lng INTO v_lat, v_lng FROM public.cities ci WHERE ci.id = NEW.city_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.city_id IS NOT NULL THEN
    NEW.meets := 'online';
  END IF;
  NEW.lat := round(v_lat::numeric, 2)::double precision;
  NEW.lng := round(v_lng::numeric, 2)::double precision;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_communities_point_from_city ON public.communities;
CREATE TRIGGER trg_communities_point_from_city
  BEFORE INSERT OR UPDATE OF city_id, lat, lng ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.communities_point_from_city();

-- A reload that moves a city's centroid re-points its communities.
CREATE OR REPLACE FUNCTION public.cities_repoint_communities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.communities SET city_id = NEW.id WHERE city_id = NEW.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_cities_repoint_communities ON public.cities;
CREATE TRIGGER trg_cities_repoint_communities
  AFTER UPDATE OF lat, lng ON public.cities
  FOR EACH ROW
  WHEN (OLD.lat IS DISTINCT FROM NEW.lat OR OLD.lng IS DISTINCT FROM NEW.lng)
  EXECUTE FUNCTION public.cities_repoint_communities();

REVOKE ALL ON FUNCTION public.communities_point_from_city(), public.cities_repoint_communities()
  FROM PUBLIC, anon, authenticated;

-- Direct writes: the table-level INSERT/UPDATE that 003's default privileges
-- gave authenticated becomes a column grant on exactly the columns that
-- existed before this file. Owners keep editing name/description/etc. directly
-- (communities_update_own still decides which rows); the four new columns are
-- written only by set_community_location and the trigger above. SELECT stays
-- table-level: the app reads communities with select('*').
REVOKE INSERT, UPDATE ON public.communities FROM authenticated;
GRANT INSERT (id, name, slug, description, cover_image_url, category, is_private, member_count, created_by, created_at),
      UPDATE (id, name, slug, description, cover_image_url, category, is_private, member_count, created_by, created_at)
  ON public.communities TO authenticated;

-- ── 3. the owner sets where it meets ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_community_location(p_community_id uuid, p_city_id integer, p_meets text)
RETURNS public.communities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_row public.communities;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_meets IS NULL OR p_meets NOT IN ('online', 'in_person', 'both') THEN
    RAISE EXCEPTION 'meets must be online, in_person or both' USING ERRCODE = '22023';
  END IF;
  IF p_meets <> 'online' AND p_city_id IS NULL THEN
    RAISE EXCEPTION 'a community that meets in person needs a city' USING ERRCODE = '22023';
  END IF;

  -- Who may is decided before the row is touched, so a stranger learns nothing
  -- about a private community (not even that it exists) and locks nothing.
  -- Composed from the people who hold the power, never by excluding someone.
  IF NOT (
       public.is_roxy_staff()
       OR public.is_roxy_core()
       OR public.is_community_moderator(p_community_id)
       OR (public.is_approved_member()
           AND EXISTS (SELECT 1 FROM public.communities c
                       WHERE c.id = p_community_id AND c.created_by = v_me))
     ) THEN
    RAISE EXCEPTION 'only the people who run this community can set where it meets' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.communities c WHERE c.id = p_community_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Community not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_city_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cities ci WHERE ci.id = p_city_id) THEN
    RAISE EXCEPTION 'unknown city' USING ERRCODE = '22023';
  END IF;

  UPDATE public.communities c
     SET city_id = p_city_id, meets = p_meets
   WHERE c.id = p_community_id
  RETURNING c.* INTO v_row;
  RETURN v_row;
END $$;

COMMENT ON FUNCTION public.set_community_location(uuid, integer, text) IS
  'Owner (approved), community moderator or Roxy staff sets city + meets. in_person/both need a city; lat/lng follow from the city by trigger.';

-- ── 4. distance on a sphere ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.haversine_km(lat1 double precision, lng1 double precision,
                                               lat2 double precision, lng2 double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT 2 * 6371.0088 * asin(least(1.0::double precision, sqrt(
           sin(radians(lat2 - lat1) / 2) ^ 2
           + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2)))
$$;

-- ── 5. suggestions ─────────────────────────────────────────────────────────
-- The one query. Origin: a rounded position (p_lat/p_lng) OR a city (p_city_id).
CREATE OR REPLACE FUNCTION public._community_suggestions(
  p_lat double precision, p_lng double precision, p_city_id integer,
  p_radius_km integer, p_categories text[], p_meets text[], p_open_only boolean, p_limit integer)
RETURNS TABLE (
  id uuid, name text, slug text, description text, cover_image_url text, category text,
  is_private boolean, member_count integer, created_by uuid, created_at timestamptz,
  city_id integer, city_name text, meets text, distance_band text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_me         uuid := auth.uid();
  v_lat        double precision;
  v_lng        double precision;
  v_categories text[] := NULLIF(p_categories, '{}');
  v_meets      text[] := coalesce(NULLIF(p_meets, '{}'), ARRAY['in_person', 'both']);
  v_delta      double precision;
  v_dlat       double precision;
  v_dlng       double precision;
  v_lng_any    boolean := false;
  v_lng_lo     double precision;
  v_lng_hi     double precision;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  -- POST only: a GET carries her position in the URL, and the API gateway logs
  -- URLs. (Under PostgREST a STABLE function also runs READ ONLY, POST or not.)
  -- src: https://docs.postgrest.org/en/v14/references/transactions.html · PostgREST v14.4 · 2026-10-26
  IF current_setting('request.method', true) = 'GET' THEN
    RAISE EXCEPTION 'call this with POST, never GET' USING ERRCODE = '0A000';
  END IF;

  -- Errors name the rule, never the value: her position must not reach a log.
  IF p_city_id IS NOT NULL THEN
    IF p_lat IS NOT NULL OR p_lng IS NOT NULL THEN
      RAISE EXCEPTION 'pass a city or a position, not both' USING ERRCODE = '22023';
    END IF;
    SELECT ci.lat, ci.lng INTO v_lat, v_lng FROM public.cities ci WHERE ci.id = p_city_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'city not found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    IF p_lat IS NULL OR p_lng IS NULL
       OR NOT (p_lat BETWEEN -90 AND 90) OR NOT (p_lng BETWEEN -180 AND 180) THEN
      RAISE EXCEPTION 'a rounded position or a city is required' USING ERRCODE = '22023';
    END IF;
    IF p_lat <> round(p_lat::numeric, 1)::double precision
       OR p_lng <> round(p_lng::numeric, 1)::double precision THEN
      RAISE EXCEPTION 'position must be rounded to one decimal place on the device' USING ERRCODE = '22023';
    END IF;
    v_lat := p_lat;
    v_lng := p_lng;
  END IF;

  IF p_radius_km IS NULL OR p_radius_km NOT IN (10, 25, 50, 100, 1000) THEN
    RAISE EXCEPTION 'radius must be 10, 25, 50, 100 or 1000 km' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'limit must be between 1 and 50' USING ERRCODE = '22023';
  END IF;
  IF v_categories IS NOT NULL
     AND (array_position(v_categories, NULL) IS NOT NULL
          OR NOT v_categories <@ ARRAY['identity', 'interest', 'location', 'support']) THEN
    RAISE EXCEPTION 'unknown category' USING ERRCODE = '22023';
  END IF;
  -- Online-only communities are never nearby; asking for them is a client bug.
  IF array_position(v_meets, NULL) IS NOT NULL OR NOT v_meets <@ ARRAY['in_person', 'both'] THEN
    RAISE EXCEPTION 'nearby lists communities that meet in person: meets must be in_person or both'
      USING ERRCODE = '22023';
  END IF;

  -- Bounding box on the same sphere as haversine_km (0.1% margin): a latitude
  -- band, and a longitude band of asin(sin d / cos lat) that is dropped when
  -- the circle reaches a pole and split when it crosses the antimeridian.
  v_delta := (p_radius_km * 1.001) / 6371.0088;
  v_dlat := degrees(v_delta);
  IF abs(v_lat) + v_dlat >= 90 THEN
    v_lng_any := true;
  ELSE
    v_dlng := degrees(asin(least(1.0::double precision, sin(v_delta) / cos(radians(v_lat)))));
    v_lng_lo := v_lng - v_dlng;
    v_lng_hi := v_lng + v_dlng;
  END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.slug, c.description, c.cover_image_url, c.category,
         coalesce(c.is_private, false), coalesce(c.member_count, 0), c.created_by, c.created_at,
         c.city_id, ci.name, c.meets,
         CASE WHEN g.km < 10  THEN 'under_10'
              WHEN g.km < 25  THEN 'under_25'
              WHEN g.km < 50  THEN 'under_50'
              WHEN g.km < 100 THEN 'under_100'
              ELSE 'farther' END
  FROM public.communities c
  JOIN public.cities ci ON ci.id = c.city_id
  CROSS JOIN LATERAL (SELECT public.haversine_km(v_lat, v_lng, c.lat, c.lng) AS km) g
  WHERE c.lat IS NOT NULL
    AND c.meets <> 'online'
    AND c.meets = ANY (v_meets)
    AND (v_categories IS NULL OR c.category = ANY (v_categories))
    AND (NOT coalesce(p_open_only, false) OR NOT coalesce(c.is_private, false))
    AND c.lat BETWEEN v_lat - v_dlat AND v_lat + v_dlat
    AND (v_lng_any
         OR c.lng BETWEEN v_lng_lo AND v_lng_hi
         OR (v_lng_lo < -180 AND c.lng >= v_lng_lo + 360)
         OR (v_lng_hi > 180 AND c.lng <= v_lng_hi - 360))
    AND g.km <= p_radius_km
    AND NOT EXISTS (
      SELECT 1 FROM public.community_members m
      WHERE m.community_id = c.id AND m.user_id = v_me)
    AND NOT public.is_banned_from_community(c.id, v_me)
    AND NOT public.blocked_pair(c.created_by, v_me)
  ORDER BY g.km, c.member_count DESC NULLS LAST, c.id
  LIMIT p_limit;
END $$;

COMMENT ON FUNCTION public._community_suggestions(double precision, double precision, integer, integer, text[], text[], boolean, integer) IS
  'Internal to suggest_nearby_communities / suggest_communities_in_city. Same rules for raw coordinates (rounded to 0.1 deg or refused). Writes nothing.';

-- From her rounded GPS position.
CREATE OR REPLACE FUNCTION public.suggest_nearby_communities(
  p_lat double precision, p_lng double precision, p_radius_km integer DEFAULT 50,
  p_categories text[] DEFAULT NULL, p_meets text[] DEFAULT NULL,
  p_open_only boolean DEFAULT false, p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid, name text, slug text, description text, cover_image_url text, category text,
  is_private boolean, member_count integer, created_by uuid, created_at timestamptz,
  city_id integer, city_name text, meets text, distance_band text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public._community_suggestions(
    p_lat, p_lng, NULL, p_radius_km, p_categories, p_meets, p_open_only, p_limit);
$$;

COMMENT ON FUNCTION public.suggest_nearby_communities(double precision, double precision, integer, text[], text[], boolean, integer) IS
  'Communities near her position (rounded to 0.1 deg on the device, else refused). Returns a distance_band, never km. Stores nothing.';

-- From a city she chose ("Choose a city").
CREATE OR REPLACE FUNCTION public.suggest_communities_in_city(
  p_city_id integer, p_radius_km integer DEFAULT 50,
  p_categories text[] DEFAULT NULL, p_meets text[] DEFAULT NULL,
  p_open_only boolean DEFAULT false, p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid, name text, slug text, description text, cover_image_url text, category text,
  is_private boolean, member_count integer, created_by uuid, created_at timestamptz,
  city_id integer, city_name text, meets text, distance_band text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public._community_suggestions(
    NULL, NULL, p_city_id, p_radius_km, p_categories, p_meets, p_open_only, p_limit);
$$;

COMMENT ON FUNCTION public.suggest_communities_in_city(integer, integer, text[], text[], boolean, integer) IS
  'Communities near a chosen city, banded from its centroid. Same filters as suggest_nearby_communities.';

-- ── 6. the city picker ─────────────────────────────────────────────────────
-- Prefix on lower(ascii_name) or the folded native name, the query folded the
-- same way, LIKE wildcards escaped.
CREATE OR REPLACE FUNCTION public.search_cities(p_q text)
RETURNS TABLE (id integer, name text, admin1 text, country_code text, population integer)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_q    text := public.fold_city_name(btrim(coalesce(p_q, '')));
  v_like text;
BEGIN
  -- POST only, like the suggestions: what she types is where she is looking.
  IF current_setting('request.method', true) = 'GET' THEN
    RAISE EXCEPTION 'call this with POST, never GET' USING ERRCODE = '0A000';
  END IF;
  IF char_length(v_q) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'search needs 2 to 60 characters' USING ERRCODE = '22023';
  END IF;
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN QUERY
  SELECT ci.id, ci.name, ci.admin1, ci.country_code::text, ci.population
  FROM public.cities ci
  WHERE lower(ci.ascii_name) LIKE v_like
     OR public.fold_city_name(ci.name) LIKE v_like
  ORDER BY ci.population DESC, ci.id
  LIMIT 10;
END $$;

COMMENT ON FUNCTION public.search_cities(text) IS
  'City picker: top 10 by population whose ASCII or folded native name starts with q (2..60 chars, accents folded).';

-- ── grants: members only ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.fold_city_name(text),
  public.haversine_km(double precision, double precision, double precision, double precision),
  public._community_suggestions(double precision, double precision, integer, integer, text[], text[], boolean, integer),
  public.suggest_nearby_communities(double precision, double precision, integer, text[], text[], boolean, integer),
  public.suggest_communities_in_city(integer, integer, text[], text[], boolean, integer),
  public.search_cities(text),
  public.set_community_location(uuid, integer, text)
FROM PUBLIC, anon;

-- The invoker chain runs as her, so she needs the helper and the internal too.
GRANT EXECUTE ON FUNCTION
  public.fold_city_name(text),
  public.haversine_km(double precision, double precision, double precision, double precision),
  public._community_suggestions(double precision, double precision, integer, integer, text[], text[], boolean, integer),
  public.suggest_nearby_communities(double precision, double precision, integer, text[], text[], boolean, integer),
  public.suggest_communities_in_city(integer, integer, text[], text[], boolean, integer),
  public.search_cities(text),
  public.set_community_location(uuid, integer, text)
TO authenticated;
