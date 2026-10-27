# Nearby communities — S1 backend plan (DB + loader + pure client helper)

Spec: `docs/superpowers/specs/2026-10-26-nearby-communities-design.md`. Branch `slice/roxy/nearby-communities`
(worktree `w3-d`). Line it moves: retained revenue (her local community in week one).
Out of scope here: Discover rail, Studio form, `expo-location` (not installed), `profiles.home_city_id`
(the Supporter slice adds it and references `cities.id`).

## What the map says (read 2026-10-26, local DB = PG 17.6)

- `communities`: table-level `INSERT, UPDATE` to `authenticated` (no column grants). Policies:
  `communities_insert_auth` (created_by = her, approved), `communities_update_own` (created_by = her),
  `communities_update_core` (is_roxy_core). So any new column is writable by the owner unless the grant
  changes. SELECT is table-level and the app reads `select('*')` (`communityStore.fetchAll`), so the new
  columns must stay readable or every Discover load turns into a 42501.
- Ownership: the owner is `communities.created_by`; `create_community` (132:939, SECURITY DEFINER) also
  makes her `community_members.role = 'admin'`. `is_community_moderator(cid)` = approved AND role in
  (owner, admin, moderator). Staff = `is_roxy_staff()` (profiles.is_staff). Bans: `community_bans` +
  `is_banned_from_community(c, u)` (active ban). Blocks: `blocked_pair(a, b)`.
- No PostGIS/earthdistance/unaccent. No `pg` driver in node_modules and no `psql` on the host.

## Migration 139

1. `public.cities` (id int PK = GeoNames geonameid, name, ascii_name, admin1, country_code char(2),
   lat, lng, population) with CHECKs on every field. RLS on; one SELECT policy TO authenticated;
   `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT TO authenticated` (service_role keeps
   its default grant). Index `(lower(ascii_name) text_pattern_ops, population DESC)`.
2. `communities` + `city_id int REFERENCES cities ON DELETE SET NULL`, `meets text NOT NULL DEFAULT
   'online' CHECK in (online, in_person, both)`, `lat`, `lng`. CHECK: lat/lng null exactly when city_id
   is null. BEFORE INSERT OR UPDATE OF city_id, lat, lng trigger ALWAYS recomputes lat/lng from the city
   (rounded to 2 dp), so nobody (not even definer code) can store a point that is not a city centroid.
   AFTER UPDATE OF lat, lng on `cities` re-points its communities, so a reload keeps them in step.
   Indexes: `(city_id)` partial, `(lat, lng)` partial where located and not online-only.
3. Writes: replace the table-level `INSERT, UPDATE` grant to authenticated with column grants on the
   ten existing columns (same rights as before for every old column; none on the four new ones). A
   direct `UPDATE … SET lat/city_id/meets` is then 42501.
4. `set_community_location(p_community_id, p_city_id, p_meets)` SECURITY DEFINER: signed in; meets in
   the three; in_person/both need a city; city must exist; caller = owner (created_by, approved) or
   `is_community_moderator` or `is_roxy_staff`. Returns the community row.
   **create_community stays untouched.** Studio calls `set_community_location` right after create: an
   overload with extra defaulted args makes PostgREST ambiguous (PGRST203), and a failed second call
   leaves the safe default (`meets = 'online'`, never nearby).
5. `haversine_km(lat1, lng1, lat2, lng2)` IMMUTABLE SQL (R = 6371.0088).
6. `_community_suggestions(p_lat, p_lng, p_city_id, filters…)` — the one query, SECURITY INVOKER, STABLE.
   Origin is either raw coordinates (must be rounded to 1 dp) or a city id (its centroid). Validates
   radius in (10, 25, 50, 100, 1000), categories in the four, meets in (in_person, both) — online-only
   is never nearby, so asking for it is a client bug and is refused — limit 1..50. Bounding box
   (latitude band; longitude band from asin(sin δ / cos φ), skipped near a pole, split across the
   antimeridian) then haversine. Excludes: no location, meets = online, joined, actively banned,
   creator blocked either way; RLS decides the rest (private stays hidden unless invited / core).
   Returns community columns `CommunityRow` needs + `city_name`, `meets`, `distance_band` (never km).
   Errors never echo her coordinates.
