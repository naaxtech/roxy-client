/**
 * FEED-01: "Hide" and "Not for me" must survive a relaunch.
 *
 * They used to write only `seen_posts`, which nothing reads, and an in-memory
 * set that started empty on every launch. Now they write `hidden_posts`
 * (migration 133), and the hidden ids are loaded at startup.
 */
import { excludeHidden, excludeSeenReels } from '../../lib/reels';

const mockInserts: { table: string; row: Record<string, unknown> }[] = [];
let mockInsertError: { message: string } | null = null;
let mockHiddenRows: { post_id: string }[] = [];

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const q: Record<string, unknown> = {};
      q.select = jest.fn(() => q);
      q.eq = jest.fn(() => q);
      q.upsert = jest.fn((row: Record<string, unknown>) => {
        mockInserts.push({ table, row });
        return Promise.resolve({ error: table === 'hidden_posts' ? mockInsertError : null });
      });
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === 'hidden_posts' ? mockHiddenRows : [], error: null }).then(resolve);
      return q;
    }),
  },
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { useFeedStore } from '../../store/feedStore';
import { useAuthStore } from '../../store/authStore';
import type { User } from '@supabase/supabase-js';

beforeEach(() => {
  mockInserts.length = 0;
  mockInsertError = null;
  mockHiddenRows = [];
  useFeedStore.setState({ hiddenPostIds: new Set(), seenPostIds: new Set() });
  useAuthStore.setState({ user: { id: 'me' } as User });
});

describe('feedStore hidden posts', () => {
  it('hidePost writes hidden_posts with the reason and hides at once', async () => {
    await useFeedStore.getState().hidePost('p1', 'not_for_me');
    expect(useFeedStore.getState().hiddenPostIds.has('p1')).toBe(true);
    expect(mockInserts).toContainEqual({
      table: 'hidden_posts', row: { post_id: 'p1', reason: 'not_for_me' },
    });
  });

  it('keeps the post hidden on this device even when the write fails, and says so', async () => {
    mockInsertError = { message: 'offline' };
    const ok = await useFeedStore.getState().hidePost('p2', 'hide');
    expect(ok).toBe(false);
    expect(useFeedStore.getState().hiddenPostIds.has('p2')).toBe(true);
  });

  it('loadHiddenPosts reads her hidden ids at startup', async () => {
    mockHiddenRows = [{ post_id: 'a' }, { post_id: 'b' }];
    await useFeedStore.getState().loadHiddenPosts();
    expect([...useFeedStore.getState().hiddenPostIds].sort()).toEqual(['a', 'b']);
  });
});

describe('excludeHidden', () => {
  it('drops every hidden row, even when that empties the page', () => {
    // excludeSeenReels hands back the whole page when every row is seen
    // ("a repeat beats a lie"). Hidden is not seen: it never comes back.
    const rows = [{ id: 'x' }, { id: 'y' }];
    expect(excludeHidden(rows, new Set(['x', 'y']))).toEqual([]);
    expect(excludeSeenReels(rows, new Set(['x', 'y']))).toEqual(rows);
  });

  it('leaves rows alone when nothing is hidden', () => {
    const rows = [{ id: 'x' }];
    expect(excludeHidden(rows, new Set())).toBe(rows);
  });
});
