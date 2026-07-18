# UX Coherence Revamp — Design Spec
**Date:** 2026-07-18 · **App:** roxy-client (apps/mobile) · **Session:** 19

## Why

Roxy is a community-first WLW platform: communities join Roxy and launch their own events
(offline + online, video + audio), members support each other's businesses, and the whole
loop replaces the Instagram-post + TikTok-poll workflow hosts use today. The Claude Design
handoff (`docs/Roxy-handoff/roxy/project/`) defines the coherent 5-tab IA. Most of it is
implemented; what remains is a set of disjointed seams that break the story a buyer or a
first community host walks through. This spec closes those seams.

## Current state vs handoff (audit result)

Aligned already: 5-tab bar (Grow · Connect · Play · Messages · Build), Connect
Feed/Events/Rooms + context switcher + dating-mode toggle, Play hub (hero, live now,
originals, community games), Messages (search, pinned Roxy row, DM list, unread), Build
segments (Businesses · Impact · ✦ Support), community detail with posts/events/games/rooms,
root-level re-export shims for deep links.

Disjointed seams:

| # | Seam | Symptom |
|---|------|---------|
| 1 | Grow has no greeting | Handoff opens with time-of-day greeting + name + "N communities are buzzing today". App jumps straight to the Roxy Hero — the nurturing, personal opener is missing. |
| 2 | Grow "My Chats" duplicates Messages | Chats now live in the Messages tab; Grow still renders a My Chats section + `grow/chats.tsx` screen. Two homes for the same feature. |
| 3 | Grow header bell is mislabeled | Icon says "Notifications" but routes to Settings. No notifications screen exists. |
| 4 | Sister Button is orphaned | `(tabs)/connect/sister-button/` exists but **no screen links to it**. A finished emotional-support feature is unreachable. |
| 5 | Communities browser lives in Play | `(tabs)/discover/communities.tsx` — every "Discover communities" CTA (Grow chips, Connect empty states, Messages +) dumps the user into the **Play** tab. Community discovery belongs to Connect, the communities tab. |
| 6 | Messages "+" goes to communities browser | "New message" should start a DM with a friend, not browse communities. |
| 7 | Play "Live now" rows dead-end | Tapping a live room navigates to the generic Connect tab instead of joining the room session. |
| 8 | Community detail tab order | `posts · events · games · rooms` vs handoff `Posts · Rooms · Games · Events` (live rooms are the second-most-important surface for event-hosting communities). |
| 9 | Copy misdirections | "Join your first community in Play →", "Connect with someone in Connect →" — CTAs name the wrong tab or don't navigate. |

## Design

### D1. Grow greeting block (new, above Roxy Hero)
Time-of-day greeting ("Good morning," / afternoon / evening) + first name (gradient text) +
sub-line "🌸 N communities are buzzing today" derived from the already-fetched
`communityActivity` map (count of joined communities with a recent post). When zero,
sub-line reads "Your communities are quiet — start something 💜". Streak display is
**deferred** (needs a migration + server logic; backlog card, not this session).

### D2. Grow de-duplication
Remove the My Chats section from Grow (Messages tab owns chats; tab badge already carries
unread count). Delete `grow/chats.tsx` and its links; keep `/chat/[id]` root route (used by
Messages). Grow keeps: header, greeting, Roxy Hero, QOTD, Happening Tonight, Mini Wins,
My Communities, My People, Journey, Badges, My Tickets — matching handoff order.

### D3. Grow header fix
Right icon becomes a settings gear with accessibilityLabel "Settings" (bell returns when a
notifications feature ships). Avatar → profile unchanged.

### D4. Sister Button re-entry
Compact care card on Grow between My People and Journey: "🕯️ Need to talk? — Sister is here
for the heavy days" → routes to `/sister-button` (new root shim re-exporting
`(tabs)/connect/sister-button`). One card, no new store, feature is reachable again.

### D5. Communities browser moves to Connect
Move `(tabs)/discover/communities.tsx` → `(tabs)/connect/communities.tsx` (file move, no
logic change). Add root shim `app/communities.tsx` for cross-tab links. Update every
reference (Grow ×3, Play ×3, Messages ×1, Connect empty states ×2). Result: browsing
communities highlights the Connect tab — discovery lives where communities live.

### D6. Messages new-DM picker
New screen `(tabs)/messages/new.tsx`: friends list (reuses `friendStore`, presence dots,
gradient avatars), tap → find-or-create direct conversation → `/chat/[id]`. The
find-or-create logic is extracted from `grow/people.tsx#handleFriendTap` into
`lib/directMessages.ts` (`openDirectChat(userId, partnerId, router)`) and reused in both
places. Empty state: "Add friends in your communities first 💜" + CTA → `/communities`.
Messages "+" routes here.

### D7. Play fixes
Live-now rows route to `/(tabs)/connect/community-room-session?room_id=<id>` (join flow
guards status/membership server-side already). Header icon keeps browse-communities purpose
but routes to `/communities` shim. "Browse →" links likewise.

### D8. Community detail tab order
Reorder `TABS` to `['posts', 'rooms', 'games', 'events']`. The swipe pager derives from the
same array, so reordering is a single-source change.

### D9. Copy pass
- Grow empty communities: "Find your communities →" → routes to `/communities`.
- Messages empty: "Your people are in your communities — say hi in a feed or add friends
  from a member list 💜".
- Grow My People empty: "Add friends from your communities →" → routes to `/communities`.

## Standards checklist (per CLAUDE.md §11)
- Loading states: new-DM picker shows spinner while friends load; openDirectChat disables
  row taps while creating (guard flag).
- Errors: openDirectChat alerts on failure (same as today); screens already wrapped in
  existing error patterns.
- Optimistic UI: none needed (navigation-only changes + one insert with error alert).
- Accessibility: all new icon buttons get accessibilityLabel; gear labeled "Settings".
- Security: no new tables, no RLS changes; conversation insert already covered by existing
  RLS (participant must include auth user). No PII in logs.

## Testing
- Update tests asserting old navigation targets (`discover/communities`, grow chats links).
- New unit tests: `lib/directMessages.ts` (existing conversation found → push; none →
  insert + push; error → alert, no navigation).
- New render test: Messages `new.tsx` (friends render, empty state, tap calls helper).
- Full QA loop before PR: eslint · tsc · jest · expo web export.

## Out of scope (backlog, so it isn't forgotten)
- Login-streak schema + Grow streak chip (migration 046 candidate).
- Notifications center (restores the bell).
- Game creation ("+ Make a game") — Studio feature.
- Renaming the `discover/` route folder to `play/` (imports churn, zero user value).
