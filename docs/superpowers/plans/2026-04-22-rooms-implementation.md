# Rooms Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement end-to-end community rooms (audio + video) across Supabase, Studio (host dashboard), and the Roxy mobile client — so community admins can create, schedule, open, and manage live video/audio group rooms, while members join from mobile.

**Architecture:** `community_rooms` table already exists (migration 016 + 025); this plan extends it with `participant_count`, `max_participants`, `started_at`, `ended_at`, and changes status from 3 values to 4 ('idle' added). Three new Supabase Edge Functions handle room lifecycle (`manage-room`), host kick (`kick-participant`), and participant count updates from Daily.co webhooks (`daily-webhook`). Studio gets a full `/rooms` list page and `/rooms/[id]` browser video session using `@daily-co/daily-js`. Mobile `CommunityRoomCard` gains participant ratio display; the community detail screen's Realtime subscription keeps it live.

**Tech Stack:** Supabase (Postgres, Edge Functions, Realtime), Daily.co REST API + `@daily-co/daily-js` (Studio browser), `@daily-co/react-native-daily-js` (mobile, already installed and guarded), Next.js 16 App Router, React Native / Expo Router.

---

## Existing code — do NOT recreate

| File | What it already does |
|---|---|
| `supabase/migrations/016_rooms_games.sql` | Creates `community_rooms` (name, room_type, daily_room_url, daily_room_name, is_active, created_by) |
| `supabase/migrations/025_room_status.sql` | Adds `status` (live/scheduled/closed), `scheduled_at` |
| `supabase/functions/join-community-room/index.ts` | Issues Daily.co tokens, checks membership, handles status 409/410 |
| `apps/mobile/app/(tabs)/connect/community-room-session.tsx` | Full mobile video grid session screen |
| `apps/mobile/components/community/CommunityRoomCard.tsx` | Existing card (needs participant count added) |
| `apps/mobile/app/(tabs)/discover/community/[id].tsx` | Community detail with rooms tab (needs loadRooms query update) |
| `apps/studio/components/AppSidebar.tsx` | Rooms nav item already present |

**Key schema facts (use these exact names everywhere):**
- Column `name` (not `title`), `created_by` (not `host_id`)
- Status values after migration 042: `'idle' | 'live' | 'scheduled' | 'closed'`
- `successResponse({ x })` → `supabase.functions.invoke` returns `{ data: { success, data: { x } } }` → read as `res.data?.data?.x`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `supabase/migrations/042_rooms_v2.sql` | Add participant_count, max_participants, started_at, ended_at; add 'idle' to status CHECK; fix RLS INSERT; add SQL helpers; pg_cron |
| Create | `supabase/functions/manage-room/index.ts` | create / update / open / close actions for rooms |
| Create | `supabase/functions/kick-participant/index.ts` | Eject a participant from Daily.co, verifying caller is host/admin |
| Create | `supabase/functions/daily-webhook/index.ts` | Receives Daily.co webhook, verifies HMAC, increments/decrements participant_count |
| Modify | `apps/studio/package.json` | Add `@daily-co/daily-js` dependency |
| Modify | `apps/studio/app/(dashboard)/rooms/page.tsx` | Replace stub with server component fetching rooms |
| Create | `apps/studio/app/(dashboard)/rooms/RoomsClient.tsx` | Client: room cards (LIVE/SCHEDULED/IDLE), T-15 banner, create modal trigger, Go Live → navigate |
| Create | `apps/studio/app/(dashboard)/rooms/RoomModal.tsx` | Create/edit room form modal |
| Create | `apps/studio/app/(dashboard)/rooms/[id]/page.tsx` | Daily.co browser session: video grid, host controls, End Room |
| Modify | `apps/mobile/components/community/CommunityRoomCard.tsx` | Add participant_count / max_participants props and ratio display |
| Modify | `apps/mobile/app/(tabs)/discover/community/[id].tsx` | Select participant_count/max_participants, pass to CommunityRoomCard, add Realtime subscription |

---

## Task 1: Migration 042 — extend community_rooms

**Files:**
- Create: `supabase/migrations/042_rooms_v2.sql`

- [ ] **Step 1: Write migration**

```sql
-- 042_rooms_v2.sql
-- Extend community_rooms with participant tracking, timing, and corrected RLS

-- 1. Add new columns
ALTER TABLE community_rooms
  ADD COLUMN IF NOT EXISTS participant_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_participants   INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS started_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at           TIMESTAMPTZ;

-- 2. Add 'idle' to status CHECK (drop old, add new)
ALTER TABLE community_rooms DROP CONSTRAINT IF EXISTS community_rooms_status_check;
ALTER TABLE community_rooms
  ADD CONSTRAINT community_rooms_status_check
  CHECK (status IN ('idle', 'live', 'scheduled', 'closed'));

-- 3. Fix INSERT RLS: was based on can_create_room profile flag — change to admin/mod role
DROP POLICY IF EXISTS "community_rooms_insert" ON community_rooms;
CREATE POLICY "community_rooms_insert" ON community_rooms FOR INSERT
  WITH CHECK (
    created_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM community_members
      WHERE community_id = community_rooms.community_id
        AND user_id = auth.uid()
        AND role IN ('admin', 'moderator')
    )
  );

-- 4. Add UPDATE policy (host, admin, or moderator)
DROP POLICY IF EXISTS "community_rooms_update" ON community_rooms;
CREATE POLICY "community_rooms_update" ON community_rooms FOR UPDATE
  USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM community_members
      WHERE community_id = community_rooms.community_id
        AND user_id = auth.uid()
        AND role IN ('admin', 'moderator')
    )
  );

-- 5. SQL helper functions for atomic participant count updates
CREATE OR REPLACE FUNCTION increment_participant_count(p_room_name TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE community_rooms
  SET participant_count = GREATEST(0, participant_count + 1)
  WHERE daily_room_name = p_room_name AND status = 'live';
$$;

CREATE OR REPLACE FUNCTION decrement_participant_count(p_room_name TEXT)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE community_rooms
  SET participant_count = GREATEST(0, participant_count - 1)
  WHERE daily_room_name = p_room_name AND status = 'live';
$$;

-- 6. pg_cron: auto-close empty live rooms after 5 min
SELECT cron.schedule(
  'close-empty-rooms',
  '*/5 * * * *',
  $$
    UPDATE community_rooms
    SET status = 'closed', ended_at = now()
    WHERE status = 'live'
      AND participant_count = 0
      AND started_at < now() - interval '5 minutes';
  $$
);

-- 7. Index for webhook lookup by daily_room_name
CREATE INDEX IF NOT EXISTS community_rooms_daily_room_name_idx
  ON community_rooms(daily_room_name)
  WHERE daily_room_name IS NOT NULL;
```

