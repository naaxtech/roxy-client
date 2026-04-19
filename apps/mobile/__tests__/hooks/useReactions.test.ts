// Must be declared before jest.mock() — BUT we use inline factory to avoid hoisting issues
jest.mock('../../lib/supabase', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  const mockSubscribe = jest.fn();
  const mockOn = jest.fn();
  const mockChannel = jest.fn();
  const mockSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  const mockSelect = jest.fn();
  const mockInsert = jest.fn();
  const mockDelete = jest.fn();
  const mockEq = jest.fn();
  const mockIn = jest.fn();
  const mockFrom = jest.fn();

  // Build channel chain: .on(...).on(...).subscribe()
  mockOn.mockReturnValue({ on: mockOn, subscribe: mockSubscribe, send: mockSend });
  mockChannel.mockReturnValue({ on: mockOn, subscribe: mockSubscribe, send: mockSend });

  // Build from chain: .select().in() / .insert().select().single() / .delete().eq().eq().eq()
  mockIn.mockResolvedValue({ data: [], error: null });
  mockSelect.mockReturnValue({ in: mockIn, single: mockSingle });
  mockSingle.mockResolvedValue({ data: null, error: null });
  mockInsert.mockReturnValue({ select: mockSelect });
  mockEq.mockReturnValue({ eq: mockEq, delete: mockDelete });
  mockDelete.mockReturnValue({ eq: mockEq });
  mockFrom.mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  });

  return {
    supabase: {
      from: mockFrom,
      channel: mockChannel,
      removeChannel: jest.fn(),
    },
  };
});

import { act, renderHook } from '@testing-library/react-native';
import { useReactions } from '../../hooks/useReactions';

const { supabase } = jest.requireMock('../../lib/supabase');

describe('useReactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset chain behaviour
    const channel = supabase.channel;
    const channelInstance = { on: jest.fn(), subscribe: jest.fn(), send: jest.fn().mockResolvedValue({}) };
    channelInstance.on.mockReturnValue(channelInstance);
    channel.mockReturnValue(channelInstance);

    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
    });
  });

  it('returns empty reactionsMap on mount with no message IDs', () => {
    const { result } = renderHook(() =>
      useReactions({ conversationId: 'conv-1', messageIds: [] })
    );
    expect(result.current.reactionsMap).toEqual({});
  });

  it('exposes addReaction and removeReaction functions', () => {
    const { result } = renderHook(() =>
      useReactions({ conversationId: 'conv-1', messageIds: [] })
    );
    expect(typeof result.current.addReaction).toBe('function');
    expect(typeof result.current.removeReaction).toBe('function');
  });

  it('subscribes to a broadcast channel on mount', () => {
    renderHook(() =>
      useReactions({ conversationId: 'conv-1', messageIds: [] })
    );
    expect(supabase.channel).toHaveBeenCalledWith('reactions:conv-1');
  });

  it('unsubscribes (removeChannel) on unmount', () => {
    const { unmount } = renderHook(() =>
      useReactions({ conversationId: 'conv-1', messageIds: [] })
    );
    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  it('addReaction applies optimistic update immediately', async () => {
    // Use empty messageIds to skip the initial fetch that would reset state
    const { result } = renderHook(() =>
      useReactions({ conversationId: 'conv-1', messageIds: [] })
    );

    await act(async () => {
      await result.current.addReaction('msg-1', '❤️', 'user-1');
    });

    const reactions = result.current.reactionsMap['msg-1'] ?? [];
    expect(reactions.some((r) => r.emoji === '❤️' && r.user_id === 'user-1')).toBe(true);
  });

  it('addReaction does not duplicate if same emoji already exists', async () => {
    const { result } = renderHook(() =>
      useReactions({ conversationId: 'conv-1', messageIds: [] })
    );

    await act(async () => {
      await result.current.addReaction('msg-1', '❤️', 'user-1');
    });
    await act(async () => {
      await result.current.addReaction('msg-1', '❤️', 'user-1');
    });

    const reactions = result.current.reactionsMap['msg-1'] ?? [];
    const hearts = reactions.filter((r) => r.emoji === '❤️' && r.user_id === 'user-1');
    expect(hearts).toHaveLength(1);
  });

  it('removeReaction removes the optimistic reaction', async () => {
    const { result } = renderHook(() =>
      useReactions({ conversationId: 'conv-1', messageIds: [] })
    );

    // Add first
    await act(async () => {
      await result.current.addReaction('msg-1', '❤️', 'user-1');
    });
    expect(result.current.reactionsMap['msg-1']).toHaveLength(1);

    // Remove
    await act(async () => {
      await result.current.removeReaction('msg-1', '❤️', 'user-1');
    });
    const remaining = result.current.reactionsMap['msg-1'] ?? [];
    expect(remaining.filter((r) => r.emoji === '❤️' && r.user_id === 'user-1')).toHaveLength(0);
  });

  it('fetches reactions from DB when messageIds is non-empty', async () => {
    renderHook(() =>
      useReactions({ conversationId: 'conv-1', messageIds: ['msg-1', 'msg-2'] })
    );
    // from() should be called to load reactions
    await act(async () => {});
    expect(supabase.from).toHaveBeenCalledWith('message_reactions');
  });
});
