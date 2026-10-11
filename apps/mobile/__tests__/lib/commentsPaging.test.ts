/**
 * FEED-04: comment paging, deletion, reporting and the 1000-character cap.
 *
 * `lib/supabase` is a tiny query engine over an in-memory table, so the
 * assertions cover what actually reaches the thread whichever filters the code
 * applies — not a canned response that would pass whatever the query said.
 */
import type { Comment } from '../../types';

type Row = Record<string, unknown>;
const mockDb: { comments: Row[]; comment_likes: Row[] } = { comments: [], comment_likes: [] };
const mockRpc = jest.fn();
const mockEdge = jest.fn();

jest.mock('../../lib/supabase', () => {
  const engine = (table: 'comments' | 'comment_likes') => {
    let rows = [...mockDb[table]];
    const orders: { col: string; asc: boolean }[] = [];
    let limit = Infinity;
    const q: Record<string, unknown> = {};
    const chain = (fn: () => void) => { fn(); return q; };
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => chain(() => { rows = rows.filter((r) => r[c] === v); }),
      is: (c: string, v: unknown) => chain(() => { rows = rows.filter((r) => (r[c] ?? null) === v); }),
      in: (c: string, vs: unknown[]) => chain(() => { rows = rows.filter((r) => vs.includes(r[c])); }),
      // Only the keyset shape lib/comments writes is understood; anything else
      // throws, so a changed filter cannot pass by being ignored.
      or: (expr: string) => chain(() => {
        const m = expr.match(/^created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.([^)]+)\)$/);
        if (!m) throw new Error(`unexpected or(): ${expr}`);
        const [, ts, ts2, id] = m;
        rows = rows.filter((r) => (r.created_at as string) < ts
          || ((r.created_at as string) === ts2 && (r.id as string) < id));
      }),
      order: (col: string, o?: { ascending?: boolean }) => chain(() => { orders.push({ col, asc: o?.ascending !== false }); }),
      limit: (n: number) => chain(() => { limit = n; }),
      then: (resolve: (v: unknown) => void) => {
        const sorted = [...rows].sort((x, y) => {
          for (const { col, asc } of orders) {
            const a = String(x[col]); const b = String(y[col]);
            if (a !== b) return (a < b ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
        resolve({ data: sorted.slice(0, limit), error: null });
      },
    });
    return q;
  };
  return {
    supabase: {
      from: (t: 'comments' | 'comment_likes') => engine(t),
      rpc: (...a: unknown[]) => mockRpc(...a),
    },
    callEdgeFunction: (...a: unknown[]) => mockEdge(...a),
  };
});
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import {
  COMMENT_MAX, COMMENT_PAGE, applyCommentRemoval, deleteMyComment,
  loadOlderComments, loadPostComments, oldestTopLevel, reportComment, submitComment,
} from '../../lib/comments';

const ts = (i: number) => `2026-10-01T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000000+00:00`;
const top = (i: number): Row => ({
  id: `c${String(i).padStart(3, '0')}`, post_id: 'p1', author_id: 'u2', parent_id: null,
  content: `comment ${i}`, media_url: null, gif_url: null, like_count: 0, deleted_at: null,
  created_at: ts(i),
});

beforeEach(() => {
  mockDb.comments = [];
  mockDb.comment_likes = [];
  mockRpc.mockReset();
  mockEdge.mockReset();
});