- [ ] **Step 2: Push migration**

```bash
npx supabase db push --linked
```

Expected output: migration applied, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/042_rooms_v2.sql
git commit -m "feat(db): extend community_rooms — participant_count, max_participants, idle status, corrected RLS, pg_cron"
```

---

## Task 2: manage-room edge function

**Files:**
- Create: `supabase/functions/manage-room/index.ts`

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/manage-room/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

async function createDailyRoom(
  roomName: string,
  maxParticipants: number | null,
  apiKey: string,
): Promise<{ url: string; name: string }> {
  const res = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: roomName,
      privacy: 'private',
      properties: {
        exp: Math.floor(Date.now() / 1000) + 43200, // 12h
        max_participants: maxParticipants ?? 50,
        enable_screenshare: true,
        enable_chat: false,
        start_video_off: false,
        start_audio_off: false,
        eject_at_room_exp: true,
      },
    }),
  });
  if (!res.ok) throw new Error(`Daily.co room creation failed: ${await res.text()}`);
  const room = await res.json();
  return { url: room.url, name: room.name };
}

async function deleteDailyRoom(roomName: string, apiKey: string): Promise<void> {
  await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  let action: string, roomId: string | undefined, communityId: string | undefined,
      name: string | undefined, description: string | undefined, roomType: string | undefined,
      scheduledAt: string | null | undefined, maxParticipants: number | null | undefined;

  try {
    const body = await req.json();
    action      = body.action;
    roomId      = body.room_id;
    communityId = body.community_id;
    name        = body.name;
    description = body.description;
    roomType    = body.room_type;
    scheduledAt = body.scheduled_at;
    maxParticipants = body.max_participants;
  } catch { return errorResponse('Invalid body', 400); }

  if (!action) return errorResponse('action required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
  const supabase = getSupabaseClient();
  const dailyApiKey = Deno.env.get('DAILY_API_KEY');

  // ── CREATE ────────────────────────────────────────────────────────────────
  if (action === 'create') {
    if (!communityId || !name) return errorResponse('community_id and name required', 400);

    const { data: membership } = await supabase
      .from('community_members')
      .select('role')
      .eq('community_id', communityId)
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (!membership || !['admin', 'moderator'].includes(membership.role)) {
      return errorResponse('Only community admins or moderators can create rooms', 403);
    }

    const status = scheduledAt ? 'scheduled' : 'idle';
    const { data: room, error } = await supabase
      .from('community_rooms')
      .insert({
        community_id:     communityId,
        name:             name.trim(),
        description:      description?.trim() ?? null,
        room_type:        roomType ?? 'video',
        scheduled_at:     scheduledAt ?? null,
        max_participants: maxParticipants ?? null,
        created_by:       auth.userId,
        status,
        is_active:        false,
      })
      .select('id')
      .single();

    if (error) return errorResponse(error.message, 500);
    return successResponse({ room_id: room.id });
  }

  // All other actions require room_id
  if (!roomId) return errorResponse('room_id required', 400);

  const { data: room } = await supabase
    .from('community_rooms')
    .select('id, name, status, created_by, community_id, daily_room_name, daily_room_url, max_participants')
    .eq('id', roomId)
    .single();

  if (!room) return errorResponse('Room not found', 404);

  const { data: membership } = await supabase
    .from('community_members')
    .select('role')
    .eq('community_id', room.community_id)
    .eq('user_id', auth.userId)
    .maybeSingle();

  const canManage = auth.userId === room.created_by ||
    (membership && ['admin', 'moderator'].includes(membership.role));
  if (!canManage) return errorResponse('Access denied', 403);

  // ── UPDATE ────────────────────────────────────────────────────────────────
  if (action === 'update') {
    const updates: Record<string, unknown> = {};
    if (name          !== undefined) updates.name             = name.trim();
    if (description   !== undefined) updates.description      = description?.trim() ?? null;
    if (roomType      !== undefined) updates.room_type        = roomType;
    if (maxParticipants !== undefined) updates.max_participants = maxParticipants;
    if (scheduledAt   !== undefined) {
      updates.scheduled_at = scheduledAt;
      if (scheduledAt && room.status === 'idle') updates.status = 'scheduled';
      if (!scheduledAt && room.status === 'scheduled') updates.status = 'idle';
    }
    if (Object.keys(updates).length === 0) return errorResponse('No fields to update', 400);
    const { error } = await supabase.from('community_rooms').update(updates).eq('id', roomId);
    if (error) return errorResponse(error.message, 500);
    return successResponse({ updated: true });
  }

  // ── OPEN (Go Live) ────────────────────────────────────────────────────────
  if (action === 'open') {
    if (room.status === 'live') return successResponse({ already_live: true, room_id: roomId });

    if (DEV_MOCK) {
      await supabase.from('community_rooms')
        .update({ status: 'live', started_at: new Date().toISOString(), is_active: true })
        .eq('id', roomId);
      return successResponse({ room_id: roomId });
    }

    if (!dailyApiKey) return errorResponse('DAILY_API_KEY not configured', 503);

    let dailyRoomName = (room.daily_room_name as string | null) ?? `roxy-room-${roomId.slice(0, 8)}`;
    let dailyRoomUrl  = room.daily_room_url as string | null;

    if (!dailyRoomUrl) {
      try {
        const created = await createDailyRoom(dailyRoomName, room.max_participants as number | null, dailyApiKey);
        dailyRoomUrl  = created.url;
        dailyRoomName = created.name;
      } catch (e) {
        return errorResponse(e instanceof Error ? e.message : 'Failed to create video room', 500);
      }
    }

    const { error } = await supabase.from('community_rooms').update({
      status:          'live',
      started_at:      new Date().toISOString(),
      daily_room_name: dailyRoomName,
      daily_room_url:  dailyRoomUrl,
      is_active:       true,
    }).eq('id', roomId);

    if (error) return errorResponse(error.message, 500);
    return successResponse({ room_id: roomId });
  }

  // ── CLOSE (End Room) ──────────────────────────────────────────────────────
  if (action === 'close') {
    if (room.status === 'closed') return successResponse({ already_closed: true });

    if (!DEV_MOCK && dailyApiKey && room.daily_room_name) {
      await deleteDailyRoom(room.daily_room_name as string, dailyApiKey);
    }

    const { error } = await supabase.from('community_rooms').update({
      status:    'closed',
      ended_at:  new Date().toISOString(),
      is_active: false,
    }).eq('id', roomId);

    if (error) return errorResponse(error.message, 500);
    return successResponse({ closed: true });
  }

  return errorResponse(`Unknown action: ${action}`, 400);
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy manage-room --project-ref ptymtdlysqbpxzlgsshp
```

