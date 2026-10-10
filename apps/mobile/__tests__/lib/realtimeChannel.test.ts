/**
 * CHAT-08: re-entering a chat inside the leave window got the dying cached
 * channel back and the screen went deaf. These pin the two rules in
 * lib/realtimeChannel: postgres_changes channels never share a topic, and a
 * broadcast room waits for its stale channel to finish leaving before joining.
 */
jest.mock('../../lib/supabase', () => {
  const registry: any[] = [];
  let pendingRemovals: (() => void)[] = [];
  const channel = jest.fn((topic: string, params?: unknown) => {
    const cached = registry.find((c) => c.topic === `realtime:${topic}`);
    if (cached) return cached;
    const ch = { topic: `realtime:${topic}`, params };
    registry.push(ch);
    return ch;
  });
  // Like the real client: the channel stays registered until the server acks.
  const removeChannel = jest.fn((ch: any) => new Promise((resolve) => {
    pendingRemovals.push(() => {
      const i = registry.indexOf(ch);
      if (i >= 0) registry.splice(i, 1);
      resolve('ok');
    });
  }));
  const getChannels = jest.fn(() => [...registry]);
  return {
    supabase: { channel, removeChannel, getChannels },
    __registry: registry,
    __ack: () => { const p = pendingRemovals; pendingRemovals = []; p.forEach((f) => f()); },
  };
});

import { freshChannel, openBroadcastChannel, typingTopic, reactionsTopic, uniqueTopic } from '../../lib/realtimeChannel';

const mocked = jest.requireMock('../../lib/supabase');
const { supabase, __registry: registry, __ack: ack } = mocked;

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  registry.length = 0;
});

describe('freshChannel (postgres_changes)', () => {
  it('never hands back a cached channel: every call is a new topic', () => {
    const a = freshChannel('messages:conv-1');
    const b = freshChannel('messages:conv-1');
    expect(a).not.toBe(b);
    expect(a.topic).not.toBe(b.topic);
    expect(a.topic.startsWith('realtime:messages:conv-1:')).toBe(true);
  });

  it('uniqueTopic keeps the readable base', () => {
    expect(uniqueTopic('global-messages:u1')).toMatch(/^global-messages:u1:[a-z0-9]+-\d+$/);
  });
});

describe('openBroadcastChannel (typing / reactions)', () => {
  it('joins the shared topic as a PRIVATE channel (membership-checked, CHAT-15)', () => {
    const setup = jest.fn();
    openBroadcastChannel(typingTopic('c1'), setup);
    expect(supabase.channel).toHaveBeenCalledWith('conv:c1:typing', expect.objectContaining({
      config: expect.objectContaining({ private: true }),
    }));
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it('a quick leave-and-return waits for the old channel to finish leaving, then joins a NEW one', async () => {
    const first = jest.fn();
    const close = openBroadcastChannel(reactionsTopic('c1'), first);
    const old = first.mock.calls[0][0];
    close();

    const second = jest.fn();
    openBroadcastChannel(reactionsTopic('c1'), second);
    // Old channel not acknowledged yet: joining now would get the dying one back.
    expect(second).not.toHaveBeenCalled();

    ack();
    await flush();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0][0]).not.toBe(old);
  });

  it('closing before the join happened cancels it', async () => {
    const first = jest.fn();
    openBroadcastChannel(typingTopic('c1'), first);
    const second = jest.fn();
    const close = openBroadcastChannel(typingTopic('c1'), second);
    close();
    ack();
    await flush();
    expect(second).not.toHaveBeenCalled();
  });

  it('topic names match what realtime_conversation_topic_ok() authorises', () => {
    expect(typingTopic('abc')).toBe('conv:abc:typing');
    expect(reactionsTopic('abc')).toBe('conv:abc:reactions');
  });
});