describe('loadPostComments paging', () => {
  it('a busy thread opens on its NEWEST comments, oldest-first on screen', async () => {
    mockDb.comments = Array.from({ length: 81 }, (_, i) => top(i + 1));
    const res = await loadPostComments('p1', 'me');
    expect(res.error).toBeNull();
    expect(res.comments).toHaveLength(COMMENT_PAGE);
    // The 81st (newest) is there; the cut is at the old end.
    expect(res.comments[res.comments.length - 1].id).toBe('c081');
    expect(res.comments[0].id).toBe(`c${String(81 - COMMENT_PAGE + 1).padStart(3, '0')}`);
    expect(res.hasEarlier).toBe(true);
  });

  it('pages earlier comments with no gap and no repeat, even on a tied timestamp', async () => {
    const rows = Array.from({ length: 81 }, (_, i) => top(i + 1));
    // Five comments in the same microsecond straddle the page boundary.
    for (let i = 28; i <= 33; i += 1) rows[i - 1].created_at = ts(30);
    mockDb.comments = rows;
    const first = await loadPostComments('p1', 'me');
    const older = await loadOlderComments('p1', 'me', oldestTopLevel(first.comments)!);
    const all = [...older.comments, ...first.comments].map((c) => c.id);
    expect(new Set(all).size).toBe(81);
    expect(older.hasEarlier).toBe(false);
  });

  it('brings every reply of a page, wherever the reply falls in time', async () => {
    mockDb.comments = [
      top(1), top(2),
      { ...top(3), id: 'r1', parent_id: 'c001', created_at: ts(90) },
    ];
    const res = await loadPostComments('p1', null);
    const c1 = res.comments.find((c) => c.id === 'c001');
    expect(c1?.replies?.map((r) => r.id)).toEqual(['r1']);
    expect(res.hasEarlier).toBe(false);
  });

  it('reads which comments she liked, for the whole page', async () => {
    mockDb.comments = [top(1), { ...top(2), id: 'r1', parent_id: 'c001' }];
    mockDb.comment_likes = [{ comment_id: 'r1', user_id: 'me' }, { comment_id: 'c001', user_id: 'other' }];
    const res = await loadPostComments('p1', 'me');
    expect([...res.likedIds]).toEqual(['r1']);
  });
});

describe('submitComment length', () => {
  it('refuses over 1000 characters before any request, in plain words', async () => {
    const res = await submitComment({ postId: 'p1', authorId: 'me', content: 'x'.repeat(COMMENT_MAX + 1) });
    expect(res.comment).toBeNull();
    expect(res.error).toMatch(/1000 characters/);
    expect(mockDb.comments).toHaveLength(0);
  });
});

describe('deleteMyComment', () => {
  it('calls delete_my_comment and reports what happened', async () => {
    mockRpc.mockResolvedValue({ data: 'removed', error: null });
    await expect(deleteMyComment('c1')).resolves.toBe('removed');
    expect(mockRpc).toHaveBeenCalledWith('delete_my_comment', { p_comment_id: 'c1' });
  });

  it('throws when nothing was deleted, so the row is not dropped on a no-op', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(deleteMyComment('c1')).rejects.toThrow();
  });
});

describe('applyCommentRemoval', () => {
  const nested = (): Comment[] => [
    { ...(top(1) as unknown as Comment), replies: [{ ...(top(2) as unknown as Comment), id: 'r1', parent_id: 'c001' }] },
    { ...(top(3) as unknown as Comment), replies: [] },
  ];
  it('drops a deleted reply and a deleted top-level comment', () => {
    const a = applyCommentRemoval(nested(), 'r1', 'deleted');
    expect(a[0].replies).toEqual([]);
    const b = applyCommentRemoval(nested(), 'c003', 'deleted');
    expect(b.map((c) => c.id)).toEqual(['c001']);
  });
  it('keeps a removed parent in place, blanked, with its replies', () => {
    const a = applyCommentRemoval(nested(), 'c001', 'removed');
    expect(a[0].deleted_at).not.toBeNull();
    expect(a[0].content).toBe('');
    expect(a[0].replies).toHaveLength(1);
  });
});

describe('reportComment', () => {
  it('files a comment report naming the comment', async () => {
    mockEdge.mockResolvedValue({ data: { ok: true }, error: null });
    await reportComment({ commentId: 'c1', authorId: 'u2', reason: 'harassment', detail: '  mean  ' });
    expect(mockEdge).toHaveBeenCalledWith('submit-report', {
      userId: 'u2', contentType: 'comment', contentId: 'c1', reason: 'harassment', detail: 'mean',
    });
  });
  it('rejects when the report did not land', async () => {
    mockEdge.mockResolvedValue({ data: null, error: 'boom' });
    await expect(reportComment({ commentId: 'c1', authorId: 'u2', reason: 'spam', detail: '' })).rejects.toThrow();
  });
});
