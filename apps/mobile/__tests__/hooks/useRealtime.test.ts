jest.mock('../../lib/supabase', () => ({
  supabase: {
    channel: jest.fn(() => ({
      on: jest.fn(() => ({
        subscribe: jest.fn(),
      })),
    })),
    removeChannel: jest.fn(),
  },
}));

import { renderHook } from '@testing-library/react-native';
import { useRealtime } from '../../hooks/useRealtime';

describe('useRealtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes messages array and isSubscribed flag', () => {
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: [] })
    );
    expect(Array.isArray(result.current.messages)).toBe(true);
    expect(typeof result.current.isSubscribed).toBe('boolean');
  });

  it('starts with initialMessages', () => {
    const initial = [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        content: 'hello',
        media_url: null,
        message_type: 'text' as const,
        is_read: false,
        created_at: '2026-03-04T10:00:00Z',
      },
    ];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: initial })
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('msg-1');
  });

  it('creates a supabase channel on mount', () => {
    const { supabase: mockSupa } = jest.requireMock('../../lib/supabase');
    renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: [] })
    );
    expect(mockSupa.channel).toHaveBeenCalledWith('messages:conv-1');
  });
});
