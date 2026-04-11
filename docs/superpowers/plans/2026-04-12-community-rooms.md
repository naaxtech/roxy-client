# Community Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement live, scheduled, and closed community rooms with audio/video group calls, host badges, admin mute, community filter support, and a shared room card UI across Connect and community detail screens.

**Architecture:** Two new migrations add `status`/`scheduled_at` to `community_rooms` and seed dev data. The `join-community-room` edge function is upgraded to gate on `status = 'live'`, create Daily.co meeting tokens with role-based `is_owner`, and return host metadata. The `DailyProvider` gains multi-participant support, `startAudioOff`, and `muteParticipant`. A shared `CommunityRoomCard` component is used in both the Connect Rooms tab and the community detail Rooms tab.

**Tech Stack:** Expo 51 / React Native 0.74, TypeScript strict, Supabase Edge Functions (Deno), `@daily-co/react-native-daily-js`, Zustand `communityFilterStore`, `@testing-library/react-native`, Jest.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `supabase/migrations/025_room_status.sql` | Add status + scheduled_at columns |
| Create | `supabase/migrations/026_seed_community_rooms.sql` | Seed dev rooms with mixed statuses |
| Modify | `apps/mobile/types/index.ts` | Add CommunityRoom interface, update RemoteParticipant |
| Modify | `apps/mobile/lib/video/VideoCallProvider.ts` | Add onParticipantUpdated, muteParticipant, startAudioOff param |
| Modify | `apps/mobile/lib/video/DailyProvider.ts` | Token support, startAudioOff, onParticipantUpdated, muteParticipant |
| Modify | `apps/mobile/hooks/useVideoCall.ts` | Multi-participant array, onParticipantUpdated wiring |
| Modify | `supabase/functions/join-community-room/index.ts` | Status gate, meeting token, role-based is_owner, creator info |
| Create | `apps/mobile/components/community/CommunityRoomCard.tsx` | Shared room card (live/scheduled/closed states) |
| Modify | `apps/mobile/app/(tabs)/discover/community/[id].tsx` | Add Rooms tab (4th tab) |
| Modify | `apps/mobile/app/(tabs)/connect/index.tsx` | Upgrade room cards to use CommunityRoomCard |
| Modify | `apps/mobile/app/(tabs)/connect/community-room-session.tsx` | Multi-participant grid, audio/video modes, host badge, admin mute |
| Create | `apps/mobile/__tests__/components/CommunityRoomCard.test.tsx` | Card render tests |
| Create | `apps/mobile/__tests__/hooks/useVideoCall.test.ts` | Multi-participant hook tests |

---

## Task 1: Schema — room status + scheduled_at

**Files:**
- Create: `supabase/migrations/025_room_status.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 025_room_status.sql
-- Adds status and scheduled_at to community_rooms.
-- status replaces the implicit meaning of is_active:
--   'live'      → room is open, joinable
--   'scheduled' → room is future-dated, not yet joinable
--   'closed'    → room has ended, not joinable (hidden in mobile list)
-- is_active is kept for backward compat with existing edge fn query (updated in Task 7).

ALTER TABLE community_rooms
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'live'
    CHECK (status IN ('live', 'scheduled', 'closed')),
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz NULL;

-- Back-fill: existing rows that are active → 'live', inactive → 'closed'
UPDATE community_rooms SET status = 'live'   WHERE is_active = true  AND status = 'live';
UPDATE community_rooms SET status = 'closed' WHERE is_active = false AND status = 'live';

COMMENT ON COLUMN community_rooms.status IS
  'live=open and joinable, scheduled=future room, closed=ended';
COMMENT ON COLUMN community_rooms.scheduled_at IS
  'Required when status=scheduled. NULL for live/closed rooms.';
```

- [ ] **Step 2: Push to local Supabase**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
npx supabase db push --local
```

Expected: `Applying migration 025_room_status.sql... done`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/025_room_status.sql
git commit -m "feat(db): add status and scheduled_at to community_rooms"
```

---

## Task 2: Schema — seed community rooms

**Files:**
- Create: `supabase/migrations/026_seed_community_rooms.sql`

- [ ] **Step 1: Write the seed migration**

```sql
-- 026_seed_community_rooms.sql
-- Inserts dev rooms for every existing community.
-- Runs as superuser — bypasses RLS.
-- Safe to re-run (WHERE NOT EXISTS guards).
-- Statuses: mix of live, scheduled, closed for UI testing.

-- Audio Hangout (live) — one per community
INSERT INTO community_rooms (community_id, name, description, room_type, status, is_active, scheduled_at)
SELECT
  c.id,
  'Audio Hangout',
  'Open voice room for members',
  'audio',
  'live',
  true,
  NULL
FROM communities c
WHERE NOT EXISTS (
  SELECT 1 FROM community_rooms cr
  WHERE cr.community_id = c.id AND cr.name = 'Audio Hangout'
);

-- Video Hangout (live) — one per community
INSERT INTO community_rooms (community_id, name, description, room_type, status, is_active, scheduled_at)
SELECT
  c.id,
  'Video Hangout',
  'Video room for members',
  'video',
  'live',
  true,
  NULL
FROM communities c
WHERE NOT EXISTS (
  SELECT 1 FROM community_rooms cr
  WHERE cr.community_id = c.id AND cr.name = 'Video Hangout'
);

-- Weekly Catch-up (scheduled) — one per community, 3 days from now
INSERT INTO community_rooms (community_id, name, description, room_type, status, is_active, scheduled_at)
SELECT
  c.id,
  'Weekly Catch-up',
  'Our regular weekly video call',
  'video',
  'scheduled',
  false,
  now() + interval '3 days'
FROM communities c
WHERE NOT EXISTS (
  SELECT 1 FROM community_rooms cr
  WHERE cr.community_id = c.id AND cr.name = 'Weekly Catch-up'
);
```

- [ ] **Step 2: Push to local Supabase**

```bash
npx supabase db push --local
```

