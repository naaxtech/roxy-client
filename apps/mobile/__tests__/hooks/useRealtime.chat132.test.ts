/**
 * useRealtime against migration 132's message model.
 *
 *  - CHAT-06: the message id is minted on the phone, so the server row and the
 *    optimistic bubble share it. The realtime echo of her own insert must
 *    SETTLE that bubble (it is in the database, so it is delivered), never add
 *    a second copy — and a message from her other device (an id this phone
 *    never minted) must still appear.
 *  - Edit / unsend: an UPDATE carries new words, edited_at or deleted_at, and
 *    the bubble on the other phone has to change with it — not only is_read.
 *  - CHAT-08: every subscription gets its own topic.
 */
jest.mock('../../lib/supabase', () => {
  const handlers: { event: string; cb: (p: unknown) => void }[] = [];
  const make = (topic: string) => {
    const ch: any = { topic: `realtime:${topic}` };
    ch.on = jest.fn((_type: string, filter: { event: string }, cb: (p: unknown) => void) => {
      handlers.push({ event: filter.event, cb });
      return ch;
    });
    ch.subscribe = jest.fn(() => ch);
    return ch;
  };
  return {
    supabase: {
      channel: jest.fn(make),
      removeChannel: jest.fn(() => Promise.resolve('ok')),
      getChannels: jest.fn(() => []),
    },
    __handlers: handlers,
  };
});

import { act, renderHook } from '@testing-library/react-native';
import { useRealtime } from '../../hooks/useRealtime';
import type { Message } from '../../types';

const { supabase, __handlers: handlers } = jest.requireMock('../../lib/supabase');

const msg = (id: string, o: Partial<Message> = {}): Message => ({
  id,
  conversation_id: 'conv-1',
  sender_id: 'partner-1',
  content: 'hello',
  media_url: null,
  message_type: 'text',
  is_read: false,
  created_at: '2026-01-01T00:00:00.000Z',
  ...o,
});

const emit = (event: 'INSERT' | 'UPDATE', row: Message) => {
  const h = handlers.filter((x: { event: string }) => x.event === event).pop();
  if (!h) throw new Error(`no ${event} handler`);
  act(() => h.cb({ new: row }));
};

const EMPTY: Message[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  handlers.length = 0;
});

describe('useRealtime — one row per message (CHAT-06)', () => {
  it('the echo of her own insert settles the bubble as sent, without a duplicate', () => {
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'me', initialMessages: EMPTY }));
    act(() => result.current.appendOptimistic(msg('c-1', { sender_id: 'me' })));
    emit('INSERT', msg('c-1', { sender_id: 'me' }));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].deliveryStatus).toBe('sent');
  });

  it('settleSend with the same id keeps exactly one bubble', () => {
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'me', initialMessages: EMPTY }));
    act(() => result.current.appendOptimistic(msg('c-1', { sender_id: 'me' })));
    emit('INSERT', msg('c-1', { sender_id: 'me' }));
    act(() => { result.current.settleSend('c-1', { data: { id: 'c-1' }, error: null }); });
    expect(result.current.messages.map((m) => m.id)).toEqual(['c-1']);
    expect(result.current.messages[0].deliveryStatus).toBe('sent');
  });

  it('a message she sent from another device still appears', () => {
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'me', initialMessages: EMPTY }));
    emit('INSERT', msg('other-device', { sender_id: 'me' }));
    expect(result.current.messages.map((m) => m.id)).toEqual(['other-device']);
  });

  it('a retried message keeps its id, so the server sees the same row', () => {
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'me', initialMessages: EMPTY }));
    act(() => result.current.appendOptimistic(msg('c-1', { sender_id: 'me' })));
    act(() => { result.current.settleSend('c-1', { data: null, error: new Error('offline') }); });
    let again: ReturnType<typeof result.current.retryMessage> = null;
    act(() => { again = result.current.retryMessage('c-1'); });
    expect(again!.id).toBe('c-1');
    expect(result.current.messages).toHaveLength(1);
  });
});

describe('useRealtime — edits and unsends reach the other phone', () => {
  it('an edit replaces the words and carries edited_at', () => {
    const initial = [msg('m1')];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'me', initialMessages: initial }));
    emit('UPDATE', msg('m1', { content: 'hello there', edited_at: '2026-01-01T00:01:00.000Z' }));
    expect(result.current.messages[0].content).toBe('hello there');
    expect(result.current.messages[0].edited_at).toBe('2026-01-01T00:01:00.000Z');
  });

  it('an unsend clears the words and media', () => {
    const initial = [msg('m1', { message_type: 'image', media_url: 'https://media.giphy.com/media/x/giphy.gif', content: null })];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'me', initialMessages: initial }));
    emit('UPDATE', msg('m1', { content: null, media_url: null, deleted_at: '2026-01-01T00:02:00.000Z' }));
    expect(result.current.messages[0].deleted_at).toBe('2026-01-01T00:02:00.000Z');
    expect(result.current.messages[0].media_url).toBeNull();
  });

  it('a read receipt still flips is_read', () => {
    const initial = [msg('m1', { sender_id: 'me' })];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'me', initialMessages: initial }));
    emit('UPDATE', msg('m1', { sender_id: 'me', is_read: true }));
    expect(result.current.messages[0].is_read).toBe(true);
  });

  it('patchMessage applies her own edit on screen straight away', () => {
    const initial = [msg('m1', { sender_id: 'me' })];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', currentUserId: 'me', initialMessages: initial }));
    act(() => result.current.patchMessage('m1', { content: 'fixed', edited_at: 'now' }));
    expect(result.current.messages[0].content).toBe('fixed');
  });
});

describe('useRealtime — unique topics (CHAT-08)', () => {
  it('subscribes on a topic of its own, never the shared cached one', () => {
    renderHook(() => useRealtime({ conversationId: 'conv-1', currentUserId: 'me', initialMessages: EMPTY }));
    const topic = (supabase.channel as jest.Mock).mock.calls[0][0] as string;
    expect(topic).toMatch(/^messages:conv-1:.+/);
  });
});
