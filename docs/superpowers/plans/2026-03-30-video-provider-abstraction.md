# Video Call Provider Abstraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `VideoCallProvider` interface that abstracts the video calling provider, keeping Daily.co fully intact and adding LiveKit as a swappable alternative — both behind the same interface so `session.tsx` never knows which is running.

**Architecture:** Extract the inline Daily.co code from `session.tsx` into a `DailyProvider` class, define a common `VideoCallProvider` interface, implement `LiveKitProvider` using `@livekit/react-native`, and wire them through a factory. A single `VIDEO_PROVIDER` constant in `lib/video/index.ts` is the only switch. LiveKit tokens are issued by a new Supabase edge function (`livekit-token`) using Deno's built-in `crypto` — no npm SDK.

**Important — native module constraint:** Daily.co and LiveKit each ship their own `react-native-webrtc` fork. Only one can be active per native build. The metro config aliases Daily's fork to LiveKit's at bundle time so there's a single implementation. Switching providers requires a new dev build (`eas build`), not just a config change.

**Tech Stack:** Expo 51, React Native 0.74, TypeScript strict, `@daily-co/react-native-daily-js`, `@livekit/react-native`, `@livekit/react-native-webrtc`, Supabase Deno edge functions, Jest + `@testing-library/react-hooks`.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| CREATE | `apps/mobile/lib/video/VideoCallProvider.ts` | Interface + shared types (no imports, no React Native) |
| CREATE | `apps/mobile/lib/video/DailyProvider.ts` | Daily.co adapter — wraps the guarded Daily imports from `session.tsx` |
| CREATE | `apps/mobile/lib/video/LiveKitProvider.ts` | LiveKit adapter — guarded import, same pattern as Daily |
| CREATE | `apps/mobile/lib/video/index.ts` | `createVideoProvider()` factory + `VIDEO_PROVIDER` config constant |
| CREATE | `apps/mobile/hooks/useVideoCall.ts` | React hook wrapping any `VideoCallProvider` |
| CREATE | `apps/mobile/__tests__/hooks/useVideoCall.test.ts` | Hook tests using a mock provider |
| CREATE | `supabase/functions/livekit-token/index.ts` | Deno edge function — signs a LiveKit JWT |
| MODIFY | `apps/mobile/app/(tabs)/connect/speed-dating/session.tsx` | Use `useVideoCall` hook; remove inline Daily.co block |
| MODIFY | `apps/mobile/metro.config.js` | Alias Daily's webrtc fork → LiveKit's; stub LiveKit on web |

---

## Task 1: Define the VideoCallProvider interface

**Files:**
- Create: `apps/mobile/lib/video/VideoCallProvider.ts`

- [ ] **Step 1: Create the interface file**

```ts
// apps/mobile/lib/video/VideoCallProvider.ts
import type React from 'react';

export type VideoCallState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

/** Opaque per-provider data needed to render the remote stream. */
export interface RemoteParticipant {
  /** Provider-specific identifier (Daily: session_id, LiveKit: participant.sid) */
  id: string;
  /** Passed back to renderRemoteVideo — each provider casts to its own type */
  trackInfo: unknown;
}

export interface VideoCallProvider {
  readonly type: 'daily' | 'livekit';
  /** false in Expo Go / web — provider cannot create a call */
  readonly isAvailable: boolean;

  // ── Event callbacks (set before calling join) ──────────────────────────────
  onStateChange: ((state: VideoCallState) => void) | null;
  onRemoteJoined: ((participant: RemoteParticipant) => void) | null;
  onRemoteLeft: ((participantId: string) => void) | null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  /**
   * Join or create a room.
   * - Daily: pass `roomUrl` (the Daily room URL from the edge function)
   * - LiveKit: pass `roomUrl` (LiveKit server URL) + `token` (JWT from livekit-token edge fn)
   */
  join(params: { roomUrl: string; token?: string }): Promise<void>;
  leave(): Promise<void>;
  destroy(): void;

  // ── Controls ───────────────────────────────────────────────────────────────
  toggleMic(): void;
  toggleCamera(): void;

  // ── Render ─────────────────────────────────────────────────────────────────
  /** Returns a React element for the remote participant video, or null if unavailable */
  renderRemoteVideo(participant: RemoteParticipant, style: object): React.ReactElement | null;
  /** Returns a React element for the local (self-view) video, or null if unavailable */
  renderLocalVideo(style: object): React.ReactElement | null;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep video
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/video/VideoCallProvider.ts
git commit -m "feat: define VideoCallProvider interface + shared types"
```

