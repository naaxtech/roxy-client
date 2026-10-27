# Nearby communities — design

Owner, 2026-10-26: "User should be able to get suggestions from communities nearby if their location GPS is
turned on, then also, by filter."
Line it moves: **retained revenue**. A member who finds her local community in week one stays. Local
communities also carry the in-person events where Studio hosts charge for tickets.
Branch `slice/roxy/nearby-communities` (worktree `roxy-client-worktrees/w3-d`).

## What exists (map, 2026-10-26)

- No location data on communities: `003_communities_social.sql` has `category` (identity | interest |
  location | support) and no city or coordinates. No PostGIS, earthdistance or cube; only `pgcrypto`.
- `profiles.location_city/country` exist but nothing writes them and they are not public (`130:187`).
- No `expo-location`, no permission strings in `app.json`. `expo-localization` is installed but unused.
- Discover's "Communities for you" rail shows 3 communities by member count (`discover/index.tsx:184`).
  Search matches community name only.
- Reusable: `Rail` (title, status, retry, See all, filters slot), `FilterChips`, `discoverFilters.ts`,
  `CommunityRow`, `Sheet`, `ChipSelector`, `useRail`.

## Safety first (the rules this design is built around)

A location leak can out a member. So:

1. **Her position is never stored and never logged.** The device rounds it to 0.1° (about 11 km) before it
   leaves the phone. The rounded value goes only into a single RPC call, and nothing writes it to a table.
   Analytics records "nearby used" plus the radius chosen, never coordinates or city.
2. **Permission is asked in context, never at launch.** She taps "Use my location" on the Nearby rail. The
   app requests **coarse** location only: Android `ACCESS_COARSE_LOCATION` (fine and background are in
   `blockedPermissions`), iOS when-in-use with `NSLocationDefaultAccuracyReduced` so the prompt offers
   approximate location with Precise off. If she refuses, the rail offers "Choose a city" instead and
   asks no more: the city picker drops "Use my location instead" and, on a phone, offers only "Turn on
   location in Settings" (`Linking.openSettings`, which asks nothing; the web offers nothing). The grant
   is re-read (never requested) on load and when the app returns to the foreground, so turning it on in
   Settings brings "Use my location" back; nothing is located until she taps it.
   - Nothing she did not tap may put a dialog on screen. The silent resume passes
     `mayShowUserSettingsDialog: false` (expo-location 17 defaults it to true on Android and would open the
     system "turn on device location" dialog by itself); her own tap may show it.
   - An ignored browser prompt is bounded (20 s on the web) and ends as "took too long", never as a rail
     that loads forever.
3. **A community's location is its owner's choice, at city level.** It is a city centroid, not an address.
   Online-only communities have no location and never appear as "nearby".
4. Ghost mode is unaffected. She is looking, not being shown.
5. No session replay is live today; any future replay plugin must mask the Nearby views (the rail, the
   browser, the city picker and the filter sheet), because what is on them says where she is.

## Design

**Data (migration 139; 137 = notifications, 138 = Archive search):**
- `cities` reference table: `id`, `name`, `ascii_name`, `admin1`, `country_code`, `lat`, `lng`,
  `population`. Read-only to members; RLS on, SELECT to `authenticated`. Seeded from GeoNames
  `cities15000` (CC-BY 4.0) by a loader script, not inside the migration. The credit "City data ©
  GeoNames (CC BY 4.0)" is on the city picker. The app has no About/licences screen yet; when one ships,
  the same line goes there too.
- `communities` gets these columns:
  - `city_id → cities` (nullable)
  - `meets` text CHECK in (`online`, `in_person`, `both`), default `online`
  - `lat`, `lng`, copied from the city by a trigger, so the query never joins
- RPC `suggest_nearby_communities(p_lat, p_lng, p_radius_km, p_categories text[], p_meets text[],
  p_open_only bool, p_limit int)`:
  - `SECURITY INVOKER`, so visibility RLS still decides what she can see;
  - POST only: GET and HEAD are refused, since either puts her position in a URL the gateway logs (the
    same for the in-city RPC and `search_cities`);
  - rejects coordinates that are not rounded to one decimal place;
  - bounding-box prefilter, then haversine;
  - returns the community row plus a **distance band** (`under_10`, `under_25`, `under_50`, `under_100`,
    `farther`), never raw kilometres;
  - excludes communities she has joined, is banned from, or that block her.
- RPC `suggest_communities_in_city(p_city_id, …same filters)` for the "Choose a city" path.
- `search_cities(p_q)` for the city picker: prefix match on `ascii_name`, ordered by population, limit 10.

**Client:**
- `lib/nearby.ts` reads the device position:
  - native: `expo-location` `getCurrentPositionAsync({ accuracy: Lowest })`;
  - web: `navigator.geolocation` with `enableHighAccuracy: false`.
  - It rounds on the device, so the rounding is unit-tested.
- Discover gets a **Near you** rail:
  - With no location and no city chosen, it shows a prompt card with "Use my location" and "Choose a city".
  - Otherwise it shows rows with a distance band ("Within 10 km") and Join / Request.
  - "See all" opens `/communities?near=1` with the filter sheet.
- **Filters** (Sheet + chips):
  - distance: 10 / 25 / 50 / 100 / 1,000 km (the widest says its number: a 1000 km circle is not "anywhere
    in the country");
  - category: the four categories;
  - meets: in person / online / both;
  - open to join vs request.
  - The last-used filters and the chosen city are remembered on the device only, never on the server.
- **Studio:** create-community gains City (autocomplete via `search_cities`) and Meets. A new
  "Edit community" form lets owners set them on existing communities. Without it the rail would be empty
  at launch.
- Strings are localised; light theme tokens; loading, empty and error states. Members cannot create a
  community in the app (Studio does), so the empty state names only what she can do: "No communities near
  you yet. Try a wider distance or another city." with "Widen to <next distance>" and "Choose a city"
  (with filters on: "Clear filters", which keeps her distance; at 1,000 km: another city only).

**Emotional-AI value:** which community kinds members look for near them (category and meets, joined
from Nearby or not). This is aggregate behaviour with no location attached.

## Owner-gated

- Install `expo-location` (native module → **new APK build**).
- Apply 139 to prod.
- Load the GeoNames cities into prod.
- Set city and meets on the existing communities (Studio form, or staff do it).
- Deploy.

## Depends on Supporter

"Join a community from anywhere" (Supporter perk) restricts free members somewhere. See the Supporter spec.
That restriction, if any, is enforced in the join RPC/policy, not here. Nearby only suggests.

## Tests

- jest: rounding, the permission-denied path, the rail's states, filter reducers.
- SQL check file: bands correct; unrounded coordinates rejected; private, banned and blocked communities
  excluded; no table write anywhere receives her coordinates (assert `pg_stat_statements`-free: grep the
  RPC body for INSERT/UPDATE); anon refused.
- e2e (read-only, `apps/mobile/tests/e2e/nearby.spec.ts`): Discover with geolocation granted (Playwright
  `geolocation` + `permissions`) settles into rows or the empty state and sends only the rounded pair by
  POST; not granted ends on "Choose a city" with no position sent. Never against production.
