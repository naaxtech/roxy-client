# Handoff: Roxy 3.0 Redesign

## Overview
Full redesign of the Roxy WLW community app: five nested tabs collapse to **Feed / Discover / ＋ / Messages / You**, the feed becomes a TikTok-style vertical pager with three renderers (video, photo carousel, text prompt), user and community profiles unify into one shell, commerce moves to approved-seller shops, and Roxy (wingwoman) + Sister (private vent space) are pinned, visually distinct AI personas. Dark and light themes ship together.

## About the design files
`Roxy App.dc.html` is a **design reference built in HTML** — an interactive prototype showing intended look and behavior. It is not production code. The task is to recreate it inside the existing **React Native + Expo (expo-router)** codebase at `apps/mobile/`, reusing its stores, hooks and components. `PROMPT.md` in this folder is a paste-ready brief for Claude Code that maps every design decision to real repo paths.

## Fidelity
**High-fidelity.** Colors, type, spacing, copy, motion and flows are final. Recreate pixel-perfectly with the codebase's patterns (theme via `lib/theme.ts` + `useThemeColors`, state via zustand stores).

## How to explore the prototype
Open the HTML in a browser. Left rail jumps to every screen/sheet; ◐ toggles dark/light. Everything navigates: author chips → profiles, community attribution → community, shop tags → product sheet → checkout → order in wallet, RSVP → ticket, streak chip → Mini Wins, long-press a feed post → safety sheet.

## Design tokens
| Role | Dark | Light |
|---|---|---|
| Background | `#14082A` / `#1A0A2E` | `#FAF2F6` |
| Surface / elevated | `#211039` / `#2D1B4E` | `#FFFDFE` / `#F6EAF2` |
| Stroke | `#3D2B5E` (strong `#55407F`) | `#EBDAE7` (strong `#D9C2D6`) |
| Text 1/2/3 | `#F7F3FC` / `#C6B5E4` / `#9C89C2` | `#241234` / `#5D4980` / `#8672A8` |
| Primary pink (action) | `#F22481` · accent text `#FF7AB5` | `#D81368` |
| Lilac secondary (non-romantic UI) | `#A78BFA` | `#7C5CE0` |
| Success / gold / sister | `#2FC97E` / `#F5B73D` / `#8E9BFF` | `#178A4C` / `#B07A10` / `#6474E8` |
| Brand gradient | `120° #FF5A2E → #F22481 → #E0189A` (logo, ＋, FAB) | same |
| Live gradient | `#FF5C3D → #F22481` — **live/urgent states only** | same |

Type: **Outfit** 600–800 (display: titles, numbers, wordmark contexts) + **Figtree** 400–700 (UI text). Feed body 13px, section titles 14.5–21px, min UI text 10px in mock = use RN scale equivalents; touch targets ≥44pt. Radii: chips 999, cards 15–18, sheets 26 top. Motion: 160–220ms standard, sheets 320ms `cubic-bezier(.32,.72,0,1)`, live pulse 1.4s, reaction burst 320ms.

## Screens (all present in the prototype)
Feed (3 renderers, right action rail with ✿ flower react, CW blur, Now rail, segments, streak chip) · Comments sheet · Long-press safety sheet · Create sheet (Post/Event/Room/Product 🔒/Game) · Discover (hero, Top 10 rank rail, Live now, Events with Online/In-person chips, WLW economy with Saved/WLW-only/Impact/Support chips, Communities, Games) · Search overlay (entity tabs, trending, content-forward empty state) · Unified profile: self / seller (Shop tab) / community (Rooms · Events · Games · About, LIVE pill) · Product detail sheet · Checkout (3 steps) · Event detail (in-person ticketed w/ tiers + safety line; online with RSVP → reminder → Join flip) · Tickets & orders wallet (QR, transfer, cancel, status timeline) · Audio room (speakers/listeners, raise hand, leave quietly, report) · Speed Dating (5:00 timer, flower-or-pass, persistent consent strip) · Messages (Roxy + Sister pinned, requests, DMs, community channels) · Roxy chat (chips: Dating advice / Her texts / Confidence tips / Queer events, voice input) · Sister chat (quieter: lavender, more whitespace, no gamification) · Mini Wins daily sheet (streak mitigation for removed Grow tab) · Avatar studio (skin/hair/outfit/frame + pronouns/identity/status) · Sell on Roxy (not applied → in review → approved) · Notifications · Settings & safety (dating/ghost toggles, DM permissions, appearance, export/delete, feedback) · Feedback & ideas.

## Safety requirements (first-class)
Block/mute/report on every post, profile, DM and room participant; reports anonymous; ghost + dating modes two taps from You; request-first DMs; content warnings honored; consent strip always visible in video dates; LIVE = dot + word, never color alone.

## Assets
`assets/roxy-logos/` — primary gradient wordmark, mono variants, app icon. The repo already carries equivalents at `apps/mobile/assets/brand/`.

## Files
- `Roxy App.dc.html` + `support.js` — the interactive prototype
- `PROMPT.md` — paste into Claude Code
- `assets/roxy-logos/*`