---

## Task 2: useVideoCall hook (TDD)

**Files:**
- Create: `apps/mobile/__tests__/hooks/useVideoCall.test.ts`
- Create: `apps/mobile/hooks/useVideoCall.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/__tests__/hooks/useVideoCall.test.ts
import { renderHook, act } from '@testing-library/react-hooks';
import { useVideoCall } from '../../hooks/useVideoCall';
import type {
  VideoCallProvider, VideoCallState, RemoteParticipant,
} from '../../lib/video/VideoCallProvider';

class MockProvider implements VideoCallProvider {
  type = 'daily' as const;
  isAvailable = true;
  onStateChange: ((s: VideoCallState) => void) | null = null;
  onRemoteJoined: ((p: RemoteParticipant) => void) | null = null;
  onRemoteLeft: ((id: string) => void) | null = null;
  join = jest.fn().mockResolvedValue(undefined);
  leave = jest.fn().mockResolvedValue(undefined);
  destroy = jest.fn();
  toggleMic = jest.fn();
  toggleCamera = jest.fn();
  renderRemoteVideo = jest.fn().mockReturnValue(null);
  renderLocalVideo = jest.fn().mockReturnValue(null);

  // Test helpers — simulate provider events
  fireStateChange(s: VideoCallState) { this.onStateChange?.(s); }
  fireRemoteJoined(p: RemoteParticipant) { this.onRemoteJoined?.(p); }
  fireRemoteLeft(id: string) { this.onRemoteLeft?.(id); }
}

describe('useVideoCall', () => {
  it('starts in idle state', () => {
    const provider = new MockProvider();
    const { result } = renderHook(() => useVideoCall(provider));
    expect(result.current.state).toBe('idle');
    expect(result.current.remoteParticipant).toBeNull();
  });

  it('updates state when provider fires onStateChange', () => {
    const provider = new MockProvider();
    const { result } = renderHook(() => useVideoCall(provider));
    act(() => { provider.fireStateChange('connected'); });
    expect(result.current.state).toBe('connected');
  });

  it('sets remoteParticipant when provider fires onRemoteJoined', () => {
    const provider = new MockProvider();
    const { result } = renderHook(() => useVideoCall(provider));
    const participant: RemoteParticipant = { id: 'p1', trackInfo: null };
    act(() => { provider.fireRemoteJoined(participant); });
    expect(result.current.remoteParticipant).toEqual(participant);
  });

  it('clears remoteParticipant when provider fires onRemoteLeft', () => {
    const provider = new MockProvider();
    const { result } = renderHook(() => useVideoCall(provider));
    const participant: RemoteParticipant = { id: 'p1', trackInfo: null };
    act(() => { provider.fireRemoteJoined(participant); });
    act(() => { provider.fireRemoteLeft('p1'); });
    expect(result.current.remoteParticipant).toBeNull();
  });

  it('clears callbacks on unmount', () => {
    const provider = new MockProvider();
    const { unmount } = renderHook(() => useVideoCall(provider));
    unmount();
    expect(provider.onStateChange).toBeNull();
    expect(provider.onRemoteJoined).toBeNull();
    expect(provider.onRemoteLeft).toBeNull();
  });

  it('returns null state when provider is null', () => {
    const { result } = renderHook(() => useVideoCall(null));
    expect(result.current.state).toBe('idle');
    expect(result.current.remoteParticipant).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/mobile && npx jest __tests__/hooks/useVideoCall.test.ts --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../../hooks/useVideoCall'`

- [ ] **Step 3: Implement the hook**

```ts
// apps/mobile/hooks/useVideoCall.ts
import { useEffect, useRef, useState } from 'react';
import type { VideoCallProvider, VideoCallState, RemoteParticipant } from '../lib/video/VideoCallProvider';

export function useVideoCall(provider: VideoCallProvider | null) {
  const [state, setState] = useState<VideoCallState>('idle');
  const [remoteParticipant, setRemoteParticipant] = useState<RemoteParticipant | null>(null);

  useEffect(() => {
    if (!provider) return;
    provider.onStateChange = setState;
    provider.onRemoteJoined = setRemoteParticipant;
    provider.onRemoteLeft = () => setRemoteParticipant(null);
    return () => {
      provider.onStateChange = null;
      provider.onRemoteJoined = null;
      provider.onRemoteLeft = null;
    };
  }, [provider]);

  return { state, remoteParticipant };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/mobile && npx jest __tests__/hooks/useVideoCall.test.ts --no-coverage 2>&1 | tail -10
```

