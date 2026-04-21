# Rooms Feature — Design Spec
**Date:** 2026-04-22
**Product:** Roxy Studio + Roxy Client (mobile)
**Author:** Nicole Claire Marie A. Azachee / Claude

---

## Overview

Communities can open audio and video rooms for group bonding sessions. Rooms are collaborative — every participant's video and audio is live and visible to all, equal-tile grid model (not a webinar). Hosts manage the session from Studio (browser, recommended) or mobile.

---

## Section 1: Data Layer

### Migration 042 — `community_rooms`

```sql
CREATE TABLE community_rooms (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id      UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  host_id           UUID NOT NULL REFERENCES profiles(id),
  title             TEXT NOT NULL,
  description       TEXT,
  room_type         TEXT NOT NULL DEFAULT 'video' CHECK (room_type IN ('video', 'audio')),
  status            TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'scheduled', 'live', 'ended')),
  scheduled_at      TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  participant_count INTEGER NOT NULL DEFAULT 0,
  max_participants  INTEGER DEFAULT NULL,  -- NULL = no cap
  daily_room_name   TEXT,                 -- Daily.co room name (lazy-created on first Go Live)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX ON community_rooms(community_id, status);
CREATE INDEX ON community_rooms(host_id);

-- RLS
ALTER TABLE community_rooms ENABLE ROW LEVEL SECURITY;

-- Read: any community member
CREATE POLICY "members can view rooms"
  ON community_rooms FOR SELECT
  USING (
    community_id IN (
      SELECT community_id FROM community_members WHERE user_id = auth.uid()
    )
  );

-- Insert: community admin or moderator (NOT a profile flag — role-based)
CREATE POLICY "admins can create rooms"
  ON community_rooms FOR INSERT
  WITH CHECK (
    host_id = auth.uid() AND
    community_id IN (
      SELECT community_id FROM community_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'moderator')
    )
  );

-- Update: host only
CREATE POLICY "host can update room"
  ON community_rooms FOR UPDATE
  USING (host_id = auth.uid());
```

**Key decisions:**
- `participant_count` is an integer column updated by the `daily-webhook` edge function on join/leave events. Not computed at query time — avoids JOIN on hot read path.
- `max_participants` NULL means uncapped.
- `daily_room_name` populated lazily on first "Go Live" — Daily.co room is not created until needed.
- RLS uses community role, not a profile `can_create_room` flag (simpler, correct ownership model).

### pg_cron: auto-close empty live rooms

```sql
SELECT cron.schedule(
  'close-empty-rooms',
  '*/5 * * * *',
  $$
    UPDATE community_rooms
    SET status = 'ended', ended_at = now()
    WHERE status = 'live'
      AND participant_count = 0
      AND started_at < now() - interval '5 minutes';
  $$
);
```

---

## Section 2: Edge Functions

### `manage-room`
Actions: `create`, `update`, `open` (Go Live), `close` (End Room).

- `create` / `update`: upsert room record. No Daily.co call yet.
- `open`: verify caller is host → if `daily_room_name` is null, create Daily.co room via REST API → store name → update `status = 'live'`, `started_at = now()`.
- `close`: call Daily.co delete room API → update `status = 'ended'`, `ended_at = now()`.

Daily.co room config on creation:
```json
{
  "privacy": "private",
  "properties": {
    "exp": <now + 12h>,
    "max_participants": <max_participants or 50>,
    "enable_screenshare": true,
    "enable_chat": false,
    "start_video_off": false,
    "start_audio_off": false
  }
}
```

### `join-community-room`
- Verify caller is community member (via `community_members` table).
- Check `participant_count < max_participants` (if cap set) — return 403 if full.
- Generate Daily.co meeting token:
  - `is_owner: true` if caller is room's `host_id`
  - `exp: now + 4h`
- Return: `{ room_url, token, room_type, is_owner }`

### `kick-participant`
- Verify caller is room host.
- POST to Daily.co eject participant API: `DELETE /v1/rooms/{name}/participants/{session_id}`.
- Returns 200 on success.

### `daily-webhook`
- Receives Daily.co webhook events (shared secret verified via `DAILY_WEBHOOK_SECRET` env var).
- `participant-joined`: `UPDATE community_rooms SET participant_count = participant_count + 1 WHERE daily_room_name = $name`.
- `participant-left`: decrement (floor at 0).
- No JWT auth — webhook uses shared secret header instead.

---

## Section 3: Studio — `/rooms` List Page

**Route:** `apps/studio/app/(dashboard)/rooms/page.tsx` (server component)

Fetches all rooms for the host's community, ordered by status priority (live first, then scheduled, then ended).

**`RoomsClient` (client component):**

State per room card:
- **LIVE** rooms: green dot, participant ratio badge (`4 / 20`), "End Room" button (host only), time since start.
- **SCHEDULED** rooms: grey dot, `—/20` ratio (cap shown, no current count), scheduled time, "Go Live" button appears T-15min and later.
- **IDLE** rooms: dim, no action.
- **ENDED** rooms: collapsed into an "Past Rooms" accordion.

**T-15 min banner:** sticky top banner when a scheduled room starts in ≤ 15 minutes:
> "Sunday Brunch Vibes starts in 12 min — [Go Live Now]"

