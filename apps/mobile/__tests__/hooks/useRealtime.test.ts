jest.mock('../../lib/supabase', () => {
  const channel = jest.fn();
  const removeChannel = jest.fn();
  const on = jest.fn();
  const subscribe = jest.fn();

  on.mockReturnValue({ on, subscribe });
  channel.mockReturnValue({ on, subscribe });

  return { supabase: { channel, removeChannel } };
});

import { act, renderHook } from '@testing-library/react-native';
import { useRealtime } from '../../hooks/useRealtime';
import { Message } from '../../types';

const { supabase } = jest.requireMock('../../lib/supabase');

const makeMsg = (id: string): Message => ({
  id,
  conversation_id: 'conv-1',
  sender_id: 'user-1',
  content: 'hello',
  media_url: null,
  message_type: 'text',
  is_read: false,
  created_at: '2026-01-01T00:00:00Z',
});

describe('useRealtime', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts with empty messages when initialMessages is []', () => {
    // Use EMPTY_ARRAY stable reference to avoid infinite re-renders
    const EMPTY: Message[] = [];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'user-1', initialMessages: EMPTY })
    );
    expect(result.current.messages).toHaveLength(0);
  });

  it('syncs messages when initialMessages prop changes', () => {
    const initial: Message[] = [];
    const { result, rerender } = renderHook(
      ({ msgs }) => useRealtime({ conversationId: 'conv-1', currentUserId: 'user-1', initialMessages: msgs }),
      { initialProps: { msgs: initial } }
    );
    expect(result.current.messages).toHaveLength(0);

    // rerender with a new stable reference — simulates parent loadMessages completing
    const loaded = [makeMsg('msg-1'), makeMsg('msg-2')];
    rerender({ msgs: loaded });
    expect(result.current.messages).toHaveLength(2);
  });

  it('creates a supabase channel on mount', () => {
    const EMPTY: Message[] = [];
    renderHook(() => useRealtime({ conversationId: 'conv-1', currentUserId: 'user-1', initialMessages: EMPTY }));
    expect(supabase.channel).toHaveBeenCalledWith('messages:conv-1');
  });

  it('removeChannel is called on unmount', () => {
    const EMPTY: Message[] = [];
    const { unmount } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'user-1', initialMessages: EMPTY })
    );
    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  it('appendMessage deduplicates by id', () => {
    // stable reference — must NOT be inline array inside callback
    const initial = [makeMsg('m1')];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'user-1', initialMessages: initial })
    );
    act(() => result.current.appendMessage(makeMsg('m1'))); // duplicate
    expect(result.current.messages).toHaveLength(1);
  });

  it('appendMessage adds a new message', () => {
    const EMPTY: Message[] = [];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'user-1', initialMessages: EMPTY })
    );
    act(() => result.current.appendMessage(makeMsg('m1')));
    expect(result.current.messages).toHaveLength(1);
  });

  it('replaceMessageId swaps temp id with real id', () => {
    // stable reference — must NOT be inline array inside callback
    const tmpMsg = makeMsg('tmp-123');
    const initial = [tmpMsg];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'user-1', initialMessages: initial })
    );
    act(() => result.current.replaceMessageId('tmp-123', 'real-uuid'));
    expect(result.current.messages[0].id).toBe('real-uuid');
  });

  it('removeMessage removes a message by id', () => {
    // stable reference — must NOT be inline array inside callback
    const initial = [makeMsg('m1'), makeMsg('m2')];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'user-1', initialMessages: initial })
    );
    act(() => result.current.removeMessage('m1'));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('m2');
  });
});
