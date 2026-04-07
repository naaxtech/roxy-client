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

export class DailyProvider implements VideoCallProvider {
  readonly type = 'daily' as const;
  get isAvailable() { return DailyCall !== null; }

  onStateChange: ((state: VideoCallState) => void) | null = null;
  onRemoteJoined: ((participant: RemoteParticipant) => void) | null = null;
  onRemoteLeft: ((participantId: string) => void) | null = null;

  private _call: any = null;
  private _participants: Record<string, any> = {};

  async join({ roomUrl }: { roomUrl: string; token?: string }): Promise<void> {
    if (!DailyCall) throw new Error('Daily.co not available');
    this.onStateChange?.('connecting');
    try {
      this._call = DailyCall.createCallObject();
      this._call.on('joining-meeting', () => this.onStateChange?.('connecting'));
      this._call.on('joined-meeting', () => this.onStateChange?.('connected'));
      this._call.on('left-meeting', () => this.onStateChange?.('disconnected'));
      this._call.on('error', () => this.onStateChange?.('error'));
      this._call.on('participant-joined', (evt: any) => {
        if (!evt.participant.local) {
          this._participants[evt.participant.session_id] = evt.participant;
          this.onRemoteJoined?.({
            id: evt.participant.session_id,
            trackInfo: evt.participant,
          });
        }
      });
      this._call.on('participant-updated', (evt: any) => {
        if (!evt.participant.local) {
          this._participants[evt.participant.session_id] = evt.participant;
        }
      });
      this._call.on('participant-left', (evt: any) => {
        delete this._participants[evt.participant.session_id];
        this.onRemoteLeft?.(evt.participant.session_id);
      });
      await this._call.join({ url: roomUrl });
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
    this._participants = {};
  }

  toggleMic(): void {
    if (!this._call) return;
    const localParticipant = this._call.participants()?.local;
    this._call.setLocalAudio(!localParticipant?.audio);
  }

  toggleCamera(): void {
    if (!this._call) return;
    const localParticipant = this._call.participants()?.local;
    this._call.setLocalVideo(!localParticipant?.video);
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
