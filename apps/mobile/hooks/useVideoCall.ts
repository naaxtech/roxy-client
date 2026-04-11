import { useEffect, useState } from 'react';
import type { VideoCallProvider, VideoCallState, RemoteParticipant } from '../lib/video/VideoCallProvider';

export function useVideoCall(provider: VideoCallProvider | null) {
  const [state, setState] = useState<VideoCallState>('idle');
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [localVideoVersion, setLocalVideoVersion] = useState(0);

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

    provider.onLocalUpdated = () => {
      setLocalVideoVersion((v) => v + 1);
    };

    return () => {
      provider.onStateChange = null;
      provider.onRemoteJoined = null;
      provider.onRemoteLeft = null;
      provider.onParticipantUpdated = null;
      provider.onLocalUpdated = null;
    };
  }, [provider]);

  return {
    state,
    remoteParticipants,
    localVideoVersion,
    // Backward compat for Speed Dating (single remote participant)
    remoteParticipant: remoteParticipants[0] ?? null,
  };
}
