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
