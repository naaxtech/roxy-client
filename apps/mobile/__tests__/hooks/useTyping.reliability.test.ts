/**
 * Reliability regression tests for the typing indicator.
 *
 * Item 3 of the community-chat brief: "typing indicators that stop when the
 * other person stops — a stuck 'typing…' is worse than none."
 *
 * Every test here was written against the PRE-FIX hook and watched fail.
 */

jest.mock('../../lib/supabase', () => {
  const registry: any[] = [];

  const makeChannel = (topic: string) => {
    const ch: any = {
      topic: `realtime:${topic}`,
      subscribed: false,
      handlers: [],
      on: jest.fn((type: string, filter: any, cb: any) => {
        if (ch.subscribed) {
          throw new Error('cannot add callbacks after subscribe()');
        }
        ch.handlers.push({ type, filter, cb });
        return ch;
      }),
      subscribe: jest.fn(() => {
        ch.subscribed = true;
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

  return { supabase: { channel, getChannels, removeChannel }, __registry: registry };
});

import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useTyping } from '../../hooks/useTyping';

const mocked = jest.requireMock('../../lib/supabase');
const { supabase, __registry: registry } = mocked;

let appStateHandler: ((s: string) => void) | null = null;

const liveChannel = () => registry[registry.length - 1];

const emitTyping = (payload: Record<string, unknown>) => {
  const ch = liveChannel();
  const handler = ch?.handlers.find((h: any) => h.type === 'broadcast');
  if (!handler) throw new Error('no broadcast handler registered on the typing channel');
  act(() => {
    handler.cb({ payload });
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  registry.length = 0;
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
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const mount = (conversationId = 'conv-1') =>
  renderHook(
    ({ id }) => useTyping({ conversationId: id, currentUserId: 'me-1', partnerName: 'Alex' }),
    { initialProps: { id: conversationId } },
  );

describe('useTyping — the indicator has to stop', () => {
  it('clears the indicator when the sender says she stopped', () => {
    const { result } = mount();
    emitTyping({ user_id: 'partner-1', typing: true });
    expect(result.current.partnerIsTyping).toBe(true);

    emitTyping({ user_id: 'partner-1', typing: false });

    expect(result.current.partnerIsTyping).toBe(false);
  });

  it('exposes stopTyping and broadcasts the stop on the subscribed channel', async () => {
    const { result } = mount();
    const ch = liveChannel();

    await act(async () => {
      result.current.sendTyping();
    });
    await act(async () => {
      result.current.stopTyping();
    });

    expect(ch.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'typing',
        payload: { user_id: 'me-1', typing: false },
      }),
    );
  });

  it('stopTyping releases the throttle so the next keystroke is not swallowed', async () => {
    const { result } = mount();
    const ch = liveChannel();

    await act(async () => {
      result.current.sendTyping();
    });
    await act(async () => {
      result.current.stopTyping();
    });
    await act(async () => {
      result.current.sendTyping();
    });

    // start + stop + start again, all inside the 1500ms throttle window
    expect(ch.send).toHaveBeenCalledTimes(3);
  });

  it('does not carry a stuck "typing…" into a different conversation', () => {
    const { result, rerender } = mount('conv-1');
    emitTyping({ user_id: 'partner-1', typing: true });
    expect(result.current.partnerIsTyping).toBe(true);

    // Leave this thread while she is mid-sentence. The old channel is gone, so
    // no clear event can ever arrive for it.
    rerender({ id: 'conv-2' });

    expect(result.current.partnerIsTyping).toBe(false);
  });

  it('clears the indicator when the app goes to the background', () => {
    const { result } = mount();
    emitTyping({ user_id: 'partner-1', typing: true });
    expect(result.current.partnerIsTyping).toBe(true);

    if (!appStateHandler) throw new Error('useTyping never registered an AppState listener');
    act(() => {
      appStateHandler!('background');
    });

    expect(result.current.partnerIsTyping).toBe(false);
  });

  it('tells the other side she stopped when the app goes to the background', async () => {
    const { result } = mount();
    const ch = liveChannel();
    await act(async () => {
      result.current.sendTyping();
    });

    if (!appStateHandler) throw new Error('useTyping never registered an AppState listener');
    act(() => {
      appStateHandler!('background');
    });

    expect(ch.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: { user_id: 'me-1', typing: false } }),
    );
  });

  it('re-subscribes a fresh channel when the app returns to the foreground', () => {
    mount();
    const first = liveChannel();
    if (!appStateHandler) throw new Error('useTyping never registered an AppState listener');

    act(() => {
      appStateHandler!('background');
    });
    act(() => {
      appStateHandler!('active');
    });

    expect(supabase.removeChannel).toHaveBeenCalled();
    // A cached, already-subscribed channel would have thrown inside .on().
    expect(liveChannel()).not.toBe(first);
    expect(liveChannel().subscribed).toBe(true);
  });

  it('still times the indicator out when the other side never says stop', () => {
    const { result } = mount();
    emitTyping({ user_id: 'partner-1', typing: true });
    expect(result.current.partnerIsTyping).toBe(true);

    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(result.current.partnerIsTyping).toBe(false);
  });

  it('ignores a stop broadcast from her own client', () => {
    const { result } = mount();
    emitTyping({ user_id: 'partner-1', typing: true });
    emitTyping({ user_id: 'me-1', typing: false });
    expect(result.current.partnerIsTyping).toBe(true);
  });
});
