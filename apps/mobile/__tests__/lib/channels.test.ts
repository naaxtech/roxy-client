const mockRows: Record<string, unknown>[] = [];
const mockOps: [string, unknown[]][] = [];
const mockResult: { data: unknown; error: unknown; count: number | null } = {
  data: null, error: null, count: null,
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockOps.push(['from', [table]]);
      const chain: Record<string, unknown> = {};
      ['select', 'eq', 'lte', 'insert', 'update'].forEach((m) => {
        chain[m] = (...args: unknown[]) => { mockOps.push([m, args]); return chain; };
      });
      chain.order = (...args: unknown[]) => { mockOps.push(['order', args]); return chain; };
      chain.limit = (...args: unknown[]) => {
        mockOps.push(['limit', args]);
        return Promise.resolve({ data: mockRows, error: null });
      };
      chain.single = () => Promise.resolve({ data: mockResult.data, error: mockResult.error });
      // An update chain is awaited directly — no .limit, no .single.
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mockResult.data, error: mockResult.error, count: mockResult.count })
          .then(resolve);
      return chain;
    },
  },
}));

import {
  fetchChannels, fetchChannelMessages, fetchOlderChannelMessages, prependOlder, MESSAGE_PAGE,
  sendChannelMessage, deleteChannelMessage,
  authorName, channelLabel, initialChannel, MAX_MESSAGE_LENGTH,
  type Channel, type ChannelMessage,
} from '../../lib/channels';

const channel = (over: Partial<Channel> = {}): Channel => ({
  id: 'c1', community_id: 'com1', slug: 'general',
  topic: null, position: 0, is_default: false, ...over,
});

const message = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id: 'm1', channel_id: 'c1', sender_id: 'u1', body: 'hi',
  created_at: '2026-09-05T10:00:00Z', edited_at: null, deleted_at: null,
  author: { id: 'u1', username: 'maya', display_name: 'Maya', avatar_url: null },
  ...over,
});

const opNames = () => mockOps.map(([m]) => m);
const argsOf = (op: string) => mockOps.filter(([m]) => m === op).map(([, a]) => a);

beforeEach(() => {
  mockRows.length = 0;
  mockOps.length = 0;
  mockResult.data = null;
  mockResult.error = null;
  mockResult.count = null;
});

describe('fetchChannels', () => {
  it('orders by position, not by when a moderator happened to add one', async () => {
    // Sorting by created_at makes the chip row reshuffle itself the moment a
    // new channel appears, which moves every target under her thumb.
    mockRows.push({ ...channel() });
    await fetchChannels('com1');
    expect(argsOf('order')[0][0]).toBe('position');
  });

  it('asks only for this community', async () => {
    mockRows.push({ ...channel() });
    await fetchChannels('com1');
    expect(argsOf('eq')).toContainEqual(['community_id', 'com1']);
  });
});

describe('fetchChannelMessages', () => {
  it('loads the NEWEST page and hands it back oldest-first', async () => {
    // A channel with 4,000 messages must not load from the beginning of time
    // to show today — but it must still read top-to-bottom on screen.
    mockRows.push(
      { ...message({ id: 'newest', created_at: '2026-09-05T12:00:00Z' }) },
      { ...message({ id: 'oldest', created_at: '2026-09-05T09:00:00Z' }) },
    );
    const out = await fetchChannelMessages('c1');
    expect(argsOf('order')[0]).toEqual(['created_at', { ascending: false }]);
    expect(out.map((m) => m.id)).toEqual(['oldest', 'newest']);
  });

  it('caps the page rather than fetching a whole channel', async () => {
    mockRows.push({ ...message() });
    await fetchChannelMessages('c1');
    expect(opNames()).toContain('limit');
  });
});

