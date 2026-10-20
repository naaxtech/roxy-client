const mockFrom = jest.fn();
const mockEdge = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'me' } } } }) },
  },
  callEdgeFunction: (...a: unknown[]) => mockEdge(...a),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { deleteMyReview, reportArchiveContent, setReviewHelpful } from '../../lib/archiveSafety';

function chain(result: { error: unknown; count?: number | null }) {
  const calls: { m: string; a: unknown[] }[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['insert', 'delete', 'eq', 'select', 'in']) {
    q[m] = (...a: unknown[]) => { calls.push({ m, a }); return q; };
  }
  q.then = (res: (v: unknown) => void) => res(result);
  return { q, calls };
}

beforeEach(() => { mockFrom.mockReset(); mockEdge.mockReset(); });

describe('archiveSafety', () => {
  it('helpful on inserts her row; a duplicate counts as done', async () => {
    const c = chain({ error: { code: '23505' } });
    mockFrom.mockReturnValue(c.q);
    await expect(setReviewHelpful('r1', true)).resolves.toBeUndefined();
    expect(mockFrom).toHaveBeenCalledWith('archive_review_helpful');
    expect(c.calls[0]).toEqual({ m: 'insert', a: [{ review_id: 'r1', profile_id: 'me' }] });
  });

  it('helpful rejects on a real error so the screen rolls back', async () => {
    mockFrom.mockReturnValue(chain({ error: { code: '42501' } }).q);
    await expect(setReviewHelpful('r1', true)).rejects.toThrow();
  });

  it('delete of her review that matched nothing is not a delete', async () => {
    mockFrom.mockReturnValue(chain({ error: null, count: 0 }).q);
    await expect(deleteMyReview('r1')).rejects.toThrow();
  });

  it('report goes through submit-report with the Archive reason', async () => {
    mockEdge.mockResolvedValue({ data: { ok: true }, error: null });
    await reportArchiveContent({ contentType: 'archive_review', contentId: 'r1', userId: 'ari', reason: 'archive_spoiler' });
    expect(mockEdge).toHaveBeenCalledWith('submit-report', {
      userId: 'ari', contentType: 'archive_review', contentId: 'r1', reason: 'archive_spoiler', detail: undefined,
    });
  });
});
