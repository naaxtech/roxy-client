/**
 * Typing + reactions on PRIVATE, membership-checked topics (CHAT-15), and
 * typing in a group (several people at once).
 *
 * The old topics `typing:<id>` / `reactions:<id>` were public: anyone who knew
 * a conversation id could join and read who is typing, or broadcast fake
 * reactions. Migration 132 authorises `conv:<id>:typing|reactions` for members
 * of the thread only — the hooks must ask for those, privately.
 */
jest.mock('../../lib/supabase', () => {
  const registry: any[] = [];
  const channel = jest.fn((topic: string, params?: unknown) => {
    const ch: any = { topic: `realtime:${topic}`, params, handlers: [] as any[] };
    ch.on = jest.fn((type: string, filter: any, cb: any) => { ch.handlers.push({ type, filter, cb }); return ch; });
    ch.subscribe = jest.fn(() => ch);
    ch.send = jest.fn().mockResolvedValue('ok');
    registry.push(ch);
    return ch;
  });
  const from = jest.fn(() => ({
    select: jest.fn(() => ({ in: jest.fn().mockResolvedValue({ data: [], error: null }) })),
  }));
  return {
    supabase: {
      channel,
      from,
      getChannels: jest.fn(() => []),
      removeChannel: jest.fn(() => Promise.resolve('ok')),
    },
    __registry: registry,
  };
});

import { act, renderHook } from '@testing-library/react-native';
import { useTyping } from '../../hooks/useTyping';
import { useReactions } from '../../hooks/useReactions';

const { supabase, __registry: registry } = jest.requireMock('../../lib/supabase');

const emit = (event: string, payload: unknown) => {
  const ch = registry[registry.length - 1];
  const h = ch.handlers.find((x: any) => x.filter?.event === event);
  act(() => h.cb({ payload }));
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  registry.length = 0;
});
afterEach(() => jest.useRealTimers());

describe('useTyping', () => {
  it('joins conv:<id>:typing as a private channel', () => {
    renderHook(() => useTyping({ conversationId: 'c1', currentUserId: 'me', partnerName: 'Ana' }));
    expect(supabase.channel).toHaveBeenCalledWith('conv:c1:typing', expect.objectContaining({
      config: expect.objectContaining({ private: true }),
    }));
  });

  it('in a group, lists everyone typing (by name) and drops each one when she stops', () => {
    const { result } = renderHook(() =>
      useTyping({ conversationId: 'c1', currentUserId: 'me', partnerName: 'Group' }));
    emit('typing', { user_id: 'ana', name: 'Ana', typing: true });
    emit('typing', { user_id: 'bea', name: 'Bea', typing: true });
    expect(result.current.typingNames).toEqual(['Ana', 'Bea']);
    expect(result.current.partnerIsTyping).toBe(true);

    emit('typing', { user_id: 'ana', typing: false });
    expect(result.current.typingNames).toEqual(['Bea']);

    act(() => { jest.advanceTimersByTime(2600); });
    expect(result.current.typingNames).toEqual([]);
    expect(result.current.partnerIsTyping).toBe(false);
  });

  it('sends her own name with the broadcast so a group can say who', async () => {
    const { result } = renderHook(() =>
      useTyping({ conversationId: 'c1', currentUserId: 'me', partnerName: 'Ana', selfName: 'Jo' }));
    const ch = registry[registry.length - 1];
    await act(async () => { result.current.sendTyping(); });
    expect(ch.send).toHaveBeenCalledWith(expect.objectContaining({
      payload: { user_id: 'me', typing: true, name: 'Jo' },
    }));
  });
});

describe('useReactions', () => {
  it('joins conv:<id>:reactions as a private channel', () => {
    renderHook(() => useReactions({ conversationId: 'c1', messageIds: [] }));
    expect(supabase.channel).toHaveBeenCalledWith('conv:c1:reactions', expect.objectContaining({
      config: expect.objectContaining({ private: true }),
    }));
  });
});
