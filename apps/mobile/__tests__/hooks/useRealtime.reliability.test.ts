/**
 * Reliability regression tests for the chat realtime hook.
 *
 * Every test in this file was written against the PRE-FIX hook and watched
 * fail. They cover three of the five reliability items in the community-chat
 * brief:
 *
 *   1. reconnect + backfill after backgrounding
 *   2. optimistic send with a real failed state and retry
 *   5. pagination on scroll-back without duplicating rows at the seam
 */

// ---------------------------------------------------------------------------
// supabase mock — models the two behaviours that make this code hard:
//   * `supabase.channel(topic)` returns the CACHED channel when one with the
//     same topic is already registered, and `.on()` on a subscribed channel
//     throws. That is why `lib/realtimeChannel.freshChannel` exists.
//   * PostgREST query builders are thenables, not promises.
// ---------------------------------------------------------------------------
jest.mock('../../lib/supabase', () => {
  const registry: any[] = [];

  const makeChannel = (topic: string) => {
    const ch: any = {
      topic: `realtime:${topic}`,
      subscribed: false,
      statusCb: undefined,
      on: jest.fn(() => {
        if (ch.subscribed) {
          throw new Error('cannot add postgres_changes callbacks after subscribe()');
        }
        return ch;
      }),
      subscribe: jest.fn((cb?: any) => {
        ch.subscribed = true;
        ch.statusCb = cb;
        return ch;
      }),
      send: jest.fn().mockResolvedValue({}),
    };
    return ch;
  };

  const channel = jest.fn((topic: string) => {
    const cached = registry.find((c) => c.topic === `realtime:${topic}`);
    if (cached) return cached;
    const ch = makeChannel(topic);
    registry.push(ch);
    return ch;
  });

  const getChannels = jest.fn(() => [...registry]);
  const removeChannel = jest.fn((ch: any) => {
    const i = registry.indexOf(ch);
    if (i >= 0) registry.splice(i, 1);
    return Promise.resolve('ok');
  });

  const queue: any[] = [];
  const calls: any[] = [];
  const from = jest.fn(() => {
    const record: Record<string, unknown> = {};
    calls.push(record);
    const q: any = {};
    for (const m of ['select', 'eq', 'gt', 'gte', 'lt', 'lte', 'order', 'limit', 'neq']) {
      q[m] = jest.fn((...args: unknown[]) => {
        record[m] = args;
        return q;
      });
    }
    q.then = (res: any, rej: any) =>
      Promise.resolve(queue.length ? queue.shift() : { data: [], error: null }).then(res, rej);
    return q;
  });

  return {
    supabase: { channel, getChannels, removeChannel, from },
    __registry: registry,
    __queue: queue,
    __calls: calls,
  };
});

import { AppState } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useRealtime } from '../../hooks/useRealtime';
import { Message } from '../../types';

const mocked = jest.requireMock('../../lib/supabase');
const { supabase, __registry: registry, __queue: queue, __calls: calls } = mocked;