Expected: `Applying migration 026_seed_community_rooms.sql... done`

- [ ] **Step 3: Verify seed**

```bash
npx supabase db query "SELECT name, status, room_type FROM community_rooms LIMIT 10;"
```

Expected: rows with Audio Hangout/live, Video Hangout/live, Weekly Catch-up/scheduled.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/026_seed_community_rooms.sql
git commit -m "feat(db): seed community rooms with live and scheduled states"
```

---

## Task 3: Types — CommunityRoom + RemoteParticipant

**Files:**
- Modify: `apps/mobile/types/index.ts`

- [ ] **Step 1: Add CommunityRoom interface and update RemoteParticipant**

In `apps/mobile/types/index.ts`, add after the `Badge` interface (around line 149):

```ts
export interface CommunityRoom {
  id: string;
  community_id: string;
  name: string;
  description: string | null;
  room_type: 'video' | 'audio';
  status: 'live' | 'scheduled' | 'closed';
  scheduled_at: string | null;
  daily_room_url: string | null;
  daily_room_name: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/types/index.ts
git commit -m "feat(types): add CommunityRoom interface"
```

---

## Task 4: VideoCallProvider interface — new capabilities

**Files:**
- Modify: `apps/mobile/lib/video/VideoCallProvider.ts`

- [ ] **Step 1: Update RemoteParticipant and VideoCallProvider**

Replace the entire file content:

```ts
import type React from 'react';

export type VideoCallState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface RemoteParticipant {
  /** Provider-specific identifier (Daily: session_id) */
  id: string;
  /** Passed back to renderRemoteVideo — each provider casts to its own type */
  trackInfo: unknown;
  /** Display name set via meeting token user_name */
  displayName: string | null;
  /** True when this participant joined with is_owner: true (admin/moderator) */
  isOwner: boolean;
}

export interface VideoCallProvider {
  readonly type: 'daily' | 'livekit';
  readonly isAvailable: boolean;

  // ── Event callbacks (set before calling join) ──────────────────────────────
  onStateChange: ((state: VideoCallState) => void) | null;
  onRemoteJoined: ((participant: RemoteParticipant) => void) | null;
  onRemoteLeft: ((participantId: string) => void) | null;
  /** Fired when a remote participant's track state updates (e.g. video becomes active) */
  onParticipantUpdated: ((participant: RemoteParticipant) => void) | null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  join(params: { roomUrl: string; token?: string; startAudioOff?: boolean }): Promise<void>;
  leave(): Promise<void>;
  destroy(): void;

  // ── Controls ───────────────────────────────────────────────────────────────
  toggleMic(): void;
  toggleCamera(): void;
  /** Mute a remote participant — only works when local participant joined with is_owner: true */
  muteParticipant(sessionId: string): void;

