# Session 21 — Full 5-Tab Visual Revamp Plan

> **For agentic workers:** execute inline task-by-task; QA loop (eslint 0 · tsc · jest · web export) before PR; redeploy `npx eas-cli deploy --prod` (Nicole pre-approved going live this session).

**Goal:** One coherent, modern design language across Grow, Connect, Play, Messages, Build — guided by ui-ux-pro-max (vibrant style direction; accessibility/touch/contrast checklist), keeping ALL logic, stores, routes, and testIDs unchanged. Visual-layer edits only.

**Trigger:** Nicole: "revamp every Menu: Grow, Connect, Play, Messages, Build". She also could not find the communities browser → discoverability is part of this.

## Design language (from ui-ux-pro-max run + Roxy brand)

- **Palette:** existing theme tokens only (`useThemeColors`); brand gradient `#FF6A2E→#FF2F71→#E81C8E` for hero/CTA accents. No new hex outside tokens+gradient.
- **Header idiom** (every tab): eyebrow (11px, uppercase, muted, letterSpacing 1) + 26px/800 title, right-side round 38px icon buttons on `surface`. Play already does this — propagate.
- **Section idiom:** 15px/800 title + optional Ionicons accent + "All →" link in `roxy` color. 20px horizontal padding rhythm.
- **Cards:** radius 18, `surface` bg, soft shadow (opacity 0.06, radius 10), 14–16 padding.
- **Segments/subtabs:** pill segment control (Build-style) for segments; underline subtabs (Connect-style) for feeds. Keep per-tab as-is, restyle consistently: active = `roxy`, 700 weight.
- **No emoji-as-icon in chrome** (Ionicons instead); emoji stays in *content* (posts, badges, brand 🌸 like-button — brand identity, keep).
- **Touch targets ≥44px; every icon button accessibilityLabel; loading/empty states styled with shared EmptyState.**

## Tasks

1. **Shared primitives** (`components/ui/`): `ScreenHeader.tsx` (eyebrow/title/actions), `SectionHeader.tsx` (title/icon/link), `EmptyState.tsx` (emoji/title/body/CTA). Small, prop-driven, theme-aware.
2. **Connect** — adopt ScreenHeader ("Your communities" eyebrow); **replace compass icon with a labeled "Browse" pill button** (fixes discoverability); restyle subtabs + event cards + rooms sections with SectionHeader; EmptyState everywhere.
3. **Grow** — adopt SectionHeader for all zones; card polish (radius/shadow rhythm); keep handoff layout (already close).
4. **Play** — SectionHeader adoption; "Make a game" placeholder removed/kept? (keep header browse → /communities); polish live-room rows.
5. **Messages** — ScreenHeader adoption ("Your people" eyebrow); restyle Roxy pinned row with gradient border accent; EmptyState.
6. **Build** — ScreenHeader ("The WLW economy" eyebrow); pill segment restyle; business/marketplace card polish (cover radius, WLW badge chip, price chips); EmptyState.
7. **QA loop** (eslint 0 · tsc · jest 329+ · expo web export) + Playwright screenshots of all 5 tabs, light theme check.
8. **PR + merge (pre-approved) + `expo export` + `eas deploy --prod` + verify roxy.expo.app.**

## Constraints

- Do NOT touch: stores, supabase queries, edge functions, routes, testIDs, business logic.
- One tab per commit. If context compacts mid-way: this file + `.claude/log.md` carry state; continue from the last committed tab.

## Session 22+ queue (Nicole rapid-fire, 2026-07-18 — keep until all done)
- [x] Communities = 4th Connect subtab + suggestion rail + /communities redirect
- [x] Community detail Posts → shared FeedCard pipeline
- [x] Admin-only Connect feed (community_members role admin/moderator pairs, client filter) + search on Connect subtabs + Play games search
- [x] Community event cards tappable → /event/[id]; EventsCalendar component + list/calendar toggle in Connect Events AND community Events
- [ ] #13 Join Game buttons on roxy_link feed posts must join the game (GAME_ROUTES / speed-dating)
- [ ] #15 Author avatars/names in FeedCard/StaticPostCard/comments → /user/[userId]
- [ ] #14 Play: dedupe games (one tile per game, community tags); Speed Dating open → options: Join random ("feeling wild") vs pick one of your communities
- [ ] #12 Room cards next-level: migration 059 community_rooms.banner_url + room-banners bucket; CommunityRoomCard redesign (banner cover/gradient fallback, veil, live pill, host+count); Play Live-now rows same treatment; Studio RoomModal banner upload
- [ ] #11 Comprehensive Playwright button test across all tabs; fix breaks; QA loop; deploy to roxy.expo.app