7. Wrappers (SECURITY INVOKER, STABLE, `SET search_path`, EXECUTE to authenticated only):
   `suggest_nearby_communities(p_lat, p_lng, p_radius_km, p_categories, p_meets, p_open_only, p_limit)`
   and `suggest_communities_in_city(p_city_id, …same)`. The internal is executable by authenticated
   (an invoker chain needs it) but enforces the same rounding rule, so calling it directly gains nothing.
8. `search_cities(p_q)`: trimmed length 2..60, folded by `fold_city_name` (lower + translate() of
   common Latin accents: ñ → n, so "Parañaque" finds GeoNames' ascii "Paranaque"), LIKE-escaped prefix on
   lower(ascii_name) OR the folded native name (GeoNames spells Zürich's ascii name "Zuerich", so
   "zurich" needs the second index), top 10 by population.

Down `supabase/downs/139_nearby_communities_down.sql`: drop functions, triggers, indexes, constraints,
columns, `cities`; revoke the column grants and restore the table-level `INSERT, UPDATE`.

## Proof (TDD, local Docker DB only, rolled back)

Check file `supabase/tests/139_nearby_communities_check.sql` first, run against the bare DB (fails: no
cities), then against the migration. Tests: shape/RLS/grants; bands for seeded test cities; unrounded
coords + bad radius/limit/meets/category refused; online-only, joined, banned, private (not invited),
blocked excluded; in-city path; search_cities prefix/accent/limits; set_community_location non-owner
refused, owner + staff allowed, in-person without a city refused; direct writes of lat/lng/city_id/meets
refused and re-read unchanged; the trigger overrides spoofed lat/lng; city delete nulls the location;
city move re-points; CHECKs reject bad meets and a half location; RPC bodies contain no
INSERT/UPDATE/DELETE and are INVOKER + STABLE; anon refused.
Runs: `migration-proof.cjs` GREEN, `--cycle public.cities`, `exact-down-cycle.cjs`, one RED `--mutate`
(drop the rounding check → its test fails), `check-migrations.mjs`.

## Loader `scripts/load-cities.mjs`

No driver is installed and installs are off-limits, so it carries a minimal Postgres wire client
(startup, SCRAM-SHA-256 / md5 / cleartext, SSLRequest for non-local, simple query) — the SCRAM proof is
unit-tested against the RFC 7677 vector. Reads cities15000.txt (columns 0,1,2,4,5,8,10,14), optional
`--admin1=admin1CodesASCII.txt` for region names, validates every field (untrusted), batches of 1000
`INSERT … ON CONFLICT (id) DO UPDATE … WHERE IS DISTINCT FROM`, one transaction; `--rollback` rolls it
back after counting. Refuses a non-local URL without `--confirm-ref=<ref>` that the URL contains.
Tests: `scripts/__tests__/load-cities.test.mjs` (`node --test`). Local run only, rolled back.

## After review (independent reviewer, 2026-10-26)

- The location reads refuse `request.method IN ('GET', 'HEAD')` (PostgREST v14 sets it), because a GET
  or HEAD puts her position or her city search in a URL that the gateway logs. The client must call them with POST
  (supabase-js `rpc()` default, never `{ get: true }`). Check T14.
- `set_community_location` checks who is calling before it looks at the row, so a stranger cannot
  tell a missing community from a private one, and cannot lock it.
- `CHECK (meets = 'online' OR city_id IS NOT NULL)`. If a city is deleted, the trigger moves its
  communities back to online.
- Loader: away from localhost, the password goes only over SCRAM. A server that skips its SCRAM proof
  is refused. `?sslrootcert=` turns on verify-full.

## Client `apps/mobile/lib/nearbyCoords.ts`

`roundCoord`, `isRoundedCoord`, `DISTANCE_BANDS`, `distanceBandLabel`, `NEARBY_RADII_KM`, `isNearbyRadius`.
Jest first: `__tests__/lib/nearbyCoords.test.ts`. Gates: full `npx jest --ci`, `npx tsc --noEmit`,
eslint on changed files.