  // ── Render ─────────────────────────────────────────────────────────────────
  renderRemoteVideo(participant: RemoteParticipant, style: object): React.ReactElement | null;
  renderLocalVideo(style: object): React.ReactElement | null;
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: errors only in `DailyProvider.ts` (not yet updated) — confirm and move to Task 5.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/video/VideoCallProvider.ts
git commit -m "feat(video): extend VideoCallProvider with onParticipantUpdated and muteParticipant"
```

---

## Task 5: DailyProvider — token, startAudioOff, multi-participant, mute

**Files:**
- Modify: `apps/mobile/lib/video/DailyProvider.ts`

- [ ] **Step 1: Write failing test first**

Create `apps/mobile/__tests__/hooks/useVideoCall.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react-native';
import { useVideoCall } from '../../hooks/useVideoCall';
import type { VideoCallProvider, RemoteParticipant } from '../../lib/video/VideoCallProvider';

function makeParticipant(id: string, displayName: string, isOwner = false): RemoteParticipant {
  return { id, trackInfo: {}, displayName, isOwner };
}

function makeMockProvider(): VideoCallProvider {
  return {
    type: 'daily',
    isAvailable: true,
    onStateChange: null,
    onRemoteJoined: null,
    onRemoteLeft: null,
    onParticipantUpdated: null,
    join: jest.fn(),
    leave: jest.fn(),
    destroy: jest.fn(),
    toggleMic: jest.fn(),
    toggleCamera: jest.fn(),
    muteParticipant: jest.fn(),
    renderRemoteVideo: jest.fn(() => null),
    renderLocalVideo: jest.fn(() => null),
  };
}

describe('useVideoCall — multi-participant', () => {
  it('adds participants on join', () => {
    const provider = makeMockProvider();
    const { result } = renderHook(() => useVideoCall(provider));

    act(() => {
      provider.onRemoteJoined!(makeParticipant('p1', 'Alice'));
      provider.onRemoteJoined!(makeParticipant('p2', 'Maya'));
    });

    expect(result.current.remoteParticipants).toHaveLength(2);
    expect(result.current.remoteParticipants[0].displayName).toBe('Alice');
  });

  it('removes participant on leave', () => {
    const provider = makeMockProvider();
    const { result } = renderHook(() => useVideoCall(provider));

    act(() => {
      provider.onRemoteJoined!(makeParticipant('p1', 'Alice'));
      provider.onRemoteJoined!(makeParticipant('p2', 'Maya'));
    });
    act(() => {
      provider.onRemoteLeft!('p1');
    });

    expect(result.current.remoteParticipants).toHaveLength(1);
    expect(result.current.remoteParticipants[0].id).toBe('p2');
  });

  it('updates participant track info without adding duplicate', () => {
    const provider = makeMockProvider();
    const { result } = renderHook(() => useVideoCall(provider));

    act(() => {
      provider.onRemoteJoined!(makeParticipant('p1', 'Alice'));
    });
    act(() => {
      provider.onParticipantUpdated!(makeParticipant('p1', 'Alice', true));
    });

    expect(result.current.remoteParticipants).toHaveLength(1);
    expect(result.current.remoteParticipants[0].isOwner).toBe(true);
  });

  it('exposes remoteParticipant (singular) for backward compat', () => {
    const provider = makeMockProvider();
    const { result } = renderHook(() => useVideoCall(provider));

    act(() => {
      provider.onRemoteJoined!(makeParticipant('p1', 'Alice'));
    });

    expect(result.current.remoteParticipant).not.toBeNull();
    expect(result.current.remoteParticipant?.id).toBe('p1');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/mobile && npx jest --testPathPattern=useVideoCall --ci
```

Expected: FAIL — `onParticipantUpdated` is undefined, `remoteParticipants` is undefined.

- [ ] **Step 3: Update useVideoCall hook**

Replace entire `apps/mobile/hooks/useVideoCall.ts`:

```ts
import { useEffect, useState } from 'react';
import type { VideoCallProvider, VideoCallState, RemoteParticipant } from '../lib/video/VideoCallProvider';

export function useVideoCall(provider: VideoCallProvider | null) {
  const [state, setState] = useState<VideoCallState>('idle');
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);

  useEffect(() => {
    if (!provider) return;

    provider.onStateChange = setState;

    provider.onRemoteJoined = (participant) => {
      setRemoteParticipants((prev) =>
        prev.some((p) => p.id === participant.id) ? prev : [...prev, participant]
      );
    };

    provider.onRemoteLeft = (participantId) => {
      setRemoteParticipants((prev) => prev.filter((p) => p.id !== participantId));
    };

    provider.onParticipantUpdated = (participant) => {
      setRemoteParticipants((prev) =>
        prev.map((p) => (p.id === participant.id ? participant : p))
      );
    };

    return () => {
      provider.onStateChange = null;
      provider.onRemoteJoined = null;
      provider.onRemoteLeft = null;
      provider.onParticipantUpdated = null;
    };
  }, [provider]);

  return {
    state,
    remoteParticipants,
    // Backward compat for Speed Dating (single remote participant)
    remoteParticipant: remoteParticipants[0] ?? null,
  };
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd apps/mobile && npx jest --testPathPattern=useVideoCall --ci
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Update DailyProvider**

Replace entire `apps/mobile/lib/video/DailyProvider.ts`:

```ts
import React from 'react';
import type { VideoCallProvider, VideoCallState, RemoteParticipant } from './VideoCallProvider';

// Guarded import — never crashes Expo Go
let DailyCall: any = null;
let DailyMediaView: any = null;
try {
  const mod = require('@daily-co/react-native-daily-js');
  DailyCall = mod.default ?? mod;
  DailyMediaView = mod.DailyMediaView ?? null;
} catch {}

function makeRemoteParticipant(p: any): RemoteParticipant {
  return {
    id: p.session_id,
    trackInfo: p,
    displayName: p.user_name ?? null,
    isOwner: p.owner ?? false,
  };
}

export class DailyProvider implements VideoCallProvider {
  readonly type = 'daily' as const;
  get isAvailable() { return DailyCall !== null; }

  onStateChange: ((state: VideoCallState) => void) | null = null;
  onRemoteJoined: ((participant: RemoteParticipant) => void) | null = null;
  onRemoteLeft: ((participantId: string) => void) | null = null;
  onParticipantUpdated: ((participant: RemoteParticipant) => void) | null = null;

  private _call: any = null;

  async join({ roomUrl, token, startAudioOff = false }: {
    roomUrl: string;
    token?: string;
    startAudioOff?: boolean;
  }): Promise<void> {
    if (!DailyCall) throw new Error('Daily.co not available');
    this.onStateChange?.('connecting');
    try {
      this._call = DailyCall.createCallObject();

      this._call.on('joining-meeting', () => this.onStateChange?.('connecting'));
      this._call.on('joined-meeting',  () => this.onStateChange?.('connected'));
      this._call.on('left-meeting',    () => this.onStateChange?.('disconnected'));
      this._call.on('error',           () => this.onStateChange?.('error'));

      this._call.on('participant-joined', (evt: any) => {
        if (!evt.participant.local) {
          this.onRemoteJoined?.(makeRemoteParticipant(evt.participant));
        }
      });

      this._call.on('participant-updated', (evt: any) => {
        if (!evt.participant.local) {
          this.onParticipantUpdated?.(makeRemoteParticipant(evt.participant));
        }
      });

      this._call.on('participant-left', (evt: any) => {
        this.onRemoteLeft?.(evt.participant.session_id);
      });

      const joinParams: Record<string, unknown> = { url: roomUrl, startAudioOff };
      if (token) joinParams.token = token;
      await this._call.join(joinParams);
    } catch (e) {
      this.onStateChange?.('error');
      throw e;
    }
  }

  async leave(): Promise<void> {
    await this._call?.leave().catch(() => {});
  }

  destroy(): void {
    this._call?.destroy().catch(() => {});
    this._call = null;
  }

  toggleMic(): void {
    if (!this._call) return;
    const local = this._call.participants()?.local;
    this._call.setLocalAudio(!local?.audio);
  }

  toggleCamera(): void {
    if (!this._call) return;
    const local = this._call.participants()?.local;
    this._call.setLocalVideo(!local?.video);
  }

  muteParticipant(sessionId: string): void {
    if (!this._call) return;
    // Requires is_owner: true in meeting token
    this._call.updateParticipant(sessionId, { setAudio: false });
  }

  renderRemoteVideo(participant: RemoteParticipant, style: object): React.ReactElement | null {
    if (!DailyMediaView) return null;
    const p = participant.trackInfo as any;
    return React.createElement(DailyMediaView, {
      sessionId: participant.id,
      videoTrackState: p?.tracks?.video ?? null,
      audioTrackState: p?.tracks?.audio ?? null,
      style,
      mirror: false,
    });
  }

  renderLocalVideo(style: object): React.ReactElement | null {
    if (!DailyMediaView || !this._call) return null;
    const local = this._call.participants()?.local;
    return React.createElement(DailyMediaView, {
      sessionId: 'local',
      videoTrackState: local?.tracks?.video ?? null,
      audioTrackState: null,
      style,
      mirror: true,
    });
  }
}
```

- [ ] **Step 6: Type-check**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/lib/video/VideoCallProvider.ts apps/mobile/lib/video/DailyProvider.ts apps/mobile/hooks/useVideoCall.ts apps/mobile/__tests__/hooks/useVideoCall.test.ts
git commit -m "fix(video): multi-participant support, onParticipantUpdated, muteParticipant, startAudioOff"
```

---

## Task 6: join-community-room edge function upgrade

**Files:**
- Modify: `supabase/functions/join-community-room/index.ts`

- [ ] **Step 1: Replace edge function**

```ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const DEV_MOCK_ROOM_URL = 'https://roxy.daily.co/dev-room';

async function getOrCreateDailyRoom(roomName: string, apiKey: string): Promise<string> {
  const getRes = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (getRes.ok) {
    const room = await getRes.json();
    return room.url;
  }
  const createRes = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: roomName,
      properties: {
        max_participants: 50,
        enable_chat: true,
        enable_screenshare: false,
        exp: Math.floor(Date.now() / 1000) + 7200,
        eject_at_room_exp: true,
      },
    }),
  });
  if (!createRes.ok) throw new Error(`Daily.co room creation failed: ${await createRes.text()}`);
  return (await createRes.json()).url;
}

async function createMeetingToken(
  roomName: string,
  userName: string,
  userId: string,
  isOwner: boolean,
  apiKey: string,
): Promise<string> {
  const res = await fetch('https://api.daily.co/v1/meeting-tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        user_id: userId,
        is_owner: isOwner,
        start_audio_off: true,
        eject_at_room_exp: true,
      },
    }),
  });
  if (!res.ok) throw new Error(`Meeting token creation failed: ${await res.text()}`);
  return (await res.json()).token;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { room_id } = body;
  if (!room_id) return errorResponse('room_id required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  if (DEV_MOCK) {
    return successResponse({
      room_url: DEV_MOCK_ROOM_URL,
      room_name: 'Dev Room',
      room_type: 'video',
      community_id: 'mock',
      token: null,
      is_host: true,
      creator_display_name: 'Dev Host',
    });
  }

  const supabase = getSupabaseClient();
  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) return errorResponse('DAILY_API_KEY not configured', 503);

  // Fetch room
  const { data: room, error: roomError } = await supabase
    .from('community_rooms')
    .select('id, name, daily_room_url, daily_room_name, community_id, room_type, status, created_by')
    .eq('id', room_id)
    .single();

  if (roomError || !room) return errorResponse('Room not found', 404);
  if (room.status === 'scheduled') return errorResponse('Room has not started yet', 409);
  if (room.status === 'closed')    return errorResponse('Room is closed', 410);

  // Get or create Daily.co room
  const roomName = room.daily_room_name ?? `roxy-community-${room_id.slice(0, 8)}`;
  let roomUrl = room.daily_room_url as string | null;

  if (!roomUrl) {
    try {
      roomUrl = await getOrCreateDailyRoom(roomName, dailyApiKey);
      await supabase
        .from('community_rooms')
        .update({ daily_room_url: roomUrl, daily_room_name: roomName })
        .eq('id', room_id);
    } catch (e) {
      return errorResponse(`Failed to create video room: ${e instanceof Error ? e.message : 'unknown'}`, 500);
    }
  }

  // Determine if joining user is admin/moderator
  const [profileRes, memberRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', auth.userId)
      .single(),
    supabase
      .from('community_members')
      .select('role')
      .eq('community_id', room.community_id)
      .eq('user_id', auth.userId)
      .single(),
  ]);

  const displayName = profileRes.data?.display_name ?? 'Guest';
  const role = memberRes.data?.role ?? 'member';
  const isOwner = role === 'admin' || role === 'moderator' || auth.userId === room.created_by;

  // Get creator display name
  let creatorDisplayName: string | null = null;
  if (room.created_by) {
    const { data: creator } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', room.created_by)
      .single();
    creatorDisplayName = creator?.display_name ?? null;
  }

  // Create meeting token
  let token: string | null = null;
  try {
    token = await createMeetingToken(roomName, displayName, auth.userId, isOwner, dailyApiKey);
  } catch (e) {
    // Non-fatal — fall back to tokenless join (room must be open access)
    console.error('Meeting token creation failed, falling back to tokenless join:', e);
  }

  return successResponse({
    room_url: roomUrl,
    room_name: room.name,
    room_type: room.room_type,
    community_id: room.community_id,
    token,
    is_host: isOwner,
    creator_display_name: creatorDisplayName,
  });
});
```

- [ ] **Step 2: Verify local dev mock still works**

```bash
npx supabase functions serve join-community-room --env-file supabase/functions/.env
# In another terminal:
curl -X POST http://localhost:54321/functions/v1/join-community-room \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"room_id":"test"}'
```

Expected (dev mock): `{"success":true,"data":{"room_url":"https://roxy.daily.co/dev-room","is_host":true,...}}`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/join-community-room/index.ts
git commit -m "feat(edge): upgrade join-community-room — status gate, meeting token, role-based is_owner"
```

