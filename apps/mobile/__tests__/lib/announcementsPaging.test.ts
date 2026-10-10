/**
 * For You paging (FEED-02a).
 *
 * The old cursor was "the oldest created_at on the page", but the page is
 * ordered by rank. A high-ranked old post on page 1 pushed the cursor back
 * past every newer, lower-ranked post, and none of those were ever fetched.
 * `feed_rank_page` (migration 133) takes a keyset on (rank, created_at, id)
 * at a fixed clock. These tests pin what the client sends.
 */
import { fetchAnnouncementPage, nextForYouCursor, toRankRows } from '../../lib/announcements';

type RpcCall = { fn: string; args: Record<string, unknown> };
const mockRpcCalls: RpcCall[] = [];
const mockRpcAnswers: { data: unknown; error: unknown }[] = [];

jest.mock('../../lib/supabase', () => {
  const makeQuery = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    let ids: string[] = [];
    q.select = jest.fn(() => q);
    q.in = jest.fn((_col: string, vals: string[]) => { ids = vals; return q; });
    q.is = jest.fn(() => q);
    q.eq = jest.fn(() => q);
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        // Storage order, deliberately reversed: the client must restore rank order.
        data: [...ids].reverse().map((id) => ({
          id, author_id: 'a', post_type: 'standard', content: id, like_count: 0,
          comment_count: 0, feed_score: 0, created_at: '2026-10-01T00:00:00Z',
          profiles: { display_name: 'A', avatar_url: null }, communities: null,
        })),
        error: null,
      }).then(resolve);
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

const AS_OF = '2026-10-10T08:00:00.123456+00:00';
const row = (id: string, rank: number, created_at: string) => ({
  post_id: id, community_id: null, rank, created_at, as_of: AS_OF,
});

beforeEach(() => {
  mockRpcCalls.length = 0;
  mockRpcAnswers.length = 0;
});

describe('fetchAnnouncementPage (For You)', () => {
  it('asks feed_rank_page for the first page with no cursor and no clock', async () => {
    mockRpcAnswers.push({ data: [row('p1', 9, '2026-10-01T00:00:00Z')], error: null });
    const { page } = await fetchAnnouncementPage({ limit: 2 });
    expect(mockRpcCalls[0]).toEqual({
      fn: 'feed_rank_page',
      args: {
        p_limit: 2, p_as_of: null, p_cursor_rank: null,
        p_cursor_created_at: null, p_cursor_id: null,
      },
    });
    expect(page?.rows.map((r) => r.id)).toEqual(['p1']);
    expect(page?.hasMore).toBe(false);
  });

  it('pages from the LAST ranked row and keeps the first page clock', async () => {
    // p-old ranks first but is the oldest. The old cursor (oldest created_at)
    // would have skipped p-new on page 2.
    mockRpcAnswers.push({
      data: [row('p-old', 50, '2026-01-01T00:00:00Z'), row('p-mid', 10, '2026-09-01T00:00:00Z')],
      error: null,
    });
    const first = await fetchAnnouncementPage({ limit: 2 });
    expect(first.page?.hasMore).toBe(true);
    expect(first.page?.cursor).toEqual({
      kind: 'keyset', asOf: AS_OF, rank: 10, createdAt: '2026-09-01T00:00:00Z', id: 'p-mid',
    });

    mockRpcAnswers.push({ data: [row('p-new', 3, '2026-10-09T00:00:00Z')], error: null });
    await fetchAnnouncementPage({ limit: 2, cursor: first.page?.cursor ?? null });
    expect(mockRpcCalls[1].args).toEqual({
      p_limit: 2, p_as_of: AS_OF, p_cursor_rank: 10,
      p_cursor_created_at: '2026-09-01T00:00:00Z', p_cursor_id: 'p-mid',
    });
  });

  it('ties on rank are told apart by created_at and id, not dropped', () => {
    const ranked = toRankRows([
      row('a', 0, '2026-10-02T00:00:00Z'),
      row('b', 0, '2026-10-01T00:00:00Z'),
    ]);
    expect(nextForYouCursor(ranked)).toEqual({
      kind: 'keyset', asOf: AS_OF, rank: 0, createdAt: '2026-10-01T00:00:00Z', id: 'b',
    });
  });

  it('restores rank order after the hydrate query answers in storage order', async () => {
    mockRpcAnswers.push({
      data: [row('p1', 3, '2026-10-01T00:00:00Z'), row('p2', 2, '2026-10-01T00:00:00Z'), row('p3', 1, '2026-10-01T00:00:00Z')],
      error: null,
    });
    const { page } = await fetchAnnouncementPage({ limit: 10 });
    expect(page?.rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('falls back to announcement_feed when 133 is not deployed yet', async () => {
    mockRpcAnswers.push({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    mockRpcAnswers.push({
      data: [{ post_id: 'p1', community_id: null, rank: 1, created_at: '2026-10-01T00:00:00Z' }],
      error: null,
    });
    const { page, error } = await fetchAnnouncementPage({ limit: 1 });
    expect(error).toBeNull();
    expect(mockRpcCalls.map((c) => c.fn)).toEqual(['feed_rank_page', 'announcement_feed']);
    expect(page?.rows.map((r) => r.id)).toEqual(['p1']);
    expect(page?.cursor).toEqual({ kind: 'legacy', before: '2026-10-01T00:00:00Z' });
  });

  it('passes any other error through instead of hiding it behind the fallback', async () => {
    mockRpcAnswers.push({ data: null, error: { code: '42501', message: 'permission denied' } });
    const { page, error } = await fetchAnnouncementPage({ limit: 1 });
    expect(page).toBeNull();
    expect(error).toMatchObject({ code: '42501' });
    expect(mockRpcCalls).toHaveLength(1);
  });
});
