# Changelog

All notable changes to the Roxy client (`apps/mobile`) are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project uses [Semantic Versioning](https://semver.org/).

**Versioning policy:** the app version lives in `apps/mobile/package.json` and
`apps/mobile/app.json` (kept in sync). Bump **MINOR** for user-facing features,
**PATCH** for fixes, **MAJOR** for breaking changes to data contracts or the
module contract. Every release adds a dated section below. A running,
finer-grained engineering log lives in `.claude/log.md`.

## [Unreleased]

### Planned
- Architecture documentation with data-flow / tenancy / module-boundary diagrams.
- Scale hardening: de-duplicate the Grow screen's repeated `questions_of_the_day` /
  `community_rooms` fetches (observed ~10× per load), feed pagination review,
  realtime channel budgets for high-concurrency content.
- Seed marketplace products so the storefront checkout path can be exercised
  end-to-end (currently code-reviewed, not live-tested — no products in the DB).
- `EXPO_PUBLIC_GIPHY_API_KEY` in the app + EAS env to enable GIF search in chat.

## [1.1.0] - 2026-07-21 — Sellable-state push

The push to get the WLW community platform to a sellable state: coherent 5-tab
IA (Grow · Connect · Play · Messages · Build), a real commerce storefront,
donations, video/audio rooms, a content feed, and a top-to-bottom visual and
responsiveness pass. Delivered across web (EAS Hosting, https://roxy.expo.app).

### Added
- **Marketplace storefront** — full-screen `/business/[id]` shop and
  `/product/[id]` detail routes (replacing the old popups): seller hero with
  verified-WLW badge, Shop/About/Photos/Policies tabs, product grid, cart bar,
  variant picker, stock-aware quantity, add-to-cart / buy-now, and honest
  international-commerce policy rows. International currency formatting
  (`lib/currency.formatMoney`) across every price; order surfaces render in the
  order's own currency.
- **Donations** — monthly / yearly / one-time support via Stripe Checkout
  ($20 default, $5 floor), surfaced on Grow and Build. Never labeled
  "subscribe."
- **Community video & audio rooms** — Daily.co-backed live rooms with host
  controls, participant grid, and a graceful native-only screen on web.
- **Speed dating** — community-scoped 5-minute matchmaking with membership
  guards and per-pool matching.
- **Content feed v2** — photo and video posts, a shared post-card renderer,
  reactions, saves/bookmarks, comments, and a global search.
- **Login streaks** and a **notifications center**.
- **Roxy companion FAB** — R-mark button with quick actions (chat, search,
  filter-this-view) and long-press to chat.
- **Profile** — Bumble-style avatar over cover, badge chips, pronoun/orientation
  tints, government-verified badge, Saved posts and Saved businesses rails.
- **Desktop web frame** — centered phone-width column (Instagram/Bumble
  pattern) with the app fully responsive from 390px to desktop.

### Changed
- **Vector icons replace emoji** as UI chrome across the app (brand rule);
  emoji remain only inside user-typed content.
- **House pop animation** (spring scale + opacity, instant backdrop) on all
  ~18 modal surfaces — no soft fades, no slide-up drawers.
- **Grow** redesigned with gradient icon plates, a brand-gradient Journey
  progress bar, and per-quest Mini-Wins; **Sister** support screen revamped
  into its own calm lavender identity.
- Community, room, and call screens are **root-level routes** so back
  navigation always returns to the origin tab.
- Chat reactions moved from a hidden long-press to a **visible react button**;
  Enter sends messages on web (Shift+Enter for newline).

### Fixed
- **Photo/avatar upload** — was denied by storage RLS (root path vs required
  `${uid}/` folder); photo posts silently dropped their images. Both fixed and
  verified live.
- **Likes / saves / comment-likes** silently failed (engagement tables lacked a
  `user_id` default → RLS rejected inserts) — migration 062 adds
  `DEFAULT auth.uid()`.
- **Web responsiveness** — 7 screens captured window size once at load and never
  adapted; all now track live dimensions.
- Community "back" no longer hijacks the Play tab; stale call screens no longer
  strand on the Connect tab; web room-join no longer errors.
- Modal close buttons unclickable on web (z-index); marketplace prices no
  longer hardcode `$`.

### Security
- Row-Level Security confirmed enabled on **all 61 tables**.
- Every edge function is guarded — user-facing via JWT, webhooks via signature
  verification, money-movement (`release-payout`, `process-refunds`) via
  service-role key.

## [1.0.0] - baseline

Pre-existing foundation prior to the sellable-state push: authentication and
onboarding, tenancy/profiles, communities and friendships, the initial Build
directory and marketplace backend (Stripe Connect, orders, products), Roxy AI
touchpoints, and the Supabase schema (migrations 001–061). See `.claude/log.md`
for the full pre-1.1.0 engineering history.