---

## Task 7: CommunityRoomCard component

**Files:**
- Create: `apps/mobile/components/community/CommunityRoomCard.tsx`
- Create: `apps/mobile/__tests__/components/CommunityRoomCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/mobile/__tests__/components/CommunityRoomCard.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import { CommunityRoomCard } from '../../components/community/CommunityRoomCard';

const base = {
  id: 'r1',
  name: 'Gaming Night Hangout',
  description: 'Chill voice while we game',
  room_type: 'audio' as const,
  status: 'live' as const,
  scheduled_at: null,
  community_name: 'Queer Gamers',
  creator_display_name: 'Sam',
  onPress: jest.fn(),
};

describe('CommunityRoomCard', () => {
  it('renders room name and description', () => {
    const { getByText } = render(<CommunityRoomCard {...base} />);
    expect(getByText('Gaming Night Hangout')).toBeTruthy();
    expect(getByText('Chill voice while we game')).toBeTruthy();
  });

  it('shows Live badge for live rooms', () => {
    const { getByText } = render(<CommunityRoomCard {...base} />);
    expect(getByText('● Live')).toBeTruthy();
  });

  it('shows scheduled time for scheduled rooms', () => {
    const { getByTestId } = render(
      <CommunityRoomCard
        {...base}
        status="scheduled"
        scheduled_at="2026-04-19T19:00:00Z"
      />
    );
    expect(getByTestId('scheduled-badge')).toBeTruthy();
  });

  it('calls onPress for live rooms', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<CommunityRoomCard {...base} onPress={onPress} />);
    fireEvent.press(getByTestId('room-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress for scheduled rooms', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <CommunityRoomCard {...base} status="scheduled" scheduled_at="2026-04-19T19:00:00Z" onPress={onPress} />
    );
    fireEvent.press(getByTestId('room-card'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows community and host info', () => {
    const { getByText } = render(<CommunityRoomCard {...base} />);
    expect(getByText('🏘 Queer Gamers')).toBeTruthy();
    expect(getByText('👑 Sam')).toBeTruthy();
  });

  it('shows audio icon for audio rooms', () => {
    const { getByText } = render(<CommunityRoomCard {...base} room_type="audio" />);
    expect(getByText('🎙️')).toBeTruthy();
  });

  it('shows video icon for video rooms', () => {
    const { getByText } = render(<CommunityRoomCard {...base} room_type="video" />);
    expect(getByText('🎥')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
cd apps/mobile && npx jest --testPathPattern=CommunityRoomCard --ci
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `apps/mobile/components/community/CommunityRoomCard.tsx`:

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format } from 'date-fns';
import { COLORS } from '../../lib/constants';

interface CommunityRoomCardProps {
  id: string;
  name: string;
  description: string | null;
  room_type: 'video' | 'audio';
  status: 'live' | 'scheduled' | 'closed';
  scheduled_at: string | null;
  community_name: string | null;
  creator_display_name: string | null;
  /** Hide community tag when already scoped to one community (e.g. community detail screen) */
  hideCommunityTag?: boolean;
  onPress: () => void;
}

export function CommunityRoomCard({
  name,
  description,
  room_type,
  status,
  scheduled_at,
  community_name,
  creator_display_name,
  hideCommunityTag = false,
  onPress,
}: CommunityRoomCardProps) {
  const isLive = status === 'live';
  const isScheduled = status === 'scheduled';

  return (
    <TouchableOpacity
      testID="room-card"
      style={[styles.card, !isLive && styles.cardDimmed]}
      onPress={isLive ? onPress : undefined}
      activeOpacity={isLive ? 0.75 : 1}
    >
      <View style={styles.topRow}>
        <Text style={styles.typeIcon}>{room_type === 'video' ? '🎥' : '🎙️'}</Text>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {isLive && <Text style={styles.liveBadge}>● Live</Text>}
        {isScheduled && (
          <Text testID="scheduled-badge" style={styles.scheduledBadge}>
            🕐 {scheduled_at ? format(new Date(scheduled_at), 'dd MMM · HH:mm') : 'Scheduled'}
          </Text>
        )}
      </View>

      {description ? (
        <Text style={styles.description} numberOfLines={1}>{description}</Text>
      ) : null}

      <View style={styles.metaRow}>
        {!hideCommunityTag && community_name ? (
          <Text style={styles.metaTag}>🏘 {community_name}</Text>
        ) : null}
        {creator_display_name ? (
          <Text style={styles.metaTag}>👑 {creator_display_name}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
    gap: 4,
  },
  cardDimmed: {
    opacity: 0.65,
    borderColor: COLORS.textMuted + '30',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeIcon: { fontSize: 18 },
  name: {
    flex: 1,
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  liveBadge: {
    color: COLORS.success,
    fontSize: 11,
    fontWeight: '700',
  },
  scheduledBadge: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  metaTag: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
});
```

