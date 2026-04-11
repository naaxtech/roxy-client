import React from 'react';
import type { VideoCallProvider, VideoCallState, RemoteParticipant } from './VideoCallProvider';

/**
 * LiveKit provider — stub. Implement when @livekit/react-native is added.
 * The livekit-token edge function is already deployed and ready.
 */
export class LiveKitProvider implements VideoCallProvider {
  readonly type = 'livekit' as const;
  readonly isAvailable = false;   // not yet implemented

  onStateChange: ((state: VideoCallState) => void) | null = null;
  onRemoteJoined: ((participant: RemoteParticipant) => void) | null = null;
  onRemoteLeft: ((participantId: string) => void) | null = null;
  onParticipantUpdated: ((participant: RemoteParticipant) => void) | null = null;
  onLocalUpdated: (() => void) | null = null;

  async join(_params: { roomUrl: string; token?: string; startAudioOff?: boolean }): Promise<void> {
    throw new Error('LiveKitProvider not yet implemented');
  }
  async leave(): Promise<void> {}
  destroy(): void {}
  toggleMic(): void {}
  toggleCamera(): void {}
  muteParticipant(_sessionId: string): void {}
  renderRemoteVideo(_p: RemoteParticipant, _style: object): React.ReactElement | null { return null; }
  renderLocalVideo(_style: object): React.ReactElement | null { return null; }
}
