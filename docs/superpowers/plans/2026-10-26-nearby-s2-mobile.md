# Nearby communities — S2 mobile plan (Discover rail, nearby browser, filters, city picker)

Spec: `docs/superpowers/specs/2026-10-26-nearby-communities-design.md`. Backend: `2026-10-26-nearby-s1-backend.md`
(migration 139). Branch `slice/roxy/nearby-communities` (worktree `w3-d`). Scope: `apps/mobile` only (another lane
owns `apps/studio`; nobody touches `supabase/` here). Line it moves: retained revenue (her local community in week one).

## What the map says (read 2026-10-27)

- RPCs (139): `suggest_nearby_communities(p_lat, p_lng, p_radius_km, p_categories, p_meets, p_open_only, p_limit)`,
  `suggest_communities_in_city(p_city_id, …same)`, `search_cities(p_q)`. All refuse GET (`request.method`), so the
  client must use supabase-js `rpc()`'s default POST and never `{ get: true }`. Radius ∈ {10, 25, 50, 100, 1000};
  `p_meets` ⊆ {in_person, both} (asking for `online` is refused: online-only is never nearby); limit 1..50; lat/lng
  must already be at one decimal place. Rows: community columns + `city_id`, `city_name`, `meets`, `distance_band`.
- `lib/nearbyCoords.ts` (S1): `roundCoord`, `isRoundedCoord`, `distanceBandLabel`, `NEARBY_RADII_KM`.
- `expo-location` 17.0.1 is in `apps/mobile/package.json` + lockfile, **but not in the shared `node_modules`**
  (the junction points at the main checkout, which is on `main` without it). No installs here. So `lib/nearby.ts`
  loads it with a guarded `require` and a local structural type (the Daily.co pattern), which keeps tsc green now and
  works unchanged once the tree is installed. Web: expo-location's web module spreads our options over its
  defaults (`maximumAge: Infinity`), so we pass `maximumAge` explicitly.
  // src: https://github.com/expo/expo/blob/sdk-51/packages/expo-location/src/ExpoLocation.web.ts · 17.0.1 · 2026-10-27
- Strings: no i18n catalogue exists in the app; every screen uses inline sentence-case literals. Follow that.
- Analytics: `lib/analytics.ts` `Analytics.*` (Firebase + PostHog behind one helper). Add four methods there.
- On-device storage: AsyncStorage keyed per member (`roxy_welcome_in_seen:<id>`, `roxyFab`). `cacheFirst` expires
  in 24 h and is for rails, so nearby prefs get their own key `roxy.nearby.v1:<id>`, cleared on sign-out.
- `useRail` is module-private in `useDiscoverData.ts`, and four Discover screen suites mock that whole module. Move
  it to `components/discover/useRail.ts` (re-imported by `useDiscoverData`) so the nearby rail can reuse it.
- No member create-community path exists in the app (Studio only), so the empty state is copy plus "look farther".

## Files

New: `lib/nearby.ts`, `lib/nearbyFilters.ts`, `lib/nearbyPrefs.ts`, `store/nearbyStore.ts`,
`components/discover/useRail.ts`, `components/nearby/{NearbyPrompt,NearbyRows,NearbyRail,NearbyFilterSheet,
CityPickerSheet,ToggleChips,NearbyBrowser,useNearbyResults}.tsx|ts`.
Changed: `useDiscoverData.ts` (import useRail), `Rail.tsx` (optional `errorBody`), `V2Cards.tsx` (`CommunityRow`
optional `joinLabel`, `joinTestID`), `app/(tabs)/discover/index.tsx` (rail), `app/communities.tsx` (`?near=1`),
`lib/analytics.ts`, `store/authStore.ts` (forget prefs on sign-out), `CommunitiesScreen.test.tsx` (router mock).

## Behaviour

1. `getApproxPosition()`: permission asked only from a tap; `Accuracy.Lowest`; web `maximumAge` 5 min; a 15 s race
   → `timeout`; rounded with `roundCoord` before return; returns `{ok:true,lat,lng}` or `{ok:false,reason}`. Never
   logs or returns anything else. `hasLocationPermission()` reads without asking.
2. Store (memory only for the rounded pair): origin = rounded location | chosen city; `denied`; `locating`;
   `locationProblem`; filters. `load(userId)` reads prefs; if her last source was her location and the OS grant is
   still there, it locates silently (no prompt). `locateMe` (tap) / `chooseCity` / `setFilters` persist prefs
   (filters, city, source, denied — never coordinates) and fire analytics.
3. Rail "Near you" (shown wherever "Communities for you" is): prompt card (Use my location + Choose a city), denied
   (Choose a city only), skeleton rows, rows with band + city + members and Join / Ask to join (store's
   `joinCommunity`), empty, error + retry, "See all" → `/communities?near=1`.
4. Nearby browser: origin line + Change (city picker), Filters button, active filters as removable chips, the same
   states, 50 rows. Filter sheet: distance (10/25/50/100/"Anywhere in the country" = 1000), category (multi),
   meets (All / In person / In person and online — online-only cannot be nearby), who can join (All / Open to
   join); draft + "Show communities" + Reset.
5. City picker sheet: debounced (300 ms) `search_cities` from 2 characters, stale answers dropped, rows
   "City, Region, Country", "Use my location instead".
6. Analytics: `nearby_rail_viewed {mode}`, `nearby_location_requested {result}`, `nearby_city_chosen`,
   `nearby_filters_changed {radius, categories_count}`. No coordinates, no city, no ids.

## Tests first (jest), then code

`__tests__/lib/nearby.test.ts` (rounding before return, denied path, timeout, web maximumAge, rpc POST only, error
→ null, unrounded refused before the network, city search length rule, label), `nearbyFilters.test.ts`,
`nearbyPrefs.test.ts` (round trip, per member, corrupt → defaults, no coordinates on disk, clear),
`__tests__/store/nearbyStore.test.ts`, `__tests__/components/nearby/{NearbyRail,NearbyFilterSheet,CityPickerSheet,
NearbyBrowser}.test.tsx`, `__tests__/lib/nearbyAnalytics.test.ts`.
Gates from `apps/mobile`: `npx jest --ci` (baseline 390 suites / 4021 tests), `npx tsc --noEmit`, eslint on changed
files `--max-warnings 0`. No git writes, no installs, no export, nothing against production.

## Outcome (2026-10-27)

RED: 11 new suites failed on missing modules / `Analytics.nearby*` not a function; a second round (read-only
resume, double tap) failed 3 tests before the fix; the sign-out guard test was mutation-checked (fails without it).
GREEN: `npx jest --ci` 401 suites / 4129 tests (baseline 390 / 4021); `tsc --noEmit` 0; eslint 34 files, 0/0.
Calls made: rail title "Near you" above "Communities for you" (same visibility, no `discoverFilters` change);
meets = All / In person / In person and online; private rows say "Ask to join"; silent resume reads the grant
(`{ ask: false }`), never prompts, not counted; results never cached on disk; `nearby_rail_viewed` carries `mode`.
Shared edits are additive: `useRail` moved (+ superseded-answer guard), `Rail.errorBody`, `CommunityRow.joinLabel /
joinTestID`, `FilterChips` `multiple` (still one haptic call site). Rail.tsx, FilterChips.tsx and V2Cards.tsx keep
the stray `\r\r\n` HEAD already had (git stores them as non-text), so their diffs stay line-sized.

## Owner-gated / follow-ups

- Install the tree with `expo-location` (the shared `node_modules` lacks it) before any web export or APK.
- Empty state's "start one" action waits for a member create-community path (Studio only today).