- [ ] **Step 4: Run tests to confirm PASS**

```bash
cd apps/mobile && npx jest --testPathPattern=CommunityRoomCard --ci
```

Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/community/CommunityRoomCard.tsx apps/mobile/__tests__/components/CommunityRoomCard.test.tsx
git commit -m "feat(ui): add CommunityRoomCard component with live/scheduled/closed states"
```

---

## Task 8: Rooms tab in community detail

**Files:**
- Modify: `apps/mobile/app/(tabs)/discover/community/[id].tsx`

- [ ] **Step 1: Add RoomRow type, load rooms, and Rooms tab**

In `apps/mobile/app/(tabs)/discover/community/[id].tsx`:

**a) Add import at top:**
```ts
import { CommunityRoomCard } from '../../../../components/community/CommunityRoomCard';
```

**b) Add `RoomRow` type after the `EventRow` type (around line 34):**
```ts
type RoomRow = {
  id: string;
  name: string;
  description: string | null;
  room_type: 'video' | 'audio';
  status: 'live' | 'scheduled' | 'closed';
  scheduled_at: string | null;
  profiles: { display_name: string } | null;
};
```

**c) Update `SubTab` type (line 19) and `TABS` array (line 21):**
```ts
type SubTab = 'posts' | 'events' | 'games' | 'rooms';
const TABS: SubTab[] = ['posts', 'events', 'games', 'rooms'];
```

**d) Add rooms state below the `likedIds` state (around line 54):**
```ts
const [rooms, setRooms] = useState<RoomRow[]>([]);
```

**e) Add `loadRooms` callback below `loadRsvps` (around line 108):**
```ts
const loadRooms = useCallback(async () => {
  if (!id) return;
  const { data } = await supabase
    .from('community_rooms')
    .select('id, name, description, room_type, status, scheduled_at, profiles!community_rooms_created_by_fkey(display_name)')
    .eq('community_id', id)
    .in('status', ['live', 'scheduled'])
    .order('status')
    .order('name');
  if (data) setRooms(data as unknown as RoomRow[]);
}, [id]);
```

**f) Add `loadRooms` to the effect (line 114):**
```ts
useEffect(() => {
  loadPosts();
  loadEvents();
  loadRsvps();
  loadRooms();
}, [loadPosts, loadEvents, loadRsvps, loadRooms]);
```

**g) Add Rooms page inside the horizontal ScrollView, after the Games page (before the closing `</ScrollView>`):**
```tsx
{/* Page 3 — Rooms */}
<ScrollView style={{ width: SCREEN_WIDTH }} contentContainerStyle={{ padding: 12, paddingBottom: 80 }}>
  {rooms.length === 0 ? (
    <View style={styles.emptyCenter}>
      <Text style={styles.emptyIcon}>📡</Text>
      <Text style={styles.emptyTitle}>No rooms open right now</Text>
      <Text style={styles.emptySub}>Check back when the community opens a room.</Text>
    </View>
  ) : (
    rooms.map((room) => (
      <CommunityRoomCard
        key={room.id}
        id={room.id}
        name={room.name}
        description={room.description}
        room_type={room.room_type}
        status={room.status}
        scheduled_at={room.scheduled_at}
        community_name={null}
        creator_display_name={room.profiles?.display_name ?? null}
        hideCommunityTag
        onPress={() => router.push(`/(tabs)/connect/community-room-session?room_id=${room.id}` as any)}
      />
    ))
  )}
