# Roxy client checklist

**Date:** 2026-09-07  
**Scope:** `apps/mobile` only. Studio is a separate list.  
**Canvas:** open beside chat — `roxy-client-checklist.canvas.tsx`  
**Rule:** update this file when an item closes. Always deploy live after a finished slice.

Status key:

- **LIVE** — on production DB or an already-shipped client
- **TREE** — in the working tree, uncommitted, not on users
- **NOW** — current coding slice
- **NEXT** — do these before Phase 2
- **WAIT** — locked later, or out of Phase 1

---

## Doing now

- [x] **NOW** Keep this file + the canvas in sync

## Next — finish before Phase 2

- [x] **TREE** Other profile: Events / Rooms / Games tabs when she has them
- [x] **TREE** Official profile: online-now row after members are live
- [x] **TREE** Official profile cover uses the granted community `cover_image_url` (personal cover column still WAIT)
- [x] **TREE** Other profile header More: Report + Block
- [x] **TREE** Posts always land on the author. Create sheet no longer asks where. Comments/replies/hearts work. Profile chrome + tags + tickets.

- [ ] **NEXT** Archive Watch / Read / Listen links + outbound click log
- [x] **LIVE** Commit / push / deploy mobile + Studio (`33e3460`, 7 Sep 2026)

## Done in this tree — not live

- [x] **TREE** Messages: DIRECT vs COMMUNITY CHATS
- [x] **TREE** Feed comments open `CommentSheet` on the feed
- [x] **TREE** You More menu (TikTok hamburger)
- [x] **TREE** Pending UX: status tag, no application maze
- [x] **TREE** Light mode: no pink page backgrounds
- [x] **TREE** Core “View as” in Settings
- [x] **TREE** Settings restyle
- [x] **TREE** Search bar: centered, readable
- [x] **TREE** Follow / Join UI on other + official profiles
- [x] **TREE** Following feed uses `follows`
- [x] **TREE** Discover: official communities first
- [x] **TREE** Phase 1 libs: `follows`, `officialGrant`, `profileSocialActions`, `followStore`
- [x] **TREE** You e2e: More first, then People / Badges / Saved

## Live already

- [x] **LIVE** Migration 116 — `follows` + `profiles.official_community_id`
- [x] **LIVE** `set_community_owner` links/creates one community + `#general`
- [x] **LIVE** Limited-launch columns (`access_tier`, core/staff, community-owner tag)
- [x] **LIVE** Earlier Archive + Official channels client (previous ship)
- [x] **LIVE** Studio can tag beta / core / staff (Studio, not this list)

## Wait

- [x] **LIVE** Migration 117 — null leftover `posts.community_id` / `posted_as_community`, `profiles.custom_tags` (max 5)
- [ ] **WAIT** For You ranks followed authors (announcement feed still exists for video)
- [ ] **WAIT** Self-serve community brand toggle
- [ ] **WAIT** Mobile event / game composers (Studio still hosts)
- [ ] **WAIT** Redirect `/community/[id]` to the owner profile

## Not this list

Studio Playwright search, tight Studio tables, Studio menu grouping.