Expected: `6 passed, 6 total`

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: all tests pass (54 + 6 = 60 total).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/hooks/useVideoCall.ts apps/mobile/__tests__/hooks/useVideoCall.test.ts
git commit -m "feat: useVideoCall hook — wraps any VideoCallProvider, TDD"
```

---

## Task 3: DailyProvider — extract existing code

**Files:**
- Create: `apps/mobile/lib/video/DailyProvider.ts`

This extracts the inline Daily.co block from `session.tsx` into a class. No logic changes — just encapsulation.

- [ ] **Step 1: Create DailyProvider**

```ts
// apps/mobile/lib/video/DailyProvider.ts
import React from 'react';
import { isDailyAvailable } from '../daily';
import type { VideoCallProvider, VideoCallState, RemoteParticipant } from './VideoCallProvider';

// Guarded Daily.co imports — same pattern as session.tsx
let DailyCall: any = null;
let DailyMediaView: any = null;
try {
  const mod = require('@daily-co/react-native-daily-js');
  DailyCall = mod.default ?? mod;
  DailyMediaView = mod.DailyMediaView ?? null;
} catch {}

export class DailyProvider implements VideoCallProvider {
  readonly type = 'daily' as const;
  get isAvailable() { return isDailyAvailable() && DailyCall !== null; }

  onStateChange: ((state: VideoCallState) => void) | null = null;
  onRemoteJoined: ((participant: RemoteParticipant) => void) | null = null;
  onRemoteLeft: ((participantId: string) => void) | null = null;

  private callObject: any = null;

  async join({ roomUrl }: { roomUrl: string; token?: string }): Promise<void> {
    if (!this.isAvailable || !DailyCall) return;
    this.onStateChange?.('connecting');

    this.callObject = DailyCall.createCallObject();

    this.callObject.on('joined-meeting', () => this.onStateChange?.('connected'));
    this.callObject.on('left-meeting', () => this.onStateChange?.('disconnected'));
    this.callObject.on('error', () => this.onStateChange?.('error'));

    this.callObject.on('participant-joined', (evt: any) => {
      if (!evt.participant.local) {
        this.onRemoteJoined?.({ id: evt.participant.session_id, trackInfo: null });
      }
    });
    this.callObject.on('participant-updated', (evt: any) => {
      if (!evt.participant.local) {
        // Re-emit so session.tsx re-renders when tracks change
        this.onRemoteJoined?.({ id: evt.participant.session_id, trackInfo: null });
      }
    });
    this.callObject.on('participant-left', (evt: any) => {
      this.onRemoteLeft?.(evt.participant.session_id);
    });

    try {
      await this.callObject.join({ url: roomUrl });
    } catch (e) {
      console.warn('[DailyProvider] join failed:', e);
      this.onStateChange?.('error');
    }
  }

  async leave(): Promise<void> {
    await this.callObject?.leave().catch(() => {});
  }

  destroy(): void {
    this.callObject?.destroy().catch(() => {});
    this.callObject = null;
  }

  toggleMic(): void {
    const local = this.callObject?.participants()?.local;
    if (local) this.callObject.setLocalAudio(!local.audio);
  }

  toggleCamera(): void {
    const local = this.callObject?.participants()?.local;
    if (local) this.callObject.setLocalVideo(!local.video);
  }

  renderRemoteVideo(participant: RemoteParticipant, style: object): React.ReactElement | null {
    if (!DailyMediaView || !this.callObject) return null;
    const tracks = this.callObject.participants()?.[participant.id];
    return React.createElement(DailyMediaView, {
      key: participant.id,
      sessionId: participant.id,
      videoTrackState: tracks?.videoTrack ?? null,
      audioTrackState: tracks?.audioTrack ?? null,
      style,
      mirror: false,
    });
  }