**Create/Edit modal fields:**
- Title (required)
- Description (optional)
- Room type: Video / Audio (toggle)
- Community (dropdown — host's communities)
- Schedule: Now or pick date/time
- Capacity: optional number input (blank = no cap)

**Go Live flow:** "Go Live" button → calls `manage-room` action `open` → on success, navigates to `/rooms/[id]`.

---

## Section 4: Studio — `/rooms/[id]` Session Page

**Route:** `apps/studio/app/(dashboard)/rooms/[id]/page.tsx`

On load: calls `join-community-room` → gets `room_url` + `is_owner` token → initialises `DailyIframe.createCallObject()`.

### Video Grid

All participants rendered as equal tiles. CSS Grid auto-layout:
| Count | Layout |
|---|---|
| 1 | Full width centred |
| 2 | Side by side |
| 3 | 1 top, 2 bottom |
| 4 | 2×2 |
| 5–6 | 3×2 |
| 7+ | 3×3 scrollable |

Each tile: video element + name label + mic status indicator (green ring when speaking, 🔇 icon if muted). Host tile has subtle "Host" label — no size advantage.

**Audio-only rooms:** same grid, tiles show avatar + name + animated speaking ring. No video track requested (`startCamera({ video: false })`).

**Screen share:** sharing participant gets a large centre tile; others shrink to a side strip. Reverts to equal grid when share ends.

### Controls (toolbar, bottom of page)

**All participants:**
- Mute / Unmute self
- Camera on / off
- Leave room

**Host only (additional):**
- Mute All (soft — participants can unmute themselves)
- End Room (hard — closes room for everyone, calls `manage-room close`)

**Per-tile host controls (hover overlay):**
- Mute this person (soft)
- Remove from room → `kick-participant` edge function

### Reconnection

If Daily.co connection drops: overlay banner "Reconnecting…" with spinner. Auto-rejoin on network restore. If 3 consecutive failures: show "Connection lost — [Rejoin] [Leave]".

### End Room flow

Host clicks "End Room" → confirmation dialog → `manage-room close` → Daily.co room deleted → DB `status = 'ended'` → redirect to `/rooms`.

---

## Section 5: Mobile — Roxy Client

### `CommunityRoomCard` component

Displayed in the community detail screen under a "Rooms" section.

```
● LIVE   Sunday Brunch Vibes          🎥  4 / 20
         Started 12 min ago         [Join Room]

○ SCHED  Evening Wind-Down            🎤  — / 15
         Today at 8:00 PM
```

Fields:
- Status dot: green ● LIVE / grey ○ SCHEDULED / dim IDLE
- Icon: 🎥 video / 🎤 audio
- Participant ratio: `4/20` live · `—/15` scheduled with cap · `—/—` no cap
- "Join Room" button: only shown when `status = 'live'`
- Scheduled tap → bottom sheet: title, host name, start time, "Add to Google Calendar" deep link

### Join flow (mobile)

1. Tap "Join Room" → `join-community-room` edge function call via `callEdgeFunction<{room_url, token, room_type, is_owner}>()`
2. If full (403): toast "This room is full"
3. On success: open Daily.co mobile SDK (`@daily-co/react-native-daily-js`, guarded import via `isDailyAvailable()`)
4. Same collaborative grid view: all tiles visible, equal size
5. Own controls at bottom: mute, cam, leave
6. Host tile labelled "Host"
7. Host on mobile gets participant bottom sheet (tap participant → Mute / Remove options)

### Live participant count sync

Mobile subscribes to Supabase Realtime on `community_rooms` filtered by `id=eq.{roomId}`:
```ts
supabase
  .channel(`room-${roomId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'community_rooms',
    filter: `id=eq.${roomId}`
  }, (payload) => {
    setParticipantCount(payload.new.participant_count);
  })
  .subscribe();
```

Count badge on `CommunityRoomCard` updates without full screen reload.

---

## Error States

| Scenario | Behaviour |
|---|---|
| Room full | 403 from `join-community-room` → toast "Room is full" |
| Camera/mic permission denied | Join audio-only, show banner "Camera access denied" |
| Daily.co room not yet created | `join-community-room` returns 404 if room not open yet → "Room hasn't started" |
| Network drop mid-session | Reconnect overlay, auto-rejoin |
| Host ends room | All participants get `meeting-session-stopped` Daily.co event → auto-navigate away |
| pg_cron auto-close | Empty room after 5 min → `status = 'ended'`, mobile Realtime update removes "Join Room" button |

---

## Out of Scope

- In-room text chat (Daily.co chat disabled)
- Recording
- Breakout rooms
- Reactions / emoji in-call
- Room replay / VOD

---

## Dependencies

| Dependency | Purpose |
|---|---|
| `@daily-co/daily-js` | Studio browser SDK (new install) |
| `@daily-co/react-native-daily-js` | Already in mobile (guarded import) |
| `DAILY_API_KEY` | Supabase Edge Function secret (already set for events) |
| `DAILY_WEBHOOK_SECRET` | New secret — shared secret for webhook verification |
| pg_cron | Already enabled |
| Supabase Realtime | Already in use |
