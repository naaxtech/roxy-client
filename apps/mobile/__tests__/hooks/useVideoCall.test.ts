import { renderHook, act } from '@testing-library/react-native';
import { useVideoCall } from '../../hooks/useVideoCall';
import type { VideoCallProvider, RemoteParticipant } from '../../lib/video/VideoCallProvider';

function makeParticipant(id: string, displayName: string, isOwner = false): RemoteParticipant {
  return { id, trackInfo: {}, displayName, isOwner };
}

function makeMockProvider(): VideoCallProvider {
  return {
    type: 'daily',
    isAvailable: true,
    onStateChange: null,
    onRemoteJoined: null,
    onRemoteLeft: null,
    onParticipantUpdated: null,
    join: jest.fn(),
    leave: jest.fn(),
    destroy: jest.fn(),
    toggleMic: jest.fn(),
    toggleCamera: jest.fn(),
    muteParticipant: jest.fn(),
    renderRemoteVideo: jest.fn(() => null),
    renderLocalVideo: jest.fn(() => null),
  };
}

describe('useVideoCall — multi-participant', () => {
  it('adds participants on join', () => {
    const provider = makeMockProvider();
    const { result } = renderHook(() => useVideoCall(provider));

    act(() => {
      provider.onRemoteJoined!(makeParticipant('p1', 'Alice'));
      provider.onRemoteJoined!(makeParticipant('p2', 'Maya'));
    });

    expect(result.current.remoteParticipants).toHaveLength(2);
    expect(result.current.remoteParticipants[0].displayName).toBe('Alice');
  });

  it('removes participant on leave', () => {
    const provider = makeMockProvider();
    const { result } = renderHook(() => useVideoCall(provider));

    act(() => {
      provider.onRemoteJoined!(makeParticipant('p1', 'Alice'));
      provider.onRemoteJoined!(makeParticipant('p2', 'Maya'));
    });
    act(() => {
      provider.onRemoteLeft!('p1');
    });

    expect(result.current.remoteParticipants).toHaveLength(1);
    expect(result.current.remoteParticipants[0].id).toBe('p2');
  });

  it('updates participant track info without adding duplicate', () => {
    const provider = makeMockProvider();
    const { result } = renderHook(() => useVideoCall(provider));

    act(() => {
      provider.onRemoteJoined!(makeParticipant('p1', 'Alice'));
    });
    act(() => {
      provider.onParticipantUpdated!(makeParticipant('p1', 'Alice', true));
    });

    expect(result.current.remoteParticipants).toHaveLength(1);
    expect(result.current.remoteParticipants[0].isOwner).toBe(true);
  });

  it('exposes remoteParticipant (singular) for backward compat', () => {
    const provider = makeMockProvider();
    const { result } = renderHook(() => useVideoCall(provider));

    act(() => {
      provider.onRemoteJoined!(makeParticipant('p1', 'Alice'));
    });

    expect(result.current.remoteParticipant).not.toBeNull();
    expect(result.current.remoteParticipant?.id).toBe('p1');
  });
});