</ScrollView>
```

- [ ] **Step 2: Type-check**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(tabs)/discover/community/[id].tsx
git commit -m "feat(ui): add Rooms tab to community detail screen"
```

---

## Task 9: Connect screen — upgrade room cards

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/index.tsx`

- [ ] **Step 1: Add import and update CommunityRoomRow type**

**a) Add import at top of `apps/mobile/app/(tabs)/connect/index.tsx`:**
```ts
import { CommunityRoomCard } from '../../../components/community/CommunityRoomCard';
```

**b) Update `CommunityRoomRow` type (around line 39):**
```ts
type CommunityRoomRow = {
  id: string;
  name: string;
  description: string | null;
  room_type: 'video' | 'audio';
  community_id: string;
  status: 'live' | 'scheduled' | 'closed';
  scheduled_at: string | null;
  communities: { name: string } | null;
  creator: { display_name: string } | null;
};
```

**c) Update the `loadRooms` query (around line 128) to fetch description, status, scheduled_at, and creator:**
```ts
const loadRooms = useCallback(async () => {
  setLoadingRooms(true);
  let roomsQuery = supabase
    .from('community_rooms')
    .select('id, name, description, room_type, community_id, status, scheduled_at, communities(name), creator:profiles!community_rooms_created_by_fkey(display_name)')
    .in('status', ['live', 'scheduled'])
    .order('status')
    .order('name');
  if (selectedCommunityId) {
    roomsQuery = roomsQuery.eq('community_id', selectedCommunityId);
  }
  const [{ data: gamesData }, { data: roomsData }] = await Promise.all([
    supabase.from('games').select('*').eq('is_active', true).order('name'),
    roomsQuery,
  ]);
  if (gamesData) setGames(gamesData as GameRow[]);
  if (roomsData) setRooms(roomsData as unknown as CommunityRoomRow[]);
  setLoadingRooms(false);
}, [selectedCommunityId]);
```

**d) Replace the Community Rooms section render (around line 403–429) with:**
```tsx
{/* Community Rooms */}
<View style={styles.roomSection}>
  <Text style={styles.roomSectionTitle}>📹 Community Rooms</Text>
  {loadingRooms ? (
    <ActivityIndicator color={COLORS.roxy} style={{ marginVertical: 16 }} />
  ) : rooms.length === 0 ? (
    <Text style={styles.roomEmpty}>No rooms active right now</Text>
  ) : (
    rooms.map((room) => (
      <CommunityRoomCard
        key={room.id}
        id={room.id}
        name={room.name}
        description={room.description}
        room_type={room.room_type}
        status={room.status}
        scheduled_at={room.scheduled_at}
        community_name={room.communities?.name ?? null}
        creator_display_name={room.creator?.display_name ?? null}
        hideCommunityTag={!!selectedCommunityId}
        onPress={() => router.push(`/(tabs)/connect/community-room-session?room_id=${room.id}` as any)}
      />
    ))
  )}
</View>
```

- [ ] **Step 2: Type-check**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(tabs)/connect/index.tsx
git commit -m "feat(ui): upgrade Connect rooms tab with rich cards, status, description, host"
```

---

## Task 10: Community room session — multi-participant, host badge, admin mute

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/community-room-session.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  StatusBar, Alert, FlatList, ActionSheetIOS, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { callEdgeFunction } from '../../../lib/supabase';
import { DailyProvider } from '../../../lib/video';
import { useVideoCall } from '../../../hooks/useVideoCall';
import { COLORS } from '../../../lib/constants';
import { logError } from '../../../lib/errorLogger';
import type { RemoteParticipant } from '../../../lib/video/VideoCallProvider';

type RoomType = 'video' | 'audio';