  renderLocalVideo(style: object): React.ReactElement | null {
    if (!DailyMediaView || !this.callObject) return null;
    return React.createElement(DailyMediaView, {
      key: 'local',
      sessionId: 'local',
      videoTrackState: this.callObject.participants()?.local?.videoTrack ?? null,
      audioTrackState: null,
      style,
      mirror: true,
    });
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep -i daily
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/video/DailyProvider.ts
git commit -m "feat: DailyProvider — extract Daily.co adapter behind VideoCallProvider interface"
```

---

## Task 4: livekit-token edge function

**Files:**
- Create: `supabase/functions/livekit-token/index.ts`

Signs a LiveKit JWT using Deno's built-in `crypto.subtle` — no npm SDK required.

Environment variables required (set via `npx supabase secrets set`):
- `LIVEKIT_API_KEY` — from LiveKit Cloud dashboard or your self-hosted server config
- `LIVEKIT_API_SECRET` — same
- `LIVEKIT_SERVER_URL` — e.g. `wss://your-project.livekit.cloud` or your self-hosted URL

- [ ] **Step 1: Create the edge function**

```ts
// supabase/functions/livekit-token/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

async function signLiveKitToken(
  apiKey: string,
  apiSecret: string,
  room: string,
  identity: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: apiKey,
    sub: identity,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 3600,
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    },
  };

  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const message = `${b64url(header)}.${b64url(payload)}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${message}.${sig}`;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { room_name, identity } = body;
  if (!room_name || !identity) return errorResponse('room_name and identity required', 400);

  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  const serverUrl = Deno.env.get('LIVEKIT_SERVER_URL');

  if (!apiKey || !apiSecret || !serverUrl) {
    return errorResponse('LiveKit not configured — set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_SERVER_URL', 503);
  }

  const token = await signLiveKitToken(apiKey, apiSecret, room_name, identity);

  return successResponse({ token, server_url: serverUrl });
});
```

- [ ] **Step 2: Deploy the edge function**

```bash
npx supabase functions deploy livekit-token --project-ref ptymtdlysqbpxzlgsshp
```

Expected: `Deployed livekit-token`

Note: The function will return 503 until you set the LiveKit secrets. That's fine for now — Daily.co provider doesn't use this function.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/livekit-token/index.ts
git commit -m "feat: livekit-token edge function — sign LiveKit JWT via Deno crypto, no SDK"
```

---

## Task 5: LiveKitProvider

**Files:**
- Create: `apps/mobile/lib/video/LiveKitProvider.ts`
- Modify: `apps/mobile/package.json` (add dependencies)
- Modify: `apps/mobile/metro.config.js` (stub on web + alias webrtc)

- [ ] **Step 1: Install LiveKit packages**

```bash
cd apps/mobile && npm install @livekit/react-native @livekit/react-native-webrtc --legacy-peer-deps
```

Expected: packages installed, no peer dep errors with `--legacy-peer-deps`.

- [ ] **Step 2: Update metro.config.js**

```js
// apps/mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Alias Daily's webrtc fork → LiveKit's so only one native RTCPeerConnection is registered.
// When VIDEO_PROVIDER is 'daily', the same underlying webrtc module serves both.
config.resolver.extraNodeModules = {
  '@daily-co/react-native-webrtc': require.resolve('@livekit/react-native-webrtc'),
};

// Stub out native-only packages on web
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && (
    moduleName === '@daily-co/react-native-daily-js' ||
    moduleName === '@daily-co/react-native-webrtc' ||
    moduleName === '@livekit/react-native' ||
    moduleName === '@livekit/react-native-webrtc' ||
    moduleName === 'react-native-background-timer' ||
    moduleName === 'react-native-callkeep' ||
    moduleName === '@react-native-community/async-storage'
  )) {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
```

- [ ] **Step 3: Create LiveKitProvider**

```ts
// apps/mobile/lib/video/LiveKitProvider.ts
import React from 'react';
import type { VideoCallProvider, VideoCallState, RemoteParticipant } from './VideoCallProvider';

// Guarded LiveKit imports — same pattern as Daily
let LiveKitRoom: any = null;
let LiveKitRoomEvent: any = null;
let LiveKitVideoView: any = null;
let isLiveKitLoaded = false;

try {
  const mod = require('@livekit/react-native');
  LiveKitRoom = mod.Room ?? null;
  LiveKitRoomEvent = mod.RoomEvent ?? null;
  LiveKitVideoView = mod.VideoView ?? null;
  isLiveKitLoaded = LiveKitRoom !== null;
} catch {}

export class LiveKitProvider implements VideoCallProvider {
  readonly type = 'livekit' as const;
  get isAvailable() { return isLiveKitLoaded; }

  onStateChange: ((state: VideoCallState) => void) | null = null;
  onRemoteJoined: ((participant: RemoteParticipant) => void) | null = null;
  onRemoteLeft: ((participantId: string) => void) | null = null;

  private room: any = null;

  async join({ roomUrl, token }: { roomUrl: string; token?: string }): Promise<void> {
    if (!this.isAvailable || !LiveKitRoom || !token) return;
    this.onStateChange?.('connecting');

    this.room = new LiveKitRoom();

    this.room.on(LiveKitRoomEvent.Connected, () => {
      this.onStateChange?.('connected');
    });
    this.room.on(LiveKitRoomEvent.Disconnected, () => {
      this.onStateChange?.('disconnected');
    });
    this.room.on(LiveKitRoomEvent.ParticipantConnected, (participant: any) => {
      this.onRemoteJoined?.({ id: participant.sid, trackInfo: participant });
    });
    this.room.on(LiveKitRoomEvent.ParticipantDisconnected, (participant: any) => {
      this.onRemoteLeft?.(participant.sid);
    });
    // Re-emit when tracks are published so the render gets fresh data
    this.room.on(LiveKitRoomEvent.TrackSubscribed, (_track: any, _pub: any, participant: any) => {
      this.onRemoteJoined?.({ id: participant.sid, trackInfo: participant });
    });

    try {
      await this.room.connect(roomUrl, token);
      // Enable camera and mic after connecting
      await this.room.localParticipant?.setCameraEnabled(true);
      await this.room.localParticipant?.setMicrophoneEnabled(true);
    } catch (e) {
      console.warn('[LiveKitProvider] connect failed:', e);
      this.onStateChange?.('error');
    }
  }

  async leave(): Promise<void> {
    await this.room?.disconnect().catch(() => {});
  }

  destroy(): void {
    this.room = null;
  }

  toggleMic(): void {
    const enabled = this.room?.localParticipant?.isMicrophoneEnabled ?? false;
    this.room?.localParticipant?.setMicrophoneEnabled(!enabled).catch(() => {});
  }

  toggleCamera(): void {
    const enabled = this.room?.localParticipant?.isCameraEnabled ?? false;
    this.room?.localParticipant?.setCameraEnabled(!enabled).catch(() => {});
  }

  renderRemoteVideo(participant: RemoteParticipant, style: object): React.ReactElement | null {
    if (!LiveKitVideoView || !this.room) return null;
    const lkParticipant = participant.trackInfo as any;
    const publication = lkParticipant?.videoTrackPublications?.values().next().value;
    const track = publication?.track;
    if (!track) return null;
    return React.createElement(LiveKitVideoView, { key: participant.id, videoTrack: track, style });
  }

  renderLocalVideo(style: object): React.ReactElement | null {
    if (!LiveKitVideoView || !this.room) return null;
    const publication = this.room.localParticipant?.videoTrackPublications?.values().next().value;
    const track = publication?.track;
    if (!track) return null;
    return React.createElement(LiveKitVideoView, { key: 'local', videoTrack: track, style, mirror: true });
  }
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep -i livekit
```

Expected: no errors (LiveKit imports are `any` so type errors won't surface here).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/video/LiveKitProvider.ts apps/mobile/metro.config.js apps/mobile/package.json apps/mobile/package-lock.json
git commit -m "feat: LiveKitProvider + metro alias/stubs for @livekit/react-native"
```

---

## Task 6: Factory + video/index.ts

**Files:**
- Create: `apps/mobile/lib/video/index.ts`

- [ ] **Step 1: Create the factory**

```ts
// apps/mobile/lib/video/index.ts

/**
 * Active video provider.
 * Change this one line to switch providers.
 * Requires a new native build (eas build) after changing.
 */
export const VIDEO_PROVIDER: 'daily' | 'livekit' = 'daily';

export type { VideoCallProvider, VideoCallState, RemoteParticipant } from './VideoCallProvider';

import { DailyProvider } from './DailyProvider';
import { LiveKitProvider } from './LiveKitProvider';
import type { VideoCallProvider } from './VideoCallProvider';

/** Returns a fresh provider instance for the configured provider. */
export function createVideoProvider(): VideoCallProvider {
  if (VIDEO_PROVIDER === 'livekit') return new LiveKitProvider();
  return new DailyProvider();
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/video/index.ts
git commit -m "feat: video provider factory — swap Daily/LiveKit via VIDEO_PROVIDER constant"
```

---

## Task 7: Refactor session.tsx

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/speed-dating/session.tsx`

Remove the inline Daily.co block, use `useVideoCall` hook and `createVideoProvider`. The session UI (`TimerBar`, `VideoPlaceholder`, prompts, like button) is unchanged.

- [ ] **Step 1: Replace the top of session.tsx**

Replace lines 1–22 (the imports and the guarded Daily block) with:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, PanResponder, Alert, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../lib/supabase';
import { callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { COLORS } from '../../../../lib/constants';
import type { SpeedDateSession as SpeedDateSessionData } from '../../../../types';
import { useVideoCall } from '../../../../hooks/useVideoCall';
import { createVideoProvider, VIDEO_PROVIDER } from '../../../../lib/video';
```

- [ ] **Step 2: Replace the inline Daily block and callObject state**

Remove these lines (they are no longer needed in session.tsx — the provider handles them):

```tsx
// REMOVE these lines:
let DailyCall: any = null;
let DailyMediaView: any = null;
try {
  const mod = require('@daily-co/react-native-daily-js');
  DailyCall = mod.default ?? mod;
  DailyMediaView = mod.DailyMediaView ?? null;
} catch {}
```

Also remove the `const [callObject, setCallObject] = useState<any>(null);` and `const [remoteSessionId, setRemoteSessionId] = useState<string | null>(null);` state lines.

Replace them with:

```tsx
const providerRef = useRef(createVideoProvider());
const { state: callState, remoteParticipant } = useVideoCall(providerRef.current);
```

- [ ] **Step 3: Replace the Daily.co call setup useEffect**

Remove the entire `// Daily.co call setup` useEffect block (lines ~130–156):

```tsx
// REMOVE this entire useEffect:
useEffect(() => {
  if (!isDailyAvailable() || !room_url || !DailyCall) return;
  let call: any = null;
  try { ... }
  return () => { ... };
}, [room_url]);
```

Replace with the unified join effect:

```tsx
// Video call setup — works for both Daily and LiveKit
useEffect(() => {
  if (!session_id) return;
  const provider = providerRef.current;

  async function startCall() {
    if (VIDEO_PROVIDER === 'livekit') {
      const { data } = await callEdgeFunction<{ token: string; server_url: string }>(
        'livekit-token',
        { room_name: session_id, identity: user?.id ?? 'anon' },
      );
      if (data?.token && data?.server_url) {
        await provider.join({ roomUrl: data.server_url, token: data.token });
      }
    } else {
      // Daily.co — room_url comes from the navigation params
      if (room_url) {
        await provider.join({ roomUrl: room_url as string });
      }
    }
  }

  startCall();

  return () => {
    provider.leave();
    provider.destroy();
  };
}, [session_id, room_url, user]);
```

- [ ] **Step 4: Update handleEnd**

In `handleEnd`, replace:

```tsx
if (callObject) {
  callObject.leave().catch(() => {});
}
```

With:

```tsx
providerRef.current.leave();
```

And remove `callObject` from the dependency array of `useCallback`.

- [ ] **Step 5: Update the remote video render**

Replace:

```tsx
{isDailyAvailable() && DailyMediaView && remoteSessionId ? (
  <DailyMediaView
    sessionId={remoteSessionId}
    videoTrackState={callObject?.participants()?.[remoteSessionId]?.videoTrack ?? null}
    audioTrackState={callObject?.participants()?.[remoteSessionId]?.audioTrack ?? null}
    style={StyleSheet.absoluteFill}
    mirror={false}
  />
) : (
  <VideoPlaceholder label="Waiting for match…" />
)}
```

With:

```tsx
{remoteParticipant
  ? (providerRef.current.renderRemoteVideo(remoteParticipant, StyleSheet.absoluteFill) ?? <VideoPlaceholder label="Waiting for match…" />)
  : <VideoPlaceholder label="Waiting for match…" />
}
```

- [ ] **Step 6: Update the local (self-view PiP) render**

Replace:

```tsx
{isDailyAvailable() && DailyMediaView && callObject ? (
  <DailyMediaView
    sessionId="local"
    videoTrackState={callObject?.participants()?.local?.videoTrack ?? null}
    audioTrackState={null}
    style={StyleSheet.absoluteFill}
    mirror={true}
  />
) : (
  <VideoPlaceholder label="You" />
)}
```

With:

```tsx
{callState === 'connected'
  ? (providerRef.current.renderLocalVideo(StyleSheet.absoluteFill) ?? <VideoPlaceholder label="You" />)
  : <VideoPlaceholder label="You" />
}
```

- [ ] **Step 7: Remove unused imports**

Remove `import { isDailyAvailable } from '../../../../lib/daily';` — it's no longer used directly in session.tsx.

- [ ] **Step 8: TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1
```

Expected: 0 errors.

- [ ] **Step 9: Run full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: all 60 tests pass.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/app/\(tabs\)/connect/speed-dating/session.tsx
git commit -m "refactor: session.tsx — use VideoCallProvider abstraction, remove inline Daily.co block"
```

---

## Task 8: Push and PR

- [ ] **Step 1: Update CLAUDE.md**

In `CLAUDE.md`, add to the Architecture Decisions section:

```markdown
- Video calling: `VideoCallProvider` interface in `lib/video/` — Daily.co and LiveKit both implement it. Switch via `VIDEO_PROVIDER` in `lib/video/index.ts`. Requires a native rebuild after switching. `session.tsx` only imports from `lib/video/`.
```

- [ ] **Step 2: Push**

```bash
git add CLAUDE.md && git commit -m "docs: CLAUDE.md — document VideoCallProvider pattern"
git push
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --base main \
  --title "feat: VideoCallProvider abstraction — Daily.co + LiveKit swappable" \
  --body "$(cat <<'EOF'
## What's in this PR

Introduces a \`VideoCallProvider\` interface so \`session.tsx\` is decoupled from the video calling implementation.

- **Interface** (\`lib/video/VideoCallProvider.ts\`) — \`join\`, \`leave\`, \`destroy\`, \`toggleMic\`, \`toggleCamera\`, \`renderRemoteVideo\`, \`renderLocalVideo\`, event callbacks
- **DailyProvider** — extracts existing Daily.co code from session.tsx, no behaviour change
- **LiveKitProvider** — new adapter using \`@livekit/react-native\` with guarded import
- **livekit-token** edge function — signs a LiveKit JWT using Deno \`crypto.subtle\`, no npm SDK
- **Factory** — \`createVideoProvider()\` reads \`VIDEO_PROVIDER\` constant; change one line + rebuild to switch
- **Metro** — aliases \`@daily-co/react-native-webrtc\` → \`@livekit/react-native-webrtc\` to avoid duplicate native module registration; stubs both on web
- **useVideoCall hook** — TDD, 6 tests

## Switching providers

1. Edit \`apps/mobile/lib/video/index.ts\`: change \`VIDEO_PROVIDER\` from \`'daily'\` to \`'livekit'\`
2. Set LiveKit secrets: \`npx supabase secrets set LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... LIVEKIT_SERVER_URL=...\`
3. Run \`eas build\` (native rebuild required — one WebRTC module per build)

## Test plan
- [ ] All 60 tests pass
- [ ] With \`VIDEO_PROVIDER = 'daily'\`: speed date session works as before
- [ ] With \`VIDEO_PROVIDER = 'livekit'\` + LiveKit secrets set: session joins LiveKit room

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-PR: Setting up LiveKit

After the PR is merged, to activate LiveKit:

**Option A — LiveKit Cloud (sandbox, no card)**
1. Sign up at livekit.cloud → create a project → copy API Key, API Secret, WSS URL
2. `npx supabase secrets set LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... LIVEKIT_SERVER_URL=wss://... --project-ref ptymtdlysqbpxzlgsshp`

**Option B — Self-hosted on Oracle Cloud Always Free**
1. Create an Oracle Cloud account (free tier — requires card for identity but won't charge)
2. Provision an ARM VM (Ampere A1, 1 OCPU, 6GB RAM — free forever)
3. Install Docker, run: `docker run --rm -p 7880:7880 -p 7881:7881 -p 50100-50200:50100-50200/udp livekit/livekit-server --dev`
4. Note the server IP, set API Key/Secret from the dev mode output, set `LIVEKIT_SERVER_URL=wss://<your-ip>:7881`

**In both cases, then:**
- Change `VIDEO_PROVIDER = 'livekit'` in `lib/video/index.ts`
- Run `eas build --profile development`
