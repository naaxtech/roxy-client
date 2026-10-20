/**
 * CHAT-10 / CHAT-16 helpers for community channels.
 *  - hideSilenced: block and mute apply in channels too. The server already
 *    hides block-paired rows (132 policy); this covers the moment right after
 *    she taps Block (before any refetch) and mutes, which are hers alone.
 *  - mergeChannelMessage: an incoming realtime row is appended (or updated in
 *    place), never a whole-page refetch per message.
 *  - fetchChannelMessage: one row by id, with its author.
 */
const mockSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn(() => ({ select: mockSelect })), rpc: jest.fn() },
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { hideSilenced, mergeChannelMessage, fetchChannelMessage, type ChannelMessage } from '../../lib/channels';

const { supabase } = jest.requireMock('../../lib/supabase');

const m = (id: string, sender: string | null, at: string, extra: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id, channel_id: 'ch', sender_id: sender, body: id, created_at: at, edited_at: null, deleted_at: null,
  author: sender ? { id: sender, username: sender, display_name: sender, avatar_url: null } : null, ...extra,
});

describe('hideSilenced', () => {
  const rows = [m('1', 'ana', 't1'), m('2', 'sam', 't2'), m('3', 'bea', 't3'), m('4', null, 't4')];

  it('drops blocked and muted senders, keeps everyone else (and author-less rows)', () => {
    expect(hideSilenced(rows, ['sam'], ['bea']).map((r) => r.id)).toEqual(['1', '4']);
  });

  it('returns the same array when nobody is silenced (no re-render churn)', () => {
    expect(hideSilenced(rows, [], [])).toBe(rows);
  });
});

describe('mergeChannelMessage', () => {
  const base = [m('a', 'ana', '2026-10-11T10:00:00Z'), m('b', 'bea', '2026-10-11T10:01:00Z')];

  it('appends a new row in time order', () => {
    const out = mergeChannelMessage(base, m('c', 'cat', '2026-10-11T10:02:00Z'));
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('slots a late-arriving older row into place', () => {
    const out = mergeChannelMessage(base, m('z', 'cat', '2026-10-11T10:00:30Z'));
    expect(out.map((r) => r.id)).toEqual(['a', 'z', 'b']);
  });

  it('replaces a row it already has (edit / removal), keeping the author it had', () => {
    const removed = { ...m('b', 'bea', '2026-10-11T10:01:00Z'), deleted_at: '2026-10-11T10:05:00Z', author: null };
    const out = mergeChannelMessage(base, removed);
    expect(out).toHaveLength(2);
    expect(out[1].deleted_at).toBe('2026-10-11T10:05:00Z');
    expect(out[1].author?.display_name).toBe('bea');
  });

  it('never duplicates her own just-sent row when the realtime echo arrives', () => {
    const out = mergeChannelMessage(base, m('b', 'bea', '2026-10-11T10:01:00Z'));
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('fetchChannelMessage', () => {
  it('reads one row by id with the author join', async () => {
    mockSingle.mockResolvedValueOnce({ data: m('x', 'ana', 't'), error: null });
    const row = await fetchChannelMessage('x');
    expect(supabase.from).toHaveBeenCalledWith('community_channel_messages');
    expect((mockSelect.mock.calls[0] as unknown[])[0]).toContain('author:profiles');
    expect(mockEq).toHaveBeenCalledWith('id', 'x');
    expect(row?.id).toBe('x');
  });

  it('a row RLS hides (blocked sender) comes back as null, not an error', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchChannelMessage('hidden')).resolves.toBeNull();
  });
});