export default function CommunityRoomSession() {
  const { room_id } = useLocalSearchParams<{ room_id: string }>();
  const router = useRouter();

  const [provider] = useState(() => new DailyProvider());
  const { state, remoteParticipants } = useVideoCall(provider);

  const [micOn, setMicOn] = useState(false); // start muted
  const [camOn, setCamOn] = useState(true);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [roomType, setRoomType] = useState<RoomType>('video');
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    if (!room_id) return;
    (async () => {
      try {
        const { data } = await callEdgeFunction<{
          room_url: string;
          room_name: string;
          room_type: RoomType;
          token: string | null;
          is_host: boolean;
        }>('join-community-room', { room_id });

        if (!data?.room_url) throw new Error('No room URL returned');

        setRoomName(data.room_name ?? null);
        setRoomType(data.room_type ?? 'video');
        setIsHost(data.is_host ?? false);

        await provider.join({
          roomUrl: data.room_url,
          token: data.token ?? undefined,
          startAudioOff: true,
        });
      } catch (e: any) {
        logError(e, 'communityRoomSession_join');
        if (e?.message?.includes('409') || e?.message?.includes('not started')) {
          Alert.alert('Not open yet', 'This room has not started yet.');
        } else if (e?.message?.includes('410') || e?.message?.includes('closed')) {
          Alert.alert('Room closed', 'This room has ended.');
        } else {
          Alert.alert('Error', 'Failed to join room. Please try again.');
        }
        router.back();
      }
    })();
    return () => {
      provider.leave().catch(() => {});
      provider.destroy();
    };
  }, [room_id]);

  const handleLeave = () => {
    Alert.alert('Leave Room?', 'Are you sure you want to leave?', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive',
        onPress: () => {
          provider.leave().catch(() => {});
          router.back();
        },
      },
    ]);
  };

  const toggleMic = () => {
    provider.toggleMic();
    setMicOn((v) => !v);
  };

  const toggleCam = () => {
    provider.toggleCamera();
    setCamOn((v) => !v);
  };

  const handleParticipantLongPress = (participant: RemoteParticipant) => {
    if (!isHost) return;
    const name = participant.displayName ?? 'this participant';
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [`Mute ${name}`, 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
        (index) => { if (index === 0) provider.muteParticipant(participant.id); }
      );
    } else {
      Alert.alert(`Mute ${name}?`, '', [
        { text: 'Mute', style: 'destructive', onPress: () => provider.muteParticipant(participant.id) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const participantCount = remoteParticipants.length + 1; // +1 for self

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Top bar */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <View style={styles.topBarInner}>
          <TouchableOpacity onPress={handleLeave} style={styles.backBtn}>
            <Ionicons name="arrow-back-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.roomTitle} numberOfLines={1}>{roomName ?? 'Community Room'}</Text>
          <View style={styles.statusPill}>
            <View style={[styles.dot, state === 'connected' && styles.dotLive]} />
            <Text style={styles.statusText}>
              {state === 'connected' ? `${participantCount}` : state}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Main content — video grid or audio bubbles */}
      {state === 'connected' || state === 'connecting' ? (
        roomType === 'video'
          ? <VideoGrid
              remoteParticipants={remoteParticipants}
              provider={provider}
              isHost={isHost}
              onParticipantLongPress={handleParticipantLongPress}
            />
          : <AudioGrid
              remoteParticipants={remoteParticipants}
              isHost={isHost}
              onParticipantLongPress={handleParticipantLongPress}
            />
      ) : (
        <View style={styles.centerPlaceholder}>
          <ActivityIndicator color={COLORS.roxy} size="large" />
          <Text style={styles.placeholderText}>Connecting...</Text>
        </View>
      )}

      {/* Self PiP — video rooms only */}
      {roomType === 'video' && (
        <View style={styles.selfPip}>
          {provider.renderLocalVideo(StyleSheet.absoluteFillObject) ?? (
            <View style={[StyleSheet.absoluteFillObject, styles.pipPlaceholder]}>
              <Text style={styles.pipIcon}>👤</Text>
            </View>
          )}
        </View>
      )}

      {/* Bottom controls */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.controlBtn, !micOn && styles.controlBtnOff]}
            onPress={toggleMic}
          >
            <Ionicons name={micOn ? 'mic-outline' : 'mic-off-outline'} size={22} color="#fff" />
          </TouchableOpacity>
          {roomType === 'video' && (
            <TouchableOpacity
              style={[styles.controlBtn, !camOn && styles.controlBtnOff]}
              onPress={toggleCam}
            >
              <Ionicons name={camOn ? 'videocam-outline' : 'videocam-off-outline'} size={22} color="#fff" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.controlBtn, styles.controlBtnLeave]} onPress={handleLeave}>
            <Ionicons name="call-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

// ── Video grid ────────────────────────────────────────────────────────────────

function VideoGrid({
  remoteParticipants, provider, isHost, onParticipantLongPress,
}: {
  remoteParticipants: RemoteParticipant[];
  provider: DailyProvider;
  isHost: boolean;
  onParticipantLongPress: (p: RemoteParticipant) => void;
}) {
  if (remoteParticipants.length === 0) {
    return (
      <View style={styles.centerPlaceholder}>
        <Text style={styles.placeholderIcon}>🎥</Text>
        <Text style={styles.placeholderText}>Waiting for others...</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={remoteParticipants}
      keyExtractor={(p) => p.id}
      numColumns={2}
      style={styles.videoGrid}
      contentContainerStyle={styles.videoGridContent}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.videoTile}
          onLongPress={() => onParticipantLongPress(item)}
          delayLongPress={500}
          activeOpacity={0.9}
        >
          {provider.renderRemoteVideo(item, StyleSheet.absoluteFillObject) ?? (
            <View style={[StyleSheet.absoluteFillObject, styles.videoTilePlaceholder]}>
              <Text style={styles.tileInitial}>
                {item.displayName?.[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
          <View style={styles.tileOverlay}>
            <Text style={styles.tileName} numberOfLines={1}>{item.displayName ?? 'Guest'}</Text>
            {item.isOwner && <Text style={styles.hostBadge}>👑</Text>}
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

// ── Audio bubble grid ─────────────────────────────────────────────────────────

function AudioGrid({
  remoteParticipants, isHost, onParticipantLongPress,
}: {
  remoteParticipants: RemoteParticipant[];
  isHost: boolean;
  onParticipantLongPress: (p: RemoteParticipant) => void;
}) {
  if (remoteParticipants.length === 0) {
    return (
      <View style={styles.centerPlaceholder}>
        <Text style={styles.placeholderIcon}>🎙️</Text>
        <Text style={styles.placeholderText}>Waiting for others...</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={remoteParticipants}
      keyExtractor={(p) => p.id}
      numColumns={3}
      style={styles.audioGrid}
      contentContainerStyle={styles.audioGridContent}
      renderItem={({ item }) => {
        const p = item.trackInfo as any;
        const audioOn = p?.tracks?.audio?.state === 'playable';
        return (
          <TouchableOpacity
            style={styles.audioBubbleWrap}
            onLongPress={() => onParticipantLongPress(item)}
            delayLongPress={500}
            activeOpacity={0.8}
          >
            <View style={[styles.avatarRing, audioOn && styles.avatarRingActive]}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>
                  {item.displayName?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
            </View>
            <Text style={styles.audioBubbleName} numberOfLines={1}>
              {item.displayName ?? 'Guest'}
              {item.isOwner ? ' 👑' : ''}
            </Text>
            {!audioOn && <Text style={styles.mutedIndicator}>🔇</Text>}
          </TouchableOpacity>
        );
      }}
    />
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  topBarInner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backBtn: { padding: 4 },
  roomTitle: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 15 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.textMuted },
  dotLive: { backgroundColor: COLORS.success },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600' },

  centerPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 12, marginTop: 80,
  },
  placeholderIcon: { fontSize: 48 },
  placeholderText: { color: COLORS.textMuted, fontSize: 16 },

  // Video grid
  videoGrid: { flex: 1, marginTop: 80 },
  videoGridContent: { padding: 8, paddingBottom: 100 },
  videoTile: {
    flex: 1, margin: 4, aspectRatio: 0.75,
    backgroundColor: COLORS.surface, borderRadius: 12, overflow: 'hidden',
  },
  videoTilePlaceholder: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surfaceLight,
  },
  tileInitial: { fontSize: 32, color: COLORS.textSecondary, fontWeight: '700' },
  tileOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 4,
  },
  tileName: { flex: 1, color: '#fff', fontSize: 11, fontWeight: '600' },
  hostBadge: { fontSize: 12 },

  // Self PiP
  selfPip: {
    position: 'absolute', top: 100, right: 16,
    width: 90, height: 130, borderRadius: 12,
    overflow: 'hidden', backgroundColor: COLORS.surface,
    borderWidth: 2, borderColor: COLORS.primary, zIndex: 10,
  },
  pipPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  pipIcon: { fontSize: 24 },

  // Audio grid
  audioGrid: { flex: 1, marginTop: 80 },
  audioGridContent: { padding: 16, paddingBottom: 100 },
  audioBubbleWrap: {
    flex: 1, margin: 8, alignItems: 'center', gap: 6,
  },
  avatarRing: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  avatarRingActive: { borderColor: COLORS.primary },
  avatarCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 24, color: COLORS.textPrimary, fontWeight: '700' },
  audioBubbleName: {
    color: COLORS.textSecondary, fontSize: 11, fontWeight: '600',
    textAlign: 'center', maxWidth: 80,
  },
  mutedIndicator: { fontSize: 12 },

  // Controls
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20 },
  controls: {
    flexDirection: 'row', justifyContent: 'center', gap: 16,
    paddingVertical: 12, paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  controlBtn: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  controlBtnOff: { backgroundColor: 'rgba(255,255,255,0.1)' },
  controlBtnLeave: { backgroundColor: COLORS.error },
});
```

- [ ] **Step 2: Type-check**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(tabs)/connect/community-room-session.tsx
git commit -m "feat(ui): upgrade room session — multi-participant grid, audio/video modes, host badge, admin mute"
```

---

## Task 11: QA loop

- [ ] **Step 1: Lint**

```bash
cd apps/mobile && npx eslint . --ext .ts,.tsx --max-warnings 0
```

Expected: 0 warnings, 0 errors. Fix any issues before continuing.

- [ ] **Step 2: TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: All previous tests pass + new CommunityRoomCard (8) + useVideoCall (4) tests pass.

- [ ] **Step 4: Push migrations to remote (if Supabase project is linked)**

```bash
npx supabase db push --linked
```

Expected: migrations 025 and 026 applied.

- [ ] **Step 5: Manual checklist**

```
[ ] Join a live room → connects, starts muted, video renders (fixes Speed Dating video bug too)
[ ] Long-press remote participant as admin → mute option appears
[ ] Long-press as non-admin → nothing happens
[ ] Tap a scheduled room card → does not navigate (non-tappable)
[ ] Community filter in Connect → rooms filter correctly
[ ] Audio room → shows avatar bubbles, no video tiles
[ ] Video room → shows 2-col tile grid, name overlay, host crown
[ ] hideCommunityTag=true in community detail → no community tag shown
[ ] Connect screen → community name shows in card, hidden when filter active
```

- [ ] **Step 6: Update spec to note participant count in list is deferred**

Add to spec file `docs/superpowers/specs/2026-04-12-community-rooms-design.md` under Out of Scope:
```
- Live participant count in list view (requires Daily.co webhook → participant_count column)
```

- [ ] **Step 7: Final commit**

```bash
git add docs/superpowers/specs/2026-04-12-community-rooms-design.md
git commit -m "docs: update community rooms spec — note participant count deferred"
```

---

## Self-Review

**Spec coverage check:**
| Requirement | Task |
|---|---|
| status (live/scheduled/closed) | Task 1, 7, 8, 9 |
| scheduled_at timestamp | Task 1, 2 |
| Seed with mixed statuses | Task 2 |
| Video bug fix (participant-updated) | Task 5 |
| Start muted | Task 5, 10 |
| Multi-participant grid | Task 5, 6, 10 |
| Audio bubble grid | Task 10 |
| Host badge (👑) | Task 6, 7, 10 |
| Admin mute | Task 5, 6, 10 |
| Meeting token with is_owner | Task 6 |
| CommunityRoomCard (live/scheduled states) | Task 7 |
| Rooms tab in community detail | Task 8 |
| Connect rooms upgrade with filter | Task 9 |
| Description in card | Task 7, 8, 9 |
| Community tag in card | Task 7, 9 |
| hideCommunityTag for community detail | Task 7, 8 |
| 409/410 error handling for non-live rooms | Task 6, 10 |

All requirements covered. No gaps.
