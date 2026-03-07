import { act, renderHook } from '@testing-library/react-native';
import { useConnectStore } from '../../store/connectStore';
import { Conversation } from '../../types';

const mockConv: Conversation = {
  id: 'conv-1',
  participant_ids: ['user-1', 'user-2'],
  conversation_type: 'direct',
  last_message_at: '2026-03-04T10:00:00Z',
  roxy_nudge_count: 0,
  roxy_wingwoman_count_today: 0,
  last_roxy_call_date: null,
  created_at: '2026-03-01T00:00:00Z',
};

describe('connectStore', () => {
  beforeEach(() => {
    useConnectStore.setState({
      conversations: [],
      activeConversationId: null,
      unreadCounts: {},
    });
  });

  it('initialises with empty state', () => {
    const { result } = renderHook(() => useConnectStore());
    expect(result.current.conversations).toEqual([]);
    expect(result.current.activeConversationId).toBeNull();
    expect(result.current.unreadCounts).toEqual({});
  });

  it('setConversations replaces the list', () => {
    const { result } = renderHook(() => useConnectStore());
    act(() => result.current.setConversations([mockConv]));
    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.conversations[0].id).toBe('conv-1');
  });

  it('setActiveConversation updates activeConversationId', () => {
    const { result } = renderHook(() => useConnectStore());
    act(() => result.current.setActiveConversation('conv-1'));
    expect(result.current.activeConversationId).toBe('conv-1');
  });

  it('incrementUnread increments count for a conversation', () => {
    const { result } = renderHook(() => useConnectStore());
    act(() => result.current.incrementUnread('conv-1'));
    act(() => result.current.incrementUnread('conv-1'));
    expect(result.current.unreadCounts['conv-1']).toBe(2);
  });

  it('clearUnread resets count for a conversation', () => {
    const { result } = renderHook(() => useConnectStore());
    act(() => result.current.incrementUnread('conv-1'));
    act(() => result.current.clearUnread('conv-1'));
    expect(result.current.unreadCounts['conv-1']).toBe(0);
  });

  it('upsertConversation adds new or updates existing', () => {
    const { result } = renderHook(() => useConnectStore());
    act(() => result.current.upsertConversation(mockConv));
    expect(result.current.conversations).toHaveLength(1);
    const updated = { ...mockConv, last_message_at: '2026-03-04T11:00:00Z' };
    act(() => result.current.upsertConversation(updated));
    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.conversations[0].last_message_at).toBe('2026-03-04T11:00:00Z');
  });
});
