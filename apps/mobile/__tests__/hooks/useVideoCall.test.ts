import { renderHook, act } from '@testing-library/react-native';
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
