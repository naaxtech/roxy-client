jest.mock('../../lib/supabase', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  const mockSubscribe = jest.fn();
  const mockOn = jest.fn();
  const mockChannel = jest.fn();

  mockOn.mockReturnValue({ on: mockOn, subscribe: mockSubscribe, send: mockSend });
  mockChannel.mockReturnValue({ on: mockOn, subscribe: mockSubscribe, send: mockSend });

  return {
    supabase: {
      channel: mockChannel,
      removeChannel: jest.fn(),
    },
  };
});

import { act, renderHook } from '@testing-library/react-native';
import { useTyping } from '../../hooks/useTyping';

const { supabase } = jest.requireMock('../../lib/supabase');

describe('useTyping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const channelInstance = {
      on: jest.fn(),
      subscribe: jest.fn(),
      send: jest.fn().mockResolvedValue({}),
    };
    channelInstance.on.mockReturnValue(channelInstance);
    supabase.channel.mockReturnValue(channelInstance);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes partnerIsTyping (false) and sendTyping function', () => {
    const { result } = renderHook(() =>
      useTyping({ conversationId: 'conv-1', currentUserId: 'user-1', partnerName: 'Alex' })
    );
    expect(result.current.partnerIsTyping).toBe(false);
    expect(typeof result.current.sendTyping).toBe('function');
  });

  it('subscribes to typing:conversationId channel on mount', () => {
    renderHook(() =>
      useTyping({ conversationId: 'conv-1', currentUserId: 'user-1', partnerName: 'Alex' })
    );
    expect(supabase.channel).toHaveBeenCalledWith('typing:conv-1');
  });

  it('calls removeChannel on unmount', () => {
    const { unmount } = renderHook(() =>
      useTyping({ conversationId: 'conv-1', currentUserId: 'user-1', partnerName: 'Alex' })
    );
    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  it('sendTyping sends a broadcast event', async () => {
    const channelInstance = {
      on: jest.fn(),
      subscribe: jest.fn(),
      send: jest.fn().mockResolvedValue({}),
    };
    channelInstance.on.mockReturnValue(channelInstance);
    supabase.channel.mockReturnValue(channelInstance);

    const { result } = renderHook(() =>
      useTyping({ conversationId: 'conv-1', currentUserId: 'user-1', partnerName: 'Alex' })
    );

    await act(async () => {
      result.current.sendTyping();
    });

    expect(channelInstance.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'typing',
        payload: { user_id: 'user-1' },
      })
    );
  });

  it('throttles sendTyping — second call within 1500ms does not send', async () => {
    const channelInstance = {
      on: jest.fn(),
      subscribe: jest.fn(),
      send: jest.fn().mockResolvedValue({}),
    };
    channelInstance.on.mockReturnValue(channelInstance);
    supabase.channel.mockReturnValue(channelInstance);

    const { result } = renderHook(() =>
      useTyping({ conversationId: 'conv-1', currentUserId: 'user-1', partnerName: 'Alex' })
    );

    await act(async () => { result.current.sendTyping(); });
    await act(async () => { result.current.sendTyping(); }); // throttled

    expect(channelInstance.send).toHaveBeenCalledTimes(1);
  });

  it('allows another send after throttle window expires', async () => {
    const channelInstance = {
      on: jest.fn(),
      subscribe: jest.fn(),
      send: jest.fn().mockResolvedValue({}),
    };
    channelInstance.on.mockReturnValue(channelInstance);
    supabase.channel.mockReturnValue(channelInstance);

    const { result } = renderHook(() =>
      useTyping({ conversationId: 'conv-1', currentUserId: 'user-1', partnerName: 'Alex' })
    );

    await act(async () => { result.current.sendTyping(); });
    act(() => { jest.advanceTimersByTime(1500); });
    await act(async () => { result.current.sendTyping(); });

    expect(channelInstance.send).toHaveBeenCalledTimes(2);
  });
});
