import React from 'react';
import type { VideoCallProvider, VideoCallState, RemoteParticipant } from './VideoCallProvider';

// Guarded import — never crashes Expo Go.
// On web, metro resolves this package to an EMPTY module ({}), which is
// truthy — so `mod.default ?? mod` must not be trusted as-is. Validate the
// shape: without createCallObject it is not a usable Daily module, and
// isAvailable must be false so the friendly "native-only" screen renders
// instead of a join attempt that throws.
let DailyCall: any = null;
let DailyMediaView: any = null;
try {
  const mod = require('@daily-co/react-native-daily-js');
  const candidate = mod?.default ?? mod;
  DailyCall = typeof candidate?.createCallObject === 'function' ? candidate : null;
  DailyMediaView = mod?.DailyMediaView ?? null;
} catch {}

/**
 * daily-js supports exactly ONE call object per process and its factory throws
 * `Duplicate DailyIframe instances are not allowed` when a second one is made
 * while the first is still alive. Each screen constructs its own DailyProvider,
 * so the barrier that serialises teardown against the next join has to be
 * module-scoped — a per-instance promise would not be seen by the next screen.
 * src: https://docs.daily.co/reference/daily-js/factory-methods/create-call-object · react-native-daily-js 0.83 (daily-js 0.86) · 2026-08-02
 */
let pendingTeardown: Promise<void> = Promise.resolve();

/**
 * Release whatever call object is still registered with daily-js, whoever
 * created it. A screen that unmounted while its teardown was still in flight
 * used to leave the instance alive, and every later join — audio or video —
 * then failed until the app was restarted.
 * src: https://docs.daily.co/reference/daily-js/static-methods/get-call-instance · daily-js 0.86 · 2026-08-02
 */
async function releaseLiveCall(): Promise<void> {
  await pendingTeardown.catch(() => {});
  const existing = typeof DailyCall?.getCallInstance === 'function'
    ? DailyCall.getCallInstance()
    : null;
  if (!existing) return;
  if (typeof existing.isDestroyed === 'function' && existing.isDestroyed()) return;
  await existing.destroy().catch(() => {});
}

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
  onLocalUpdated: (() => void) | null = null;

  private _call: any = null;

  async join({ roomUrl, token, startAudioOff = false }: {
    roomUrl: string;
    token?: string;
    startAudioOff?: boolean;
  }): Promise<void> {
    if (!DailyCall) throw new Error('Daily.co not available');
    this.onStateChange?.('connecting');
    try {
      // Never construct a second call object over a live one — that throws and
      // used to surface as the generic "Failed to connect to the room".
      await releaseLiveCall();
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
        if (evt.participant.local) {
          this.onLocalUpdated?.();
        } else {
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

  /**
   * Fire-and-forget by contract — it is called from unmount cleanup, where a
   * rejected promise has nobody to catch it. The teardown is still sequenced
   * (leave settles before destroy) and recorded in `pendingTeardown`, so the
   * next join waits for it instead of racing it.
   */
  destroy(): void {
    const call = this._call;
    this._call = null;
    if (!call) return;

    pendingTeardown = (async () => {
      try {
        if (typeof call.isDestroyed === 'function' && call.isDestroyed()) return;
        await call.leave().catch(() => {});
        await call.destroy();
      } catch {
        // Swallowed deliberately: an unmount has no error surface. If the
        // instance survived, releaseLiveCall() reclaims it on the next join.
      }
    })();
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

  getLocalMediaState(): { audio: boolean; video: boolean } | null {
    if (!this._call) return null;
    const local = this._call.participants()?.local;
    if (!local) return null;
    return { audio: !!local.audio, video: !!local.video };
  }

  renderRemoteVideo(participant: RemoteParticipant, style: object): React.ReactElement | null {
    if (!DailyMediaView) return null;
    const p = participant.trackInfo as any;
    return React.createElement(DailyMediaView, {
      videoTrack: p?.tracks?.video?.persistentTrack ?? null,
      audioTrack: p?.tracks?.audio?.persistentTrack ?? null,
      mirror: false,
      zOrder: 0,
      objectFit: 'cover',
      style,
    });
  }

  renderLocalVideo(style: object): React.ReactElement | null {
    if (!DailyMediaView || !this._call) return null;
    const local = this._call.participants()?.local;
    return React.createElement(DailyMediaView, {
      videoTrack: local?.tracks?.video?.persistentTrack ?? null,
      audioTrack: null,
      mirror: true,
      zOrder: 1,
      objectFit: 'cover',
      style,
    });
  }
}
