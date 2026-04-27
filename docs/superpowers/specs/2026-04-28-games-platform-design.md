# Games Platform Design

**Goal:** A two-stage pitch-then-build submission pipeline for community-made games, a Roxy-managed catalog, community game selection in Studio, and a Games tab in the mobile app with WebView launching.

---

## Overview

Games live in a catalog. Two publisher types exist: **Roxy** (built internally) and **Community** (submitted by developers). Community games go through a two-stage review before appearing in the catalog. Community admins in Studio select which approved games to enable for their community. Mobile users see only games their community has enabled.

---

## Submission Pipeline

```
Developer submits pitch (concept, mechanics, mockup)
  → Roxy reviews internally
  → Rejected: developer sees feedback in submissions log
  → Approved: build submission unlocked

Developer submits build (URL, thumbnail, version notes)
  → Roxy tests internally
  → Changes requested: developer sees specific feedback, fixes + resubmits
  → Approved: game goes live in catalog
  → Communities can now enable it
```

---

## Database Schema

### `games`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| short_description | text | |
| how_it_works | text | pitch field |
| why_wlw | text | pitch field |
| category | text | 'party', 'trivia', 'dating', 'icebreaker', 'other' |
| publisher_type | text | 'roxy' or 'community' |
| status | text | see states below |
| url | text nullable | null for native Roxy games |
| thumbnail_url | text nullable | |
| submitted_by | uuid FK profiles | null for Roxy games |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Status states:**
- `pitch_pending` — pitch submitted, awaiting Roxy review
- `pitch_approved` — pitch approved, awaiting build submission
- `pitch_rejected` — pitch rejected
- `build_pending` — build submitted, awaiting Roxy review
- `build_changes` — build needs changes
- `live` — approved and visible in catalog
- `suspended` — removed from catalog post-launch

### `game_submission_events`
Audit log — one row per action on a game.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| game_id | uuid FK games | |
| stage | text | 'pitch' or 'build' |
| action | text | 'submitted', 'approved', 'rejected', 'changes_requested', 'resubmitted' |
| actor_id | uuid FK profiles | developer or staff member |
| developer_notes | text nullable | developer's submission notes |
| roxy_feedback | text nullable | staff feedback to developer |
| attachments | jsonb | array of storage URLs (mockups etc) |
| created_at | timestamptz | |

### `community_games`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| community_id | uuid FK communities | |
| game_id | uuid FK games | |
| enabled_by | uuid FK profiles | |
| enabled_at | timestamptz | |

Unique constraint: `(community_id, game_id)`

### `profiles` addition
Add `is_staff boolean DEFAULT false` — used to gate staff review pages in Studio.

---

## RLS Rules

- `games`: anyone can SELECT where status = 'live'. Owner can SELECT own submissions. Staff (is_staff) can SELECT all.
- `game_submission_events`: owner can SELECT own game events. Staff can SELECT all.
- `community_games`: community members can SELECT. Community admins can INSERT/DELETE. Staff can SELECT all.
- INSERT on `games`: authenticated users only.
- UPDATE on `games`: staff only (status changes). Owner can update draft fields before submission.

---

## Studio Pages

### `/games` — Community Game Selector (community admin)
- Grid of all `live` games
- Toggle on/off per community (writes to `community_games`)
- Filter: All / Roxy / Community
- Badge: 🟣 Roxy or 👤 Community

### `/games/submit` — Pitch Submission Form
- Fields: name, short_description, how_it_works, why_wlw, category, attachments (optional)
- Warning copy: "Before you build anything, pitch your idea first. We study each submission carefully — approval is not automatic."
- Creates `games` row (status: pitch_pending) + `game_submission_events` row (stage: pitch, action: submitted)

### `/games/submissions` — Developer Submissions Log
- Lists all games submitted by current user
- Each card shows: name, current stage, status, last updated, Roxy feedback snippet if any
- Progress indicator: Pitch → Build → Live (filled dots)
- CTA: [+ New Pitch]

### `/games/submissions/[id]` — Submission Detail
- Full timeline of `game_submission_events` for this game
- If status = pitch_approved: shows "Submit your build" CTA
- If status = build_changes: shows Roxy feedback + "Resubmit" CTA
- Build submission form (URL, version notes, thumbnail) embedded when unlocked

### `/staff/games` — Staff Review Queue (is_staff only)
- Two tabs: Pitches | Builds
- Each row: game name, developer handle, submitted date (e.g. "24 Apr 2026 · 2 days ago"), stage badge
- Click → review detail panel

### `/staff/games/[id]` — Staff Review Detail
- Left: submission list for this game (timeline)
- Right: current submission details (pitch fields or build URL + notes), attachments preview, internal notes field, feedback to developer field
- Actions: [Approve] [Request Changes] [Reject]
- All actions write a `game_submission_events` row and update `games.status`

---

## Mobile

### Games subtab (Discover)
- Replaces stub with real FlashList
- Queries `community_games` joined to `games` for active community
- Card: thumbnail, name, publisher badge (Roxy / Community)
- Tapping a Roxy native game (url = null) routes to native screen (e.g. `/speed-dating`)
- Tapping a community game opens WebView launcher

### WebView Game Launcher (`discover/games/[gameId]`)
- Full-screen WebView
- Close (×) button top-left
- Injects Roxy JS SDK on load

### Roxy JS SDK (injected into WebView)
```js
window.Roxy = {
  getUser: () => { /* postMessage to RN, returns { id, displayName } */ },
  close:   () => { /* postMessage → router.back() */ },
  shareScore: (score, message) => { /* postMessage → Share.share() */ },
}
```
Implemented via `WebView.injectedJavaScript` + `onMessage` handler in React Native.

---

## Staff Route Protection
Studio checks `profiles.is_staff` server-side in the `/staff/*` layout. Non-staff users get 404.

---

## Split into Two Implementation Plans
- **Part 1:** Migration + Studio (all Studio pages + staff queue)
- **Part 2:** Mobile (Games subtab + WebView launcher + Roxy JS SDK)
