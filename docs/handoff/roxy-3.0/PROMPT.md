# PROMPT — paste this into Claude Code at the root of `naaxtech/roxy-client`

---

You are implementing the **Roxy 3.0 redesign** in this repository, on a new branch. The design is finalized and attached as an interactive HTML prototype in `docs/handoff/roxy-3.0/` (added by this branch's first commit — see "Inputs" below). Your job is to recreate that design in the existing Expo/React Native app — not to invent a new one and not to ship the HTML.

## Ground rules

1. Create branch `redesign/roxy-3.0` off `main`. Never commit to `main`.
2. Before writing any code, read in this order: root `CLAUDE.md`, `docs/ARCHITECTURE.md`, `.claude/decisions.md`, `.claude/mistakes.md`, then `apps/mobile/lib/theme.ts`, `apps/mobile/store/themeStore.ts`, `apps/mobile/app/(tabs)/_layout.tsx`. Follow every convention you find there (stores, edge-function calls, analytics, test patterns).
3. Open `docs/handoff/roxy-3.0/Roxy App.dc.html` in a browser. It is the **source of truth** for layout, spacing, copy, colors, motion and navigation. `README.md` beside it holds the token table and per-screen spec.
4. **Feature parity is non-negotiable.** Nothing from the current build is deleted — only moved or merged. The migration map below says where everything goes. If something isn't listed, ask before removing it.
5. Work in the phases below. One commit per completed step, conventional-commit messages, `npm test` green before each commit. Update existing tests that reference moved screens rather than deleting them.
6. Keep Supabase schemas, stores and lib functions; this is a **navigation + UI restructure**, not a backend rewrite. Extend stores only where the spec needs new state (e.g. seller status, saved posts).

## The new information architecture

Five tabs collapse to four + a create action. Rebuild `apps/mobile/app/(tabs)/_layout.tsx` accordingly:

| New tab | Replaces | Route |
|---|---|---|
| **Feed** — vertical snap pager, segments For You / Following / Communities, Now rail, streak chip | Connect feed + parts of Grow | `(tabs)/feed/` |
| **Discover** — search-first, Netflix-style rails: hero, Top 10, Live now, Events (Online/In-person), WLW economy (Saved / WLW-only / Impact / Support filters), Communities, Games | Play + Build directory + Connect browse | `(tabs)/discover/` (restructure existing) |
| **＋ Create** — center action, opens sheet: Post / Event / Room / Product (seller-gated) / Game | new | modal, not a tab screen |
| **Messages** — Roxy pinned, Sister pinned, request-first inbox, DMs, community channel chats | Messages + Sister entry | `(tabs)/messages/` |
| **You** — unified profile shell (self variant) + streak, Mini Wins, tickets & orders wallet, saved, Sell on Roxy, settings | Profile + Grow ritual content | `(tabs)/you/` |

Dissolved surfaces — where their content goes:
- **Grow** → streak chip + first-open-of-day Mini Wins sheet (Feed), Mini Wins card + badges (You), Happening Now → Now rail (Feed header). Reuse `components/grow/MiniWinsCard.tsx` logic; `lib/streaks.ts` unchanged.
- **Connect** → Feed "Communities" segment + Discover rails. Delete the Connect tab folder only after its screens are re-homed.
- **Play** → Discover Games rail + community profile Games tab. `store/gamesStore.ts` unchanged.
- **Build** → Discover "WLW economy" rail with Impact/Support as filter chips; businesses become seller profiles/shops. Keep `store/buildStore.ts`, `store/marketplaceStore.ts`, `components/build/*` (CartDrawer, CheckoutSheet, Order sheets get restyled, not rewritten).
- **Roxy FAB** (`components/ui/RoxyCompanionButton.tsx`) → visible on Feed, Discover, You; suppressed in Messages and live rooms.

## Phases

**Phase 0 — scaffolding.** Commit the handoff folder to `docs/handoff/roxy-3.0/`. Extend `lib/theme.ts` with the 3.0 token set (below) for BOTH dark and light; wire through the existing `themeStore` + `useThemeColors`. Add the two fonts via `expo-font`: Outfit (display, 600–800) and Figtree (text, 400–700).

**Phase 1 — tab bar + Feed.** New `(tabs)/_layout.tsx` (4 tabs + gradient ＋ button). Feed = full-bleed vertical pager (`FlatList` with `pagingEnabled` + `snapToInterval`, or `react-native-pager-view` vertical) with three renderers reusing `components/feed/VideoPostCard`, `PostMediaCarousel`, `StaticPostCard` restyled to the prototype: right action rail (✿ react via `hooks/useReactions`, comment → `CommentSheet`, share, save, ⋯ long-press safety sheet), bottom-left author chip + community attribution (both navigate to profile — this is the core discovery loop), content-warning blur with tap-to-reveal, streak chip, Now rail, For You / Following / Communities segments backed by `store/feedStore.ts`.

**Phase 2 — unified profile shell.** One component (grow `components/profile/ProfileCard.tsx` into it) rendering user / seller / community / self from the same shell: cover, avatar (+ level badge), pronouns + identity + status chips, stat row, primary action (Message·Follow / Join / Edit), tabs rendered **only when populated**: Posts / Shop / Events / Rooms / Games / About / Saved(self). Routes `app/user/[userId].tsx` and `app/community/[id].tsx` both use it. Self variant adds: Dating-mode + Ghost-mode toggles (two taps from anywhere — reuse `store/safetyStore.ts`), Mini Wins card, Tickets & orders, Saved, Sell on Roxy.

**Phase 3 — Discover.** Restructure `(tabs)/discover/` to the rail layout in the prototype (hero, Top 10 with stroked rank numerals, Live now, Events with Online/In-person chips, WLW economy with Saved/WLW-only/Impact/Support chips, Communities, Games). Global search overlay (reuse `app/search.tsx` + `lib/globalSearch.ts`) with entity tabs and content-forward empty states.

**Phase 4 — Messages + AI.** Inbox with pinned Roxy (warm, gradient ring) and Sister (cool lavender, quieter type, no gamification) — visually distinct at a glance; request-first inbox honoring the Friends/Requests/Sent model in `store/friendStore.ts`; community channel chats (#general / #meetups-events / #buy-sell-trade + live stage chip) on the existing realtime plumbing (`hooks/useRealtime`, `useTyping`, `components/chat/*`).

**Phase 5 — events, rooms, commerce.** One event object, two modes with unmistakable badges (IN PERSON pink / ONLINE lilac): detail sheets per prototype, RSVP → ticket in wallet (`components/TicketCard.tsx`), online RSVP → reminder → card flips to Join at start. Audio room (raise hand, leave-quietly, report) and Speed Dating (5:00 timer, flower-or-pass, consent strip always visible: End · Report · Block · Leave quietly) on the existing `lib/video/DailyProvider`. Product sheet → 3-step checkout (reuse `CheckoutSheet` + `lib/stripe.ts`) → order timeline in wallet. Seller state machine: not applied → in review → approved (approved unlocks Shop tab + shoppable post tags + Product in create sheet).

**Phase 6 — settings, safety, polish.** Settings & safety screen per prototype (appearance dark/light must actually switch — it already half-exists in `themeStore`), DM permissions, blocked list, Export data / Delete account kept reachable, Feedback & Ideas sheet. Sweep: every icon-only control gets an accessibility label, touch targets ≥44pt, LIVE pills always dot + word, gradient reserved for live/urgent only.

## Design tokens (must match the prototype exactly)

Dark: bg `#14082A`, bg2 `#1A0A2E`, surface `#211039`, elevated `#2D1B4E`, line `#3D2B5E`, text `#F7F3FC` / `#C6B5E4` / `#9C89C2`, pink `#F22481` (text-on-dark accent `#FF7AB5`), lilac `#A78BFA`, gold `#F5B73D`, success `#2FC97E`, sister `#8E9BFF`.
Light: bg `#FAF2F6`, surface `#FFFDFE`, elevated `#F6EAF2`, line `#EBDAE7`, text `#241234` / `#5D4980` / `#8672A8`, pink `#D81368`, lilac `#7C5CE0`, sister `#6474E8`.
Brand gradient (logo, ＋ button, FAB): `linear-gradient(120°, #FF5A2E → #F22481 → #E0189A)`. Live gradient: `#FF5C3D → #F22481`. Never pure #000/#FFF. Radii 10–26px; sheets 26px top radius; motion 160–320ms with `cubic-bezier(.32,.72,0,1)` for sheets.

## Where to degrade gracefully (don't block the branch)

- Vertical pager 120fps polish, blurred letterbox on photos → `expo-blur` if cheap, flat dark otherwise.
- Voxel/pixel avatar editor → ship the frame + identity editor first; pixel-art renderer can be a follow-up.
- Speed Dating matchmaking backend → UI + Daily room wiring with a stub queue is acceptable.
- Netflix rank numerals text-stroke → use `react-native-svg` text or skip the stroke on Android if it fights you.

## Definition of done

Maestro smoke flows updated and passing; `npm test` green; every §migration row reachable in ≤2 taps from its new home; no screen with more than 2 visible navigation levels; dark AND light verified on a 412×915 viewport; a `docs/sessions/` note summarizing what moved where. Open a PR titled "Roxy 3.0 — flattened IA, TikTok feed, unified profile" with before/after screenshots.

## Inputs

- `docs/handoff/roxy-3.0/Roxy App.dc.html` — interactive prototype (open in any browser; the rail on the left jumps to every screen; ◐ toggles light/dark)
- `docs/handoff/roxy-3.0/README.md` — token table + per-screen spec
- `docs/handoff/roxy-3.0/assets/roxy-logos/` — brand marks (repo already has these in `apps/mobile/assets/brand/`)

Start with Phase 0 and show me the branch + theme diff before proceeding.
