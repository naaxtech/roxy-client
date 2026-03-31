import { useEffect, useState } from 'react';
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
