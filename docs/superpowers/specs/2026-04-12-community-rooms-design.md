# Community Rooms — Design Spec
**Date:** 2026-04-12
**Status:** Approved
**Scope:** Mobile app (roxy-client) + one new edge function + seed migration

---

## Context

Community rooms (audio/video group calls) are a core community feature. The backend infrastructure is ~80% complete from a prior session. This spec covers the remaining mobile UI, multi-participant support, admin controls, and dev seeding.

---

## What Already Exists (Do Not Rebuild)

| Asset | Location | Status |
|---|---|---|
| `community_rooms` table | migration 016 | Complete — schema, RLS, constraints |
| `join-community-room` edge fn | `supabase/functions/join-community-room/` | Complete — lazy creates Daily.co rooms |
| `community-room-session.tsx` | `apps/mobile/app/(tabs)/connect/` | Built — needs multi-participant + mute |
| `DailyProvider` | `apps/mobile/lib/video/DailyProvider.ts` | Built — video bug present |
| `useVideoCall` hook | `apps/mobile/hooks/useVideoCall.ts` | Built — single participant only |
| `VideoCallProvider` interface | `apps/mobile/lib/video/VideoCallProvider.ts` | Complete |
| `DAILY_API_KEY` secret | Remote Supabase secrets | Already set (used by Speed Dating) |

---

## Pieces

### 1. Video Bug Fix (also fixes Speed Dating)

**Root cause:** `participant-updated` fires when the remote video track becomes active. `DailyProvider` updates `_participants` internally but never calls a callback. `useVideoCall` holds the stale join-time `trackInfo` (no active video track). `DailyMediaView` renders black because `videoTrackState` is null/stale.

**Fix:**
- `VideoCallProvider.ts` — add `onParticipantUpdated: ((participant: RemoteParticipant) => void) | null`
- `DailyProvider.ts` — on `participant-updated`, call `onParticipantUpdated` with fresh track data for non-local participants
- `useVideoCall.ts` — wire `onParticipantUpdated` to refresh participant state, upgrade to `remoteParticipants: RemoteParticipant[]` (array)

**Scope:** 3 files, ~15 lines net change.

---

### 2. Rooms Tab in Community Detail

**File:** `apps/mobile/app/(tabs)/discover/community/[id].tsx`

- Add `'rooms'` as 4th entry in `SubTab` type and `TABS` array
- On mount, load `community_rooms` where `community_id = id AND is_active = true` (RLS already restricts to members)
- Render `CommunityRoomCard` rows: name, type badge (🎥 Video / 🎙️ Audio), pulsing Live dot
- Tap → `router.push` to `community-room-session` with `room_id` param
- Empty state: "No rooms open right now" with 📡 icon

---

### 3. Upgraded Room Session

**File:** `apps/mobile/app/(tabs)/connect/community-room-session.tsx`

**3a. Start muted**
`provider.join({ roomUrl, startAudioOff: true })` — every participant joins with mic off. They must tap mic to unmute.

**3b. Multi-participant grid**
`useVideoCall` now returns `remoteParticipants: RemoteParticipant[]`.

- **Video room:** 2-column `FlatList` grid. Each tile = `DailyMediaView` + display name label at bottom. Scrollable when >4 participants.
- **Audio room:** Avatar bubble grid (initials circle + name). No video tiles. Speaking indicator: colored ring pulses when participant's audio track is active.
- Top bar shows participant count alongside room name and Live dot.

**3c. Admin mute**
Current user's role is fetched from `community_members` on join. If role is `admin` or `moderator`, long-pressing any participant tile shows an action sheet with "Mute" / "Unmute". This calls the `manage-room-participant` edge function.

---

### 4. `manage-room-participant` Edge Function

**File:** `supabase/functions/manage-room-participant/index.ts`

**Input:** `{ room_id: string, participant_session_id: string, action: 'mute' | 'unmute' }`

**Logic:**
1. `verifyJWT` — authenticate caller
2. Fetch `community_rooms` to get `community_id` and `daily_room_name`
3. Verify caller has `role IN ('admin', 'moderator')` in `community_members` for that community — return 403 if not
4. Call Daily.co REST API: `POST https://api.daily.co/v1/meetings/{daily_room_name}/participants/{participant_session_id}` with `{ audio: false/true }`
5. Return `successResponse({ muted: true/false })`

No AI calls. No rate limit needed.

---

### 5. Seed Migration

**File:** `supabase/migrations/025_seed_community_rooms.sql`

Inserts 2 rooms per existing community. Runs as superuser (bypasses RLS). Safe to re-run.

```sql
-- Audio Hangout for each community (skip if already exists)
INSERT INTO community_rooms (community_id, name, description, room_type, is_active)
SELECT id, 'Audio Hangout', 'Open voice room for members', 'audio', true
FROM communities
WHERE NOT EXISTS (
  SELECT 1 FROM community_rooms cr
  WHERE cr.community_id = communities.id AND cr.name = 'Audio Hangout'
);

-- Video Hangout for each community (skip if already exists)
INSERT INTO community_rooms (community_id, name, description, room_type, is_active)
SELECT id, 'Video Hangout', 'Video room for members', 'video', true
FROM communities
WHERE NOT EXISTS (
  SELECT 1 FROM community_rooms cr
  WHERE cr.community_id = communities.id AND cr.name = 'Video Hangout'
);
```

---

## Data Flow

```
User opens community detail
  → taps Rooms tab
  → query community_rooms (RLS: members only)
  → taps a room card
  → navigate to community-room-session?room_id=xxx
  → callEdgeFunction('join-community-room', { room_id })
  → edge fn: get or create Daily.co room → return room_url
  → DailyProvider.join({ roomUrl, startAudioOff: true })
  → Daily.co SDK connects, user starts muted
  → remote participants render in grid
  → admin long-presses participant → callEdgeFunction('manage-room-participant', ...)
```

---

## Permissions Summary

| Action | Who | Enforced by |
|---|---|---|
| View room list | Community members only | Supabase RLS (`community_members` check) |
| Join a room | Community members only | Edge fn: `join-community-room` (no explicit check — relies on RLS for room fetch returning 404) |
| Mute a participant | Admin or moderator only | `manage-room-participant` edge fn checks `community_members.role` |
| Create rooms | Studio (future) | RLS INSERT policy: `can_create_room = true` OR admin role (to be updated in Studio session) |

---

## Testing Plan

- **Unit:** `useVideoCall` — participant join, participant-updated triggers re-render, participant leave
- **Unit:** `DailyProvider` — `onParticipantUpdated` fires on `participant-updated` event
- **Integration:** `manage-room-participant` — 403 for non-admin, 200 for moderator, 404 for unknown room
- **Seed:** migration runs without error, 2 rooms per community inserted, safe on re-run
- **E2E (manual):** join room → start muted → unmute → video renders (confirms bug fix) → leave room

---

## Out of Scope (Studio Session)

- Room creation UI in Studio (host dashboard)
- Room scheduling / expiry
- Participant count realtime updates (future Realtime subscription)
- Recording
