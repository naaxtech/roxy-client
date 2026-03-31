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
  join(params: { roomUrl: string; token?: string }): Promise<void>;
  leave(): Promise<void>;
  destroy(): void;

  // ── Controls ───────────────────────────────────────────────────────────────
  toggleMic(): void;
  toggleCamera(): void;

  // ── Render ─────────────────────────────────────────────────────────────────
  renderRemoteVideo(participant: RemoteParticipant, style: object): React.ReactElement | null;
  renderLocalVideo(style: object): React.ReactElement | null;
}
