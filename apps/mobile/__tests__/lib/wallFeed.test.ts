/**
 * Following / community wall paging (FEED-02b).
 *
 * The old query paged with `.lt('feed_score', cursor)`. Production has 24
 * posts tied at score 0, so every tie after the 10th on a page was skipped.
 * `wall_feed_page` (migration 133) takes a composite keyset; these tests pin
 * what the client sends and that it never drops a tied row.
 */
import { fetchWallPage, nextWallCursor } from '../../lib/wallFeed';

type RpcCall = { fn: string; args: Record<string, unknown> };
const mockRpcCalls: RpcCall[] = [];
const mockRpcAnswers: { data: unknown; error: unknown }[] = [];
const mockLegacyCalls: string[] = [];

jest.mock('../../lib/supabase', () => {
  const makeQuery = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    let ids: string[] = [];
    let byAuthor = false;
    q.select = jest.fn(() => q);
    q.in = jest.fn((col: string, vals: string[]) => {
      if (col === 'author_id') byAuthor = true;
      ids = vals;
      return q;
    });
    q.is = jest.fn(() => q);
    q.order = jest.fn(() => q);
    q.lt = jest.fn(() => q);
    q.limit = jest.fn(() => q);
    q.then = (resolve: (v: unknown) => unknown) => {
      if (byAuthor) mockLegacyCalls.push(ids.join(','));
      return Promise.resolve({
        data: byAuthor
          ? [{ id: 'legacy-1', author_id: ids[0], post_type: 'standard', content: '', like_count: 0, comment_count: 0, feed_score: 0, created_at: '2026-10-01T00:00:00Z', profiles: null, communities: null }]
          : [...ids].reverse().map((id) => ({
            id, author_id: 'a', post_type: 'standard', content: id, like_count: 0,
            comment_count: 0, feed_score: 0, created_at: '2026-10-01T00:00:00Z',
            profiles: null, communities: null,
          })),
        error: null,
      }).then(resolve);
    };
    return q;
  };
  return {
    supabase: {
      from: jest.fn(() => makeQuery()),
      rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
        mockRpcCalls.push({ fn, args });
        return Promise.resolve(mockRpcAnswers.shift() ?? { data: [], error: null });
      }),
    },
  };
});

beforeEach(() => {
  mockRpcCalls.length = 0;
  mockRpcAnswers.length = 0;
  mockLegacyCalls.length = 0;
});

const r = (post_id: string, feed_score: number, created_at: string) => ({ post_id, feed_score, created_at });

describe('fetchWallPage', () => {
  it('asks wall_feed_page with a composite cursor and the mute switch', async () => {
    mockRpcAnswers.push({
      data: [r('a', 0, '2026-10-03T00:00:00Z'), r('b', 0, '2026-10-02T00:00:00Z')],
      error: null,
    });
    const first = await fetchWallPage({ authorIds: ['u1', 'u2'], limit: 2, cursor: null, skipMuted: true });
    expect(mockRpcCalls[0]).toEqual({
      fn: 'wall_feed_page',
      args: {
        p_author_ids: ['u1', 'u2'], p_limit: 2, p_cursor_score: null,
        p_cursor_created_at: null, p_cursor_id: null, p_skip_muted: true,
      },
    });
    expect(first.page?.rows.map((x) => x.id)).toEqual(['a', 'b']);
    expect(first.page?.hasMore).toBe(true);

    // Every row tied at 0: the next page starts AFTER b by (score, created_at, id),
    // not at "score < 0", which would return nothing.
    mockRpcAnswers.push({ data: [r('c', 0, '2026-10-01T00:00:00Z')], error: null });
    const second = await fetchWallPage({ authorIds: ['u1', 'u2'], limit: 2, cursor: first.page?.cursor ?? null, skipMuted: true });
    expect(mockRpcCalls[1].args).toMatchObject({
      p_cursor_score: 0, p_cursor_created_at: '2026-10-02T00:00:00Z', p_cursor_id: 'b',
    });
    expect(second.page?.rows.map((x) => x.id)).toEqual(['c']);
    expect(second.page?.hasMore).toBe(false);
  });

  it('passes skipMuted=false when she opened that person on purpose', async () => {
    await fetchWallPage({ authorIds: ['u1'], limit: 10, cursor: null, skipMuted: false });
    expect(mockRpcCalls[0].args.p_skip_muted).toBe(false);
  });

  it('returns an empty, finished page for no authors without a round trip', async () => {
    const { page } = await fetchWallPage({ authorIds: [], limit: 10, cursor: null, skipMuted: true });
    expect(page).toEqual({ rows: [], cursor: null, hasMore: false });
    expect(mockRpcCalls).toHaveLength(0);
  });

  it('falls back to the plain query on the first page when 133 is missing', async () => {
    mockRpcAnswers.push({ data: null, error: { code: 'PGRST202', message: 'no function' } });
    const { page, error } = await fetchWallPage({ authorIds: ['u1'], limit: 10, cursor: null, skipMuted: true });
    expect(error).toBeNull();
    expect(mockLegacyCalls).toEqual(['u1']);
    expect(page?.rows.map((x) => x.id)).toEqual(['legacy-1']);
    // No keyset to continue from on the legacy path: one page, honestly.
    expect(page?.hasMore).toBe(false);
  });

  it('passes a real error through', async () => {
    mockRpcAnswers.push({ data: null, error: { code: '42501', message: 'denied' } });
    const { page, error } = await fetchWallPage({ authorIds: ['u1'], limit: 10, cursor: null, skipMuted: true });
    expect(page).toBeNull();
    expect(error).toMatchObject({ code: '42501' });
  });
});

describe('nextWallCursor', () => {
  it('is the last row, or null for an empty page', () => {
    expect(nextWallCursor([])).toBeNull();
    expect(nextWallCursor([
      { post_id: 'x', feed_score: 5, created_at: 't1' },
      { post_id: 'y', feed_score: 5, created_at: 't0' },
    ])).toEqual({ score: 5, createdAt: 't0', id: 'y' });
  });
});