describe('fetchOlderChannelMessages (CHAT-16: history past the first 50)', () => {
  it('asks for the page at or before the oldest loaded row, newest first, and hands it back oldest-first', async () => {
    mockRows.push(
      { ...message({ id: 'b', created_at: '2026-09-04T12:00:00Z' }) },
      { ...message({ id: 'a', created_at: '2026-09-04T09:00:00Z' }) },
    );
    const out = await fetchOlderChannelMessages('c1', '2026-09-05T09:00:00Z');
    expect(argsOf('eq')).toContainEqual(['channel_id', 'c1']);
    // lte, not lt: two messages in the same instant must not lose the second.
    expect(argsOf('lte')).toContainEqual(['created_at', '2026-09-05T09:00:00Z']);
    expect(argsOf('order')[0]).toEqual(['created_at', { ascending: false }]);
    expect(argsOf('limit')[0]).toEqual([MESSAGE_PAGE]);
    expect(out.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('prependOlder', () => {
  const loaded = [message({ id: 'm3', created_at: '2026-09-05T10:00:00Z' }), message({ id: 'm4', created_at: '2026-09-05T11:00:00Z' })];

  it('puts the older page above what she is reading and counts only new rows', () => {
    const older = [message({ id: 'm1', created_at: '2026-09-04T10:00:00Z' }), message({ id: 'm3', created_at: '2026-09-05T10:00:00Z' })];
    const r = prependOlder(loaded, older, MESSAGE_PAGE);
    expect(r.messages.map((m) => m.id)).toEqual(['m1', 'm3', 'm4']);
    expect(r.added).toBe(1);
  });

  it('there is more only when a full page came back with something new', () => {
    const full = Array.from({ length: MESSAGE_PAGE }, (_, i) =>
      message({ id: `o${i}`, created_at: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 1000).toISOString() }));
    expect(prependOlder(loaded, full, MESSAGE_PAGE).hasMore).toBe(true);
    expect(prependOlder(loaded, full.slice(0, 3), MESSAGE_PAGE).hasMore).toBe(false);
    // A full page of rows she already has (all one instant): stop, don't loop.
    const dupes = Array.from({ length: MESSAGE_PAGE }, () => loaded[0]);
    const r = prependOlder(loaded, dupes, MESSAGE_PAGE);
    expect(r.hasMore).toBe(false);
    expect(r.messages).toBe(loaded);
  });
});

describe('sendChannelMessage', () => {
  it('returns the stored row, because 200 is not evidence of a write', async () => {
    // PostgREST answers 200 for a write that matched zero rows. Only a
    // returned row proves the message exists.
    mockResult.data = message({ body: 'hello' });
    const out = await sendChannelMessage('c1', 'u1', '  hello  ');
    expect(out.id).toBe('m1');
    expect(argsOf('insert')[0][0]).toMatchObject({ channel_id: 'c1', sender_id: 'u1', body: 'hello' });
  });

  it('refuses an empty message before it reaches the network', async () => {
    await expect(sendChannelMessage('c1', 'u1', '   ')).rejects.toThrow(/Nothing to send/);
    expect(opNames()).not.toContain('insert');
  });

  it('refuses an over-long one with the reason, not a 400', async () => {
    const tooLong = 'x'.repeat(MAX_MESSAGE_LENGTH + 1);
    await expect(sendChannelMessage('c1', 'u1', tooLong)).rejects.toThrow(/2000 characters/);
    expect(opNames()).not.toContain('insert');
  });

  it('throws when the insert came back with nothing', async () => {
    mockResult.data = null;
    await expect(sendChannelMessage('c1', 'u1', 'hi')).rejects.toThrow(/did not send/);
  });
});

describe('deleteChannelMessage', () => {
  it('soft-deletes: migration 105 grants no DELETE on the table at all', async () => {
    mockResult.count = 1;
    await deleteChannelMessage('m1');
    expect(argsOf('update')[0][0]).toHaveProperty('deleted_at');
    expect(argsOf('update')[0][1]).toEqual({ count: 'exact' });
    expect(opNames()).not.toContain('delete');
  });

  it('treats a zero-row update as a refusal, not a success', async () => {
    // RLS choosing no rows returns 200 with count 0. Announcing "removed" over
    // that is how a moderation action gets reported that never happened.
    mockResult.count = 0;
    await expect(deleteChannelMessage('m1')).rejects.toThrow(/could not be removed/);
  });
});

describe('authorName', () => {
  it('prefers the display name, falls back to the username', () => {
    expect(authorName({ id: 'u', username: 'maya', display_name: 'Maya', avatar_url: null })).toBe('Maya');
    expect(authorName({ id: 'u', username: 'maya', display_name: '  ', avatar_url: null })).toBe('maya');
  });

  it('names a deleted account without exposing an id', () => {
    // sender_id is nullable so a deleted account does not take the thread with
    // it. What must never appear in its place is a raw uuid.
    expect(authorName(null)).toBe('Someone who left');
    expect(authorName({ id: 'u', username: null, display_name: null, avatar_url: null }))
      .toBe('Someone who left');
  });
});

describe('channelLabel', () => {
  it('adds the sigil at render, because the stored slug has none', () => {
    // Storing '#general' would put the '#' in every URL.
    expect(channelLabel(channel({ slug: 'introductions' }))).toBe('# introductions');
  });
});

describe('initialChannel', () => {
  it('opens on the default', () => {
    const first = channel({ id: 'a', slug: 'a' });
    const def = channel({ id: 'b', slug: 'b', is_default: true });
    expect(initialChannel([first, def])?.id).toBe('b');
  });

  it('falls back to the first when no channel is marked default', () => {
    expect(initialChannel([channel({ id: 'a' }), channel({ id: 'b' })])?.id).toBe('a');
  });

  it('returns null for a community with none, rather than inventing one', () => {
    expect(initialChannel([])).toBeNull();
  });
});