const makeMsg = (id: string, overrides: Partial<Message> = {}): Message => ({
  id,
  conversation_id: 'conv-1',
  sender_id: 'partner-1',
  content: 'hello',
  media_url: null,
  message_type: 'text',
  is_read: false,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

let appStateHandler: ((s: string) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  registry.length = 0;
  queue.length = 0;
  calls.length = 0;
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    type: string,
    cb: (s: string) => void,
  ) => {
    if (type === 'change') appStateHandler = cb;
    return { remove: jest.fn() };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const mount = (initialMessages: Message[], currentUserId = 'me-1') =>
  renderHook(() =>
    useRealtime({ conversationId: 'conv-1', currentUserId, initialMessages, pageSize: 3 }),
  );

const resume = async () => {
  if (!appStateHandler) {
    throw new Error('useRealtime never registered an AppState "change" listener');
  }
  await act(async () => {
    appStateHandler!('background');
  });
  await act(async () => {
    appStateHandler!('active');
    await Promise.resolve();
  });
};

// ===========================================================================
// 1. Reconnect after backgrounding
// ===========================================================================
describe('useRealtime — reconnect after backgrounding', () => {
  it('registers an AppState listener so a suspended socket can be noticed', () => {
    mount([makeMsg('m1')]);
    expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('re-subscribes the filtered channel when the app returns to the foreground', async () => {
    const initial = [makeMsg('m1')];
    mount(initial);
    const subscribesBefore = supabase.channel.mock.calls.length;

    await resume();

    expect(supabase.removeChannel).toHaveBeenCalled();
    expect(supabase.channel.mock.calls.length).toBeGreaterThan(subscribesBefore);
    // A stale, already-subscribed cached channel must never be reused: calling
    // .on() on one throws and takes the whole screen down.
    expect(supabase.channel).toHaveBeenLastCalledWith('messages:conv-1');
  });

  it('backfills the messages that arrived while she was away', async () => {
    const initial = [makeMsg('m1', { created_at: '2026-01-01T00:00:00.000Z' })];
    const { result } = mount(initial);
    queue.push({
      data: [
        makeMsg('missed-1', { created_at: '2026-01-01T00:05:00.000Z' }),
        makeMsg('missed-2', { created_at: '2026-01-01T00:06:00.000Z' }),
      ],
      error: null,
    });

    await resume();

    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'missed-1', 'missed-2']);
  });

  it('asks only for rows newer than what it already has, filtered to this conversation', async () => {
    const initial = [makeMsg('m1', { created_at: '2026-01-01T00:00:00.000Z' })];
    mount(initial);
    queue.push({ data: [], error: null });

    await resume();

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const backfillCall = calls[calls.length - 1];
    expect(backfillCall.eq).toEqual(['conversation_id', 'conv-1']);
    expect(backfillCall.gt).toEqual(['created_at', '2026-01-01T00:00:00.000Z']);
  });

  it('does not duplicate a message the socket already delivered', async () => {
    const initial = [makeMsg('m1'), makeMsg('m2', { created_at: '2026-01-01T00:02:00.000Z' })];
    const { result } = mount(initial);
    queue.push({
      data: [
        makeMsg('m2', { created_at: '2026-01-01T00:02:00.000Z' }),
        makeMsg('m3', { created_at: '2026-01-01T00:03:00.000Z' }),
      ],
      error: null,
    });

    await resume();

    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps an unsent optimistic message through a backfill', async () => {
    const initial = [makeMsg('m1')];
    const { result } = mount(initial);
    act(() => {
      result.current.appendOptimistic(
        makeMsg('tmp-9', { sender_id: 'me-1', created_at: '2026-01-01T09:00:00.000Z' }),
      );
    });
    queue.push({
      data: [makeMsg('missed-1', { created_at: '2026-01-01T00:05:00.000Z' })],
      error: null,
    });

    await resume();

    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    expect(result.current.messages.find((m) => m.id === 'tmp-9')?.deliveryStatus).toBe('sending');
  });

  it('backfills again once the new subscription actually reports SUBSCRIBED', async () => {
    mount([makeMsg('m1')]);
    queue.push({ data: [], error: null });
    await resume();
    const callsAfterResume = calls.length;

    queue.push({ data: [], error: null });
    const live = registry[registry.length - 1];
    await act(async () => {
      live.statusCb?.('SUBSCRIBED');
      await Promise.resolve();
    });

    expect(calls.length).toBeGreaterThan(callsAfterResume);
  });
});

// ===========================================================================
// 2. Optimistic send: a real failed state and a retry
// ===========================================================================
describe('useRealtime — optimistic send lifecycle', () => {
  it('marks an optimistic message as sending, not as sent', () => {
    const initial: Message[] = [];
    const { result } = mount(initial);
    act(() => {
      result.current.appendOptimistic(makeMsg('tmp-1', { sender_id: 'me-1' }));
    });
    expect(result.current.messages[0].deliveryStatus).toBe('sending');
  });

  it('NEVER renders a message as sent over a write that returned no row', () => {
    // A PostgREST write answers 200 with zero rows. `{ data: null, error: null }`
    // is the exact shape that shipped "Report submitted" over a write that
    // never happened.
    const initial: Message[] = [];
    const { result } = mount(initial);
    act(() => {
      result.current.appendOptimistic(makeMsg('tmp-1', { sender_id: 'me-1' }));
    });

    let settled = true;
    act(() => {
      settled = result.current.settleSend('tmp-1', { data: null, error: null });
    });

    expect(settled).toBe(false);
    expect(result.current.messages[0].deliveryStatus).toBe('failed');
  });

  it('keeps a failed message on screen instead of deleting it', () => {
    const initial: Message[] = [];
    const { result } = mount(initial);
    act(() => {
      result.current.appendOptimistic(makeMsg('tmp-1', { sender_id: 'me-1' }));
    });
    act(() => {
      result.current.settleSend('tmp-1', { data: null, error: new Error('network down') });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].deliveryStatus).toBe('failed');
  });

  it('marks a message sent and swaps in the server id only when a row came back', () => {
    const initial: Message[] = [];
    const { result } = mount(initial);
    act(() => {
      result.current.appendOptimistic(makeMsg('tmp-1', { sender_id: 'me-1' }));
    });

    let settled = false;
    act(() => {
      settled = result.current.settleSend('tmp-1', { data: { id: 'real-1' }, error: null });
    });

    expect(settled).toBe(true);
    expect(result.current.messages[0].id).toBe('real-1');
    expect(result.current.messages[0].deliveryStatus).toBe('sent');
  });

  it('retryMessage returns the failed message and puts it back into sending', () => {
    const initial: Message[] = [];
    const { result } = mount(initial);
    act(() => {
      result.current.appendOptimistic(
        makeMsg('tmp-1', { sender_id: 'me-1', content: 'are you around?' }),
      );
    });
    act(() => {
      result.current.settleSend('tmp-1', { data: null, error: new Error('offline') });
    });

    let retried: ReturnType<typeof result.current.retryMessage> = null;
    act(() => {
      retried = result.current.retryMessage('tmp-1');
    });

    expect(retried).not.toBeNull();
    expect(retried!.content).toBe('are you around?');
    expect(result.current.messages[0].deliveryStatus).toBe('sending');
  });

  it('a failed message survives the parent reloading initialMessages', () => {
    const first: Message[] = [];
    const { result, rerender } = renderHook(
      ({ msgs }) =>
        useRealtime({
          conversationId: 'conv-1',
          currentUserId: 'me-1',
          initialMessages: msgs,
          pageSize: 3,
        }),
      { initialProps: { msgs: first } },
    );
    act(() => {
      result.current.appendOptimistic(
        makeMsg('tmp-1', { sender_id: 'me-1', created_at: '2026-01-01T09:00:00.000Z' }),
      );
    });
    act(() => {
      result.current.settleSend('tmp-1', { data: null, error: new Error('offline') });
    });

    rerender({ msgs: [makeMsg('m1')] });

    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'tmp-1']);
    expect(result.current.messages[1].deliveryStatus).toBe('failed');
  });
});

// ===========================================================================
// 5. Pagination on scroll-back
// ===========================================================================
describe('useRealtime — scroll-back pagination', () => {
  it('loads an older page and prepends it in chronological order', async () => {
    const initial = [
      makeMsg('m5', { created_at: '2026-01-01T00:05:00.000Z' }),
      makeMsg('m6', { created_at: '2026-01-01T00:06:00.000Z' }),
    ];
    const { result } = mount(initial);
    // Server answers newest-first, as the screen's own query does.
    queue.push({
      data: [
        makeMsg('m4', { created_at: '2026-01-01T00:04:00.000Z' }),
        makeMsg('m3', { created_at: '2026-01-01T00:03:00.000Z' }),
        makeMsg('m2', { created_at: '2026-01-01T00:02:00.000Z' }),
      ],
      error: null,
    });

    await act(async () => {
      await result.current.loadOlder();
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['m2', 'm3', 'm4', 'm5', 'm6']);
  });

  it('keeps the newest message last so an inverted list does not jump', async () => {
    const initial = [
      makeMsg('m5', { created_at: '2026-01-01T00:05:00.000Z' }),
      makeMsg('m6', { created_at: '2026-01-01T00:06:00.000Z' }),
    ];
    const { result } = mount(initial);
    queue.push({
      data: [makeMsg('m4', { created_at: '2026-01-01T00:04:00.000Z' })],
      error: null,
    });

    await act(async () => {
      await result.current.loadOlder();
    });

    const ids = result.current.messages.map((m) => m.id);
    expect(ids[ids.length - 1]).toBe('m6');
    expect(ids.indexOf('m5')).toBeLessThan(ids.indexOf('m6'));
  });

  it('does not duplicate the row that straddles the seam', async () => {
    const initial = [
      makeMsg('m3', { created_at: '2026-01-01T00:03:00.000Z' }),
      makeMsg('m4', { created_at: '2026-01-01T00:04:00.000Z' }),
    ];
    const { result } = mount(initial);
    // Inclusive boundary: the oldest known row comes back again in the page.
    queue.push({
      data: [
        makeMsg('m3', { created_at: '2026-01-01T00:03:00.000Z' }),
        makeMsg('m2', { created_at: '2026-01-01T00:02:00.000Z' }),
        makeMsg('m1', { created_at: '2026-01-01T00:01:00.000Z' }),
      ],
      error: null,
    });

    await act(async () => {
      await result.current.loadOlder();
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('queries older rows filtered to this conversation only', async () => {
    const initial = [makeMsg('m3', { created_at: '2026-01-01T00:03:00.000Z' })];
    const { result } = mount(initial);
    queue.push({ data: [], error: null });

    await act(async () => {
      await result.current.loadOlder();
    });

    const older = calls[calls.length - 1];
    expect(older.eq).toEqual(['conversation_id', 'conv-1']);
    expect(older.lte).toEqual(['created_at', '2026-01-01T00:03:00.000Z']);
    expect(older.limit).toEqual([3]);
  });

  it('stops asking once a short page comes back', async () => {
    const initial = [makeMsg('m3', { created_at: '2026-01-01T00:03:00.000Z' })];
    const { result } = mount(initial);
    expect(result.current.hasMoreOlder).toBe(true);

    queue.push({
      data: [makeMsg('m2', { created_at: '2026-01-01T00:02:00.000Z' })],
      error: null,
    });
    await act(async () => {
      await result.current.loadOlder();
    });

    expect(result.current.hasMoreOlder).toBe(false);

    const before = calls.length;
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(calls.length).toBe(before);
  });

  it('stops asking when a full page adds nothing new', async () => {
    const initial = [
      makeMsg('a1', { created_at: '2026-01-01T00:01:00.000Z' }),
      makeMsg('a2', { created_at: '2026-01-01T00:02:00.000Z' }),
      makeMsg('a3', { created_at: '2026-01-01T00:03:00.000Z' }),
    ];
    const { result } = mount(initial);
    queue.push({
      data: [
        makeMsg('a1', { created_at: '2026-01-01T00:01:00.000Z' }),
        makeMsg('a1', { created_at: '2026-01-01T00:01:00.000Z' }),
        makeMsg('a1', { created_at: '2026-01-01T00:01:00.000Z' }),
      ],
      error: null,
    });

    await act(async () => {
      await result.current.loadOlder();
    });

    expect(result.current.hasMoreOlder).toBe(false);
  });

  it('a failed page leaves the transcript untouched and stays retryable', async () => {
    const initial = [makeMsg('m3', { created_at: '2026-01-01T00:03:00.000Z' })];
    const { result } = mount(initial);
    queue.push({ data: null, error: { message: 'network' } });

    let added = -1;
    await act(async () => {
      added = await result.current.loadOlder();
    });

    expect(added).toBe(0);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.hasMoreOlder).toBe(true);
  });
});