Expected: `Deployed manage-room`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/manage-room/index.ts
git commit -m "feat(functions): manage-room — create/update/open/close community rooms"
```

---

## Task 3: kick-participant edge function

**Files:**
- Create: `supabase/functions/kick-participant/index.ts`

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/kick-participant/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  let roomId: string, sessionId: string;
  try {
    const body = await req.json();
    roomId    = body.room_id;
    sessionId = body.session_id; // Daily.co participant session_id
  } catch { return errorResponse('Invalid body', 400); }

  if (!roomId || !sessionId) return errorResponse('room_id and session_id required', 400);

  const supabase = getSupabaseClient();
  const { data: room } = await supabase
    .from('community_rooms')
    .select('created_by, daily_room_name, community_id')
    .eq('id', roomId)
    .single();

  if (!room) return errorResponse('Room not found', 404);

  const { data: membership } = await supabase
    .from('community_members')
    .select('role')
    .eq('community_id', room.community_id)
    .eq('user_id', auth.userId)
    .maybeSingle();

  const canManage = auth.userId === room.created_by ||
    (membership && ['admin', 'moderator'].includes(membership.role));
  if (!canManage) return errorResponse('Access denied', 403);

  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) return errorResponse('DAILY_API_KEY not configured', 503);

  const res = await fetch(`https://api.daily.co/v1/rooms/${room.daily_room_name}/eject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${dailyApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [sessionId] }),
  });

  if (!res.ok) return errorResponse(`Kick failed: ${await res.text()}`, 500);
  return successResponse({ kicked: true });
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy kick-participant --project-ref ptymtdlysqbpxzlgsshp
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/kick-participant/index.ts
git commit -m "feat(functions): kick-participant — eject participant from Daily.co room"
```

---

## Task 4: daily-webhook edge function

**Files:**
- Create: `supabase/functions/daily-webhook/index.ts`

This function has **no JWT auth** — it's called by Daily.co's servers, not by the app. Authentication is via HMAC-SHA256 signature on the request body using `DAILY_WEBHOOK_SECRET`.

Daily.co sends: `POST` with `x-daily-signature: v1=<hex_hmac>` header.
Event payload shape: `{ event_type: 'participant-joined' | 'participant-left', payload: { room: { name: string } } }`

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/daily-webhook/index.ts
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get('DAILY_WEBHOOK_SECRET');
  if (!secret || !header) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = 'v1=' + Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  // Constant-time compare
  if (header.length !== computed.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) {
    diff |= header.charCodeAt(i) ^ computed.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const rawBody = await req.text();
  const sigHeader = req.headers.get('x-daily-signature');

  if (!await verifySignature(rawBody, sigHeader)) {
    return errorResponse('Invalid signature', 401);
  }

  let payload: { event_type: string; payload?: { room?: { name?: string } } };
  try { payload = JSON.parse(rawBody); } catch { return errorResponse('Invalid JSON', 400); }

  const eventType = payload.event_type;
  const roomName  = payload.payload?.room?.name;

  if (!roomName) return successResponse({ ignored: 'no room name' });

  const supabase = getSupabaseClient();

  if (eventType === 'participant-joined') {
    await supabase.rpc('increment_participant_count', { p_room_name: roomName });
  } else if (eventType === 'participant-left') {
    await supabase.rpc('decrement_participant_count', { p_room_name: roomName });
  }

  return successResponse({ processed: eventType });
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy daily-webhook --project-ref ptymtdlysqbpxzlgsshp --no-verify-jwt
```

Note: `--no-verify-jwt` because Daily.co calls this endpoint without a Supabase JWT.

- [ ] **Step 3: Set DAILY_WEBHOOK_SECRET**

Go to Daily.co dashboard → Webhooks → create a webhook pointing to:
`https://ptymtdlysqbpxzlgsshp.supabase.co/functions/v1/daily-webhook`

Copy the webhook secret, then:
```bash
npx supabase secrets set DAILY_WEBHOOK_SECRET=<value> --project-ref ptymtdlysqbpxzlgsshp
```

