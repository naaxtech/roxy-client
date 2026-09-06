# Account, Follow, Official Grant — Design Spec

**Date:** 2026-09-07  
**Apps:** apps/mobile, apps/studio, supabase  
**Status:** Approved (data + UI). Phase 1 overlay ships now. Phase 2 hard cut after test.  
**Look:** `docs/handoff/claude-design-import/design_handoff_roxy_3_0/Roxy App.dc.html` (profile 456–633, Feed follow 146–147 / 1635–1636, Discover communities 1698–1716)

---

## Goal

A woman registers as herself. She can brand as a person or as a community. Posts live on **her account**. Nobody joins a community to see posts. Official community is a Roxy grant that unlocks chat, members, Discover placement, hosting games/events — not a post folder.

## Locked decisions

- One login, one profile. Chat is an extra grant on the same account.
- Anyone can brand themselves as a community visually. Official = apply → Roxy core grant.
- Posts live on `author_id`. Not posted *into* a community.
- Official grant unlocks only: profile badge, community chat, member list, Discover placement, submit her own games, host her own events. Shop stays the existing seller approval.
- Events/Games **tabs** can exist on every profile; **creating** events/games is gated to official.
- Follow anyone (new, feed only, no chat). Join only official accounts (`community_members` → member list + chat). Friends stay request-first for DMs.
- Official grant attaches **one** `communities` row to her profile for join/chat only. Posts do not go in that row.
- Roxy Official stays one granted product community, not a post folder.
- Migration: **1 thin overlay now**, **2 hard cut after testing**. Do not dual-write. Do not forget phase 2.

## Phase 1 data (this ship)

| Object | Rule |
|---|---|
| `follows (follower_id, followed_id)` | Unique pair. No self-follow. RLS: read own outgoing/incoming; insert/delete only as follower. |
| `profiles.official_community_id` | Nullable FK to `communities`. Unique. Clients have no UPDATE grant. Written only by `set_community_owner`. |
| `is_community_owner` | Kept. Granting true also links or creates the official `communities` row + `#general` + admin membership. Ungranting clears the FK, does not delete the community. |
| New posts | `author_id` is home. `community_id` stays nullable leftover. Composer already writes `null` for profile posts. |
| Post read | Existing `posts_select` already allows `community_id IS NULL` for approved members (minus blocks). Do not reopen join-to-see on author-owned posts. |
| Chat / join | Unchanged: `communities` / `community_members` / `community_channels`. |

## Phase 1 UI (Claude Design)

Shared profile shell. Same tabs as today (`visibleTabs`): Posts, Saved (self), Shop (approved seller), Events, Rooms, Games, About — only when populated. Official does **not** become a different tab set.

### Other person (not official)

Claude Design user row: **Message** (filled pink) + **Follow** (outline).

- Follow / Following — writes `follows`.
- Message / Add friend / Requested / Accept — existing friendship, request-first DMs.

### Official community account

Claude Design community row plus Follow, because posts live on her:

- Follow / Following (outline).
- Join / Joined (filled pink) — writes `community_members` on `official_community_id`.
- `# Channels` once joined — existing channel route.
- Official chip on the name (`OFFICIAL`), rounded-square avatar like the design's community frame.

### You (self)

Existing You tab + More menu. Official chip if granted. No Follow/Join on self.

### Feed

- **Following** uses `follows`, not accepted friends. Empty copy tells the truth: follow people and this fills up.
- Feed rail Follow control (Claude Design `showFollow`) stays on the author chip.
- **For You** stays announcements in this overlay. Phase 2 makes following the subscription.

### Discover

Official communities get first placement on the Communities rail (and Top 10 when they rank). Card look stays PosterCard + `community` badge. Join still happens on the community / official profile, not on the card.

## Phase 2 (after test — do not forget)

- Null / migrate leftover `posts.community_id`.
- Drop `posted_as_community` as the public door.
- Following feed is the subscription (For You ranks followed authors).
- Cleaner long-term; touches every feed query.

## Out of scope for Phase 1

- Self-serve "I am a community" visual brand toggle (display shape without a grant).
- Hosting events/games composers on mobile (Studio still hosts).
- Changing `/community/[id]` into a redirect to the owner's profile.
- Dual-write of posts into both `author_id` and `community_id`.