Events to subscribe: `participant-joined`, `participant-left`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/daily-webhook/index.ts
git commit -m "feat(functions): daily-webhook — HMAC-verified participant count sync from Daily.co"
```

---

## Task 5: Install @daily-co/daily-js in Studio

**Files:**
- Modify: `apps/studio/package.json`

- [ ] **Step 1: Install**

```bash
cd apps/studio && npm install @daily-co/daily-js
```

Expected: package added to `dependencies` in `apps/studio/package.json`.

- [ ] **Step 2: Verify**

```bash
cd apps/studio && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/package.json apps/studio/package-lock.json
git commit -m "feat(studio): install @daily-co/daily-js for browser video rooms"
```

---

## Task 6: Studio — RoomModal component

**Files:**
- Create: `apps/studio/app/(dashboard)/rooms/RoomModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';

interface Community { id: string; name: string }

interface RoomModalProps {
  communities: Community[];
  onClose: () => void;
  onCreated: (roomId: string) => void;
  /** Pass existing room data to edit rather than create */
  editRoom?: {
    id: string;
    name: string;
    description: string | null;
    room_type: 'video' | 'audio';
    community_id: string;
    scheduled_at: string | null;
    max_participants: number | null;
  };
}

export function RoomModal({ communities, onClose, onCreated, editRoom }: RoomModalProps) {
  const isEdit = !!editRoom;

  const [name, setName]         = useState(editRoom?.name ?? '');
  const [description, setDesc]  = useState(editRoom?.description ?? '');
  const [roomType, setRoomType] = useState<'video' | 'audio'>(editRoom?.room_type ?? 'video');
  const [communityId, setCommunityId] = useState(editRoom?.community_id ?? communities[0]?.id ?? '');
  const [scheduleEnabled, setScheduleEnabled] = useState(!!editRoom?.scheduled_at);
  const [scheduledAt, setScheduledAt] = useState(
    editRoom?.scheduled_at
      ? new Date(editRoom.scheduled_at).toISOString().slice(0, 16)
      : ''
  );
  const [maxParticipants, setMaxParticipants] = useState(
    editRoom?.max_participants?.toString() ?? ''
  );
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    if (!communityId)  { setError('Select a community'); return; }

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: res } = await supabase.functions.invoke('manage-room', {
      body: {
        action:          isEdit ? 'update' : 'create',
        room_id:         isEdit ? editRoom!.id : undefined,
        community_id:    isEdit ? undefined : communityId,
        name:            name.trim(),
        description:     description.trim() || null,
        room_type:       roomType,
        scheduled_at:    scheduleEnabled && scheduledAt
                           ? new Date(scheduledAt).toISOString()
                           : null,
        max_participants: maxParticipants ? parseInt(maxParticipants, 10) : null,
      },
    });

    setLoading(false);
    const roomId = res?.data?.room_id ?? editRoom?.id;
    if (roomId) {
      onCreated(roomId);
      onClose();
    } else {
      setError('Failed to save room. Please try again.');
    }
  };

  const modal = (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-card border rounded-xl p-6 w-full max-w-md space-y-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{isEdit ? 'Edit Room' : 'Create Room'}</h2>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="room-name">Room name</Label>
          <Input id="room-name" value={name} onChange={e => setName(e.target.value)} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="room-desc">Description (optional)</Label>
          <Textarea
            id="room-desc"
            value={description}
            onChange={e => setDesc(e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>

        {!isEdit && (
          <div className="space-y-1.5">
            <Label htmlFor="community">Community</Label>
            <select
              id="community"
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={communityId}
              onChange={e => setCommunityId(e.target.value)}
            >
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Room type</Label>
          <div className="flex gap-3">
            {(['video', 'audio'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setRoomType(t)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  roomType === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                {t === 'video' ? '🎥 Video' : '🎤 Audio'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="schedule"
              checked={scheduleEnabled}
              onChange={e => setScheduleEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="schedule">Schedule for later</Label>
          </div>
          {scheduleEnabled && (
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cap">Capacity (optional — blank = no limit)</Label>
          <Input
            id="cap"
            type="number"
            min="2"
            max="150"
            placeholder="e.g. 20"
            value={maxParticipants}
            onChange={e => setMaxParticipants(e.target.value)}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Room'}
          </Button>
        </div>
      </form>
    </div>
  );

  return createPortal(modal, document.body);
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/studio && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/app/(dashboard)/rooms/RoomModal.tsx
git commit -m "feat(studio): RoomModal — create/edit room form with schedule + capacity"
```

---

## Task 7: Studio — RoomsClient component

**Files:**
- Create: `apps/studio/app/(dashboard)/rooms/RoomsClient.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoomModal } from './RoomModal';

interface Room {
  id: string;
  name: string;
  description: string | null;
  room_type: 'video' | 'audio';
  status: 'idle' | 'live' | 'scheduled' | 'closed';
  participant_count: number;
  max_participants: number | null;
  scheduled_at: string | null;
  started_at: string | null;
  community_id: string;
  community_name: string;
}

interface Community { id: string; name: string }

interface RoomsClientProps {
  rooms: Room[];
  communities: Community[];
}

function formatDuration(startedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function minutesUntil(scheduledAt: string): number {
  return Math.floor((new Date(scheduledAt).getTime() - Date.now()) / 60000);
}

function ParticipantRatio({ count, max }: { count: number; max: number | null }) {
  const text = max != null ? `${count} / ${max}` : `${count}`;
  return (
    <span className="text-xs font-mono text-muted-foreground tabular-nums">{text}</span>
  );
}

export function RoomsClient({ rooms: initialRooms, communities }: RoomsClientProps) {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [showModal, setShowModal] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check every 30s for T-15 banner and participant count refreshes
  useEffect(() => {
    const interval = setInterval(() => setRooms(r => [...r]), 30000);
    return () => clearInterval(interval);
  }, []);

  // Find any scheduled room within 15 min
  const imminentRoom = rooms.find(
    r => r.status === 'scheduled' && r.scheduled_at && minutesUntil(r.scheduled_at) <= 15 && minutesUntil(r.scheduled_at) >= 0
  );

  const goLive = async (roomId: string) => {
    setLoadingId(roomId);
    setError(null);
    const supabase = createClient();
    const { data: res } = await supabase.functions.invoke('manage-room', {
      body: { action: 'open', room_id: roomId },
    });
    setLoadingId(null);

    if (res?.data?.room_id || res?.data?.already_live) {
      router.push(`/rooms/${roomId}`);
    } else {
      setError('Failed to go live. Please try again.');
    }
  };

  const endRoom = async (roomId: string) => {
    if (!confirm('End this room for all participants?')) return;
    setLoadingId(roomId);
    const supabase = createClient();
    await supabase.functions.invoke('manage-room', {
      body: { action: 'close', room_id: roomId },
    });
    setLoadingId(null);
    setRooms(prev => prev.map(r => r.id === roomId ? { ...r, status: 'closed' } : r));
  };

  const activeRooms = rooms.filter(r => r.status !== 'closed');
  const closedRooms = rooms.filter(r => r.status === 'closed');

  const modalCommunities = editRoom
    ? communities
    : communities;

  return (
    <div className="space-y-6">
      {/* T-15 banner */}
      {imminentRoom && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <p className="text-sm font-medium text-primary">
            <span className="font-bold">{imminentRoom.name}</span> starts in{' '}
            {minutesUntil(imminentRoom.scheduled_at!)} min
          </p>
          <Button size="sm" onClick={() => goLive(imminentRoom.id)} disabled={loadingId === imminentRoom.id}>
            {loadingId === imminentRoom.id ? 'Starting…' : 'Go Live Now'}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rooms</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Create and manage audio and video rooms for your communities.
          </p>
        </div>
        <Button onClick={() => { setEditRoom(null); setShowModal(true); }}>
          + Create Room
        </Button>
      </div>

      {/* Active rooms */}
      {activeRooms.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm">No active rooms.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Create a room to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeRooms.map(room => {
            const isLive = room.status === 'live';
            const isScheduled = room.status === 'scheduled';
            const minsUntil = isScheduled && room.scheduled_at ? minutesUntil(room.scheduled_at) : null;
            const showGoLive = isScheduled && minsUntil !== null && minsUntil <= 15;

            return (
              <div
                key={room.id}
                className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3"
              >
                {/* Status dot */}
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                  isLive ? 'bg-green-500' : isScheduled ? 'bg-yellow-400' : 'bg-muted-foreground/30'
                }`} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{room.name}</span>
                    <Badge variant={isLive ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                      {room.room_type === 'video' ? '🎥' : '🎤'}{' '}
                      {isLive ? 'LIVE' : isScheduled ? 'SCHEDULED' : 'IDLE'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {room.community_name}
                    {isLive && room.started_at && ` · ${formatDuration(room.started_at)}`}
                    {isScheduled && room.scheduled_at && ` · ${new Date(room.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                  </p>
                </div>

                {/* Participant count (live only) */}
                {isLive && (
                  <ParticipantRatio count={room.participant_count} max={room.max_participants} />
                )}
                {isScheduled && room.max_participants != null && (
                  <span className="text-xs font-mono text-muted-foreground">— / {room.max_participants}</span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {isLive && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => router.push(`/rooms/${room.id}`)}>
                        Enter
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => endRoom(room.id)}
                        disabled={loadingId === room.id}
                      >
                        {loadingId === room.id ? '…' : 'End'}
                      </Button>
                    </>
                  )}
                  {(showGoLive || room.status === 'idle') && (
                    <Button
                      size="sm"
                      onClick={() => goLive(room.id)}
                      disabled={loadingId === room.id}
                    >
                      {loadingId === room.id ? 'Starting…' : 'Go Live'}
                    </Button>
                  )}
                  {!isLive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditRoom(room); setShowModal(true); }}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Past rooms (collapsed) */}
      {closedRooms.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground select-none">
            Past rooms ({closedRooms.length})
          </summary>
          <div className="mt-2 space-y-2">
            {closedRooms.map(room => (
              <div key={room.id} className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2 opacity-60">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0" />
                <span className="text-sm truncate flex-1">{room.name}</span>
                <span className="text-xs text-muted-foreground">{room.community_name}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <RoomModal
          communities={modalCommunities}
          onClose={() => { setShowModal(false); setEditRoom(null); }}
          onCreated={() => router.refresh()}
          editRoom={editRoom ? {
            id:              editRoom.id,
            name:            editRoom.name,
            description:     editRoom.description,
            room_type:       editRoom.room_type,
            community_id:    editRoom.community_id,
            scheduled_at:    editRoom.scheduled_at,
            max_participants: editRoom.max_participants,
          } : undefined}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/studio && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/studio/app/(dashboard)/rooms/RoomsClient.tsx
git commit -m "feat(studio): RoomsClient — live/scheduled/idle room cards, T-15 banner, Go Live / End Room"
```

---

## Task 8: Studio — rooms list server page

**Files:**
- Modify: `apps/studio/app/(dashboard)/rooms/page.tsx`

- [ ] **Step 1: Replace the stub**

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RoomsClient } from './RoomsClient';

export default async function RoomsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // Get communities where user is admin or moderator
  const { data: memberships } = await supabase
    .from('community_members')
    .select('community_id, communities(id, name)')
    .eq('user_id', user.id)
    .in('role', ['admin', 'moderator']);

  const communities = (memberships ?? [])
    .map(m => m.communities as { id: string; name: string } | null)
    .filter((c): c is { id: string; name: string } => c != null);

  const communityIds = communities.map(c => c.id);

  let rooms: any[] = [];
  if (communityIds.length > 0) {
    const { data } = await supabase
      .from('community_rooms')
      .select('id, name, description, room_type, status, participant_count, max_participants, scheduled_at, started_at, community_id, communities(name)')
      .in('community_id', communityIds)
      .order('created_at', { ascending: false });

    rooms = (data ?? []).map(r => ({
      ...r,
      community_name: (r.communities as any)?.name ?? '',
    }));
  }

  if (communities.length === 0) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Rooms</h1>
        <p className="text-muted-foreground">
          You need to be an admin or moderator of a community to manage rooms.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <RoomsClient rooms={rooms} communities={communities} />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/studio && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/studio/app/(dashboard)/rooms/page.tsx
git commit -m "feat(studio): rooms page — server component fetching admin communities and their rooms"
```

---

## Task 9: Studio — /rooms/[id] session page

**Files:**
- Create: `apps/studio/app/(dashboard)/rooms/[id]/page.tsx`

This is a `'use client'` page. It initialises the Daily.co call object after mount, handles participant events, and renders the video grid.

- [ ] **Step 1: Write the page**

```tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import type DailyIframe from '@daily-co/daily-js';
import type { DailyCall, DailyParticipant } from '@daily-co/daily-js';

type RoomInfo = {
  room_name: string;
  room_type: 'video' | 'audio';
  is_host: boolean;
};

type ParticipantState = {
  session_id: string;
  user_name: string;
  local: boolean;
  audio: boolean;
  video: boolean;
  is_owner: boolean;
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
};

// ── Participant tile ──────────────────────────────────────────────────────────
function ParticipantTile({
  participant,
  isHost,
  roomId,
  onKick,
  onMute,
}: {
  participant: ParticipantState;
  isHost: boolean;
  roomId: string;
  onKick: (sessionId: string) => void;
  onMute: (sessionId: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current || !participant.videoTrack) return;
    const stream = new MediaStream([participant.videoTrack]);
    videoRef.current.srcObject = stream;
  }, [participant.videoTrack]);

  return (
    <div className="relative rounded-xl overflow-hidden bg-zinc-900 aspect-video group">
      {participant.videoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={participant.local}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-2xl text-primary font-bold">
              {(participant.user_name || '?')[0].toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* Name bar */}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/60 flex items-center gap-1.5">
        {participant.is_owner && <span className="text-xs">👑</span>}
        {participant.local && <span className="text-[10px] text-primary/80 font-semibold">You · </span>}
        <span className="text-xs text-white font-medium truncate flex-1">
          {participant.user_name || 'Guest'}
        </span>
        {!participant.audio && <span className="text-[10px]">🔇</span>}
      </div>

      {/* Host controls — hover overlay */}
      {isHost && !participant.local && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <button
            onClick={() => onMute(participant.session_id)}
            className="rounded bg-black/70 px-2 py-1 text-[10px] text-white hover:bg-black/90"
          >
            Mute
          </button>
          <button
            onClick={() => onKick(participant.session_id)}
            className="rounded bg-red-800/80 px-2 py-1 text-[10px] text-white hover:bg-red-900"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function gridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 2) return 'grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  return 'grid-cols-3';
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RoomSessionPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const router = useRouter();

  const callRef = useRef<DailyCall | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [participants, setParticipants] = useState<Map<string, ParticipantState>>(new Map());
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const refreshParticipants = useCallback((callObject: DailyCall) => {
    const all = callObject.participants();
    const map = new Map<string, ParticipantState>();
    for (const [, p] of Object.entries(all)) {
      const dp = p as DailyParticipant;
      map.set(dp.session_id, {
        session_id: dp.session_id,
        user_name:  (dp as any).user_name ?? '',
        local:      dp.local,
        audio:      dp.audio,
        video:      dp.video,
        is_owner:   (dp as any).owner ?? false,
        videoTrack: dp.tracks?.video?.persistentTrack ?? null,
        audioTrack: dp.tracks?.audio?.persistentTrack ?? null,
      });
    }
    setParticipants(new Map(map));
  }, []);

  useEffect(() => {
    if (!roomId) return;
    let callObject: DailyCall | null = null;

    (async () => {
      try {
        const supabase = createClient();
        const { data: res } = await supabase.functions.invoke('join-community-room', {
          body: { room_id: roomId },
        });

        const info = res?.data;
        if (!info?.room_url) {
          setError('Room is not live. Please go back and click "Go Live" first.');
          setStatus('error');
          return;
        }

        setRoomInfo({
          room_name: info.room_name,
          room_type: info.room_type,
          is_host:   info.is_host,
        });

        // Lazy-import daily-js (browser only)
        const DailyIframeModule = await import('@daily-co/daily-js');
        const Daily = DailyIframeModule.default as typeof DailyIframe;
        callObject = Daily.createCallObject({ audioSource: true, videoSource: info.room_type === 'video' });
        callRef.current = callObject;

        callObject.on('joined-meeting',         () => { setStatus('connected'); refreshParticipants(callObject!); });
        callObject.on('participant-joined',      () => refreshParticipants(callObject!));
        callObject.on('participant-left',        () => refreshParticipants(callObject!));
        callObject.on('participant-updated',     () => refreshParticipants(callObject!));
        callObject.on('meeting-session-stopped', () => router.push('/rooms'));
        callObject.on('error',                   (e: any) => { setError(e.errorMsg ?? 'Connection error'); setStatus('error'); });

        await callObject.join({ url: info.room_url, token: info.token ?? undefined });
      } catch (e: any) {
        setError(e?.message ?? 'Failed to join room');
        setStatus('error');
      }
    })();

    return () => {
      callObject?.leave().catch(() => {});
      callObject?.destroy();
    };
  }, [roomId, refreshParticipants, router]);

  const toggleMic = () => {
    callRef.current?.setLocalAudio(!micOn);
    setMicOn(v => !v);
  };

  const toggleCam = () => {
    callRef.current?.setLocalVideo(!camOn);
    setCamOn(v => !v);
  };

  const handleMute = (sessionId: string) => {
    callRef.current?.updateParticipant(sessionId, { setAudio: false });
  };

  const handleKick = async (sessionId: string) => {
    if (!confirm('Remove this participant from the room?')) return;
    const supabase = createClient();
    await supabase.functions.invoke('kick-participant', {
      body: { room_id: roomId, session_id: sessionId },
    });
  };

  const handleMuteAll = () => {
    const all = callRef.current?.participants() ?? {};
    for (const [, p] of Object.entries(all)) {
      const dp = p as DailyParticipant;
      if (!dp.local) callRef.current?.updateParticipant(dp.session_id, { setAudio: false });
    }
  };

  const handleEndRoom = async () => {
    if (!confirm('End this room for everyone?')) return;
    setEnding(true);
    const supabase = createClient();
    await supabase.functions.invoke('manage-room', {
      body: { action: 'close', room_id: roomId },
    });
    callRef.current?.leave().catch(() => {});
    router.push('/rooms');
  };

  const handleLeave = async () => {
    callRef.current?.leave().catch(() => {});
    router.push('/rooms');
  };

  const participantList = Array.from(participants.values());
  const count = participantList.length;

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] gap-4">
        <p className="text-destructive text-sm">{error ?? 'Could not join room.'}</p>
        <Button variant="outline" onClick={() => router.push('/rooms')}>← Back to Rooms</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-zinc-950 rounded-xl overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/80 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white" onClick={handleLeave}>
            ← Back
          </Button>
          <span className="text-white font-semibold text-sm">
            {roomInfo?.room_name ?? 'Connecting…'}
          </span>
          {status === 'connected' && (
            <span className="flex items-center gap-1.5 text-xs text-green-400 font-semibold">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <span className="text-xs text-zinc-500 font-mono">
          {count} participant{count !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Video grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {status === 'connecting' ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-zinc-500 animate-pulse">Joining room…</p>
          </div>
        ) : count === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-zinc-500">Waiting for participants…</p>
          </div>
        ) : (
          <div className={`grid ${gridClass(count)} gap-3`}>
            {participantList.map(p => (
              <ParticipantTile
                key={p.session_id}
                participant={p}
                isHost={roomInfo?.is_host ?? false}
                roomId={roomId}
                onKick={handleKick}
                onMute={handleMute}
              />
            ))}
          </div>
        )}
      </div>

      {/* Control bar */}
      <div className="flex items-center justify-center gap-3 px-4 py-3 bg-zinc-900/80 border-t border-zinc-800">
        <button
          onClick={toggleMic}
          className={`w-11 h-11 rounded-full flex items-center justify-center text-xl transition-colors ${
            micOn ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-red-900/60 hover:bg-red-900'
          }`}
          title={micOn ? 'Mute mic' : 'Unmute mic'}
        >
          {micOn ? '🎤' : '🔇'}
        </button>

        {roomInfo?.room_type === 'video' && (
          <button
            onClick={toggleCam}
            className={`w-11 h-11 rounded-full flex items-center justify-center text-xl transition-colors ${
              camOn ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-red-900/60 hover:bg-red-900'
            }`}
            title={camOn ? 'Turn camera off' : 'Turn camera on'}
          >
            {camOn ? '📷' : '🚫'}
          </button>
        )}

        {roomInfo?.is_host && (
          <button
            onClick={handleMuteAll}
            className="w-11 h-11 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-sm font-semibold text-white transition-colors"
            title="Mute all participants"
          >
            🔕
          </button>
        )}

        <button
          onClick={handleLeave}
          className="w-11 h-11 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-xl transition-colors"
          title="Leave room"
        >
          🚪
        </button>

        {roomInfo?.is_host && (
          <button
            onClick={handleEndRoom}
            disabled={ending}
            className="rounded-full bg-red-700 hover:bg-red-800 px-4 h-11 text-sm font-semibold text-white transition-colors disabled:opacity-50"
          >
            {ending ? 'Ending…' : 'End Room'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/studio && npx tsc --noEmit
```

Expected: no errors. Note: `@daily-co/daily-js` exports `DailyParticipant` and `DailyCall` — if types fail, add `// @ts-ignore` for the dynamic import only.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/app/(dashboard)/rooms/[id]/page.tsx
git commit -m "feat(studio): rooms/[id] — Daily.co browser session with collaborative grid + host controls"
```

---

## Task 10: Mobile — CommunityRoomCard participant ratio

**Files:**
- Modify: `apps/mobile/components/community/CommunityRoomCard.tsx`

Add `participant_count` and `max_participants` props. Display `"4 / 20"` when live, `"— / 15"` when scheduled with a cap.

- [ ] **Step 1: Update the component**

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format } from 'date-fns';
import { COLORS } from '../../lib/constants';

interface CommunityRoomCardProps {
  id: string;
  name: string;
  description: string | null;
  room_type: 'video' | 'audio';
  status: 'idle' | 'live' | 'scheduled' | 'closed';
  scheduled_at: string | null;
  community_name: string | null;
  creator_display_name: string | null;
  participant_count?: number;
  max_participants?: number | null;
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
  participant_count = 0,
  max_participants,
  hideCommunityTag = false,
  onPress,
}: CommunityRoomCardProps) {
  const isLive      = status === 'live';
  const isScheduled = status === 'scheduled';

  const ratioText = isLive
    ? max_participants != null
      ? `${participant_count} / ${max_participants}`
      : `${participant_count}`
    : max_participants != null
      ? `— / ${max_participants}`
      : null;

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
        {ratioText && (
          <Text style={styles.ratio}>{ratioText}</Text>
        )}
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
  cardDimmed: { opacity: 0.65, borderColor: COLORS.textMuted + '30' },
  topRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeIcon: { fontSize: 18 },
  name:     { flex: 1, color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  ratio:    { color: COLORS.textMuted, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  liveBadge: { color: COLORS.success, fontSize: 11, fontWeight: '700' },
  scheduledBadge: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  description: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  metaRow:     { flexDirection: 'row', gap: 10, marginTop: 2, flexWrap: 'wrap' },
  metaTag:     { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/community/CommunityRoomCard.tsx
git commit -m "feat(mobile): CommunityRoomCard — show participant_count / max_participants ratio"
```

---

## Task 11: Mobile — community detail loadRooms + Realtime

**Files:**
- Modify: `apps/mobile/app/(tabs)/discover/community/[id].tsx`

Two changes: (1) select `participant_count, max_participants` from `community_rooms`; (2) add a Realtime subscription to keep those values live while the user is on the Rooms tab.

- [ ] **Step 1: Update loadRooms and add Realtime**

Find and replace the `loadRooms` callback and add the Realtime subscription:

In `apps/mobile/app/(tabs)/discover/community/[id].tsx`:

1. Update the `rooms` state type declaration (line ~56):

```ts
const [rooms, setRooms] = useState<(CommunityRoom & { creator_display_name: string | null; participant_count: number; max_participants: number | null })[]>([]);
```

2. Update `loadRooms` (replace the existing function):

```ts
const loadRooms = useCallback(async () => {
  if (!id) return;
  setLoadingRooms(true);
  const { data } = await supabase
    .from('community_rooms')
    .select('*, profiles!created_by(display_name)')
    .eq('community_id', id)
    .neq('status', 'closed')
    .eq('is_active', true)
    .order('name');
  if (data) {
    setRooms(data.map((r: any) => ({
      ...r,
      creator_display_name: r.profiles?.display_name ?? null,
      participant_count:    r.participant_count ?? 0,
      max_participants:     r.max_participants ?? null,
    })));
  }
  setLoadingRooms(false);
}, [id]);
```

3. Add Realtime subscription inside the existing `useEffect` that calls `loadRooms()` (after the `loadRooms()` call):

```ts
// Realtime: update participant_count when any room in this community changes
const channel = supabase
  .channel(`community-rooms-${id}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'community_rooms',
    filter: `community_id=eq.${id}`,
  }, (payload) => {
    const updated = payload.new as any;
    setRooms(prev => prev.map(r =>
      r.id === updated.id
        ? { ...r, participant_count: updated.participant_count ?? r.participant_count, status: updated.status ?? r.status }
        : r
    ));
  })
  .subscribe();

return () => { supabase.removeChannel(channel); };
```

4. Update the `CommunityRoomCard` call (in the Rooms page render) to pass new props:

```tsx
<CommunityRoomCard
  key={room.id}
  id={room.id}
  name={room.name}
  description={room.description}
  room_type={room.room_type}
  status={room.status}
  scheduled_at={room.scheduled_at}
  community_name={null}
  creator_display_name={room.creator_display_name}
  participant_count={room.participant_count}
  max_participants={room.max_participants}
  hideCommunityTag={true}
  onPress={() => router.push(`/(tabs)/connect/community-room-session?room_id=${room.id}` as any)}
/>
```

- [ ] **Step 2: Run TypeScript and Jest**

```bash
cd apps/mobile && npx tsc --noEmit && npx jest --ci --passWithNoTests
```

Expected: no TS errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(tabs)/discover/community/[id].tsx
git commit -m "feat(mobile): community rooms — select participant_count/max_participants, live Realtime sync"
```

---

## Task 12: Deploy edge functions + update .claude/log.md

- [ ] **Step 1: Deploy all three new functions**

```bash
npx supabase functions deploy manage-room --project-ref ptymtdlysqbpxzlgsshp
npx supabase functions deploy kick-participant --project-ref ptymtdlysqbpxzlgsshp
npx supabase functions deploy daily-webhook --project-ref ptymtdlysqbpxzlgsshp --no-verify-jwt
```

- [ ] **Step 2: Full QA loop**

```bash
cd apps/studio && npx eslint . --ext .ts,.tsx --max-warnings 0
cd apps/studio && npx tsc --noEmit
cd apps/mobile && npx tsc --noEmit
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: lint clean, 0 TS errors in both apps, all tests pass.

- [ ] **Step 3: Update .claude/log.md**

Append to `.claude/log.md`:
```
[2026-04-22] [APP: studio+mobile+functions] [ACTION: Rooms feature full implementation] [OUTCOME: migration 042, manage-room/kick-participant/daily-webhook edge functions, Studio /rooms list + /rooms/[id] session, mobile CommunityRoomCard participant ratio + Realtime] [FILES: 042_rooms_v2.sql, manage-room/index.ts, kick-participant/index.ts, daily-webhook/index.ts, rooms/page.tsx, RoomsClient.tsx, RoomModal.tsx, rooms/[id]/page.tsx, CommunityRoomCard.tsx, community/[id].tsx]
```

- [ ] **Step 4: Final commit**

```bash
git add .claude/log.md
git commit -m "chore: update session log — rooms feature complete"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Migration 042: participant_count, max_participants, started_at, ended_at, idle status, RLS fix, pg_cron — Task 1
- [x] manage-room (create/update/open/close) — Task 2
- [x] kick-participant — Task 3
- [x] daily-webhook with HMAC verification — Task 4
- [x] Studio /rooms list: LIVE/SCHEDULED/IDLE cards, T-15 banner, Go Live, End Room — Tasks 7-8
- [x] Studio /rooms/[id] session: collaborative grid, host controls (mute/kick/end), all-tile equal — Task 9
- [x] Mobile CommunityRoomCard participant ratio — Task 10
- [x] Mobile Realtime participant count sync — Task 11
- [x] pg_cron auto-close empty rooms — Task 1 (migration)
- [x] Error states (room full, not live, reconnection) — handled in join-community-room (already exists) and session page error branch

**Placeholder scan:** No TBDs, all code blocks complete.

**Type consistency:**
- `manage-room` uses `room_id` (snake_case) consistently
- `join-community-room` returns `is_host` (used as-is in session page)
- `kick-participant` takes `session_id` (Daily.co participant session ID) consistently with session page's `onKick` handler
- `participant_count` / `max_participants` match column names in migration and component props
