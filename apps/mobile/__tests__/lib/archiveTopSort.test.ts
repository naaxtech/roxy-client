const mockRows: Record<string, unknown>[] = [];

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {};
      ['select', 'eq', 'or', 'order', 'ilike'].forEach((m) => { chain[m] = () => chain; });
      chain.limit = () => Promise.resolve({ data: mockRows, error: null });
      return chain;
    },
  },
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { fetchArchiveEntries } from '../../lib/archive';

/**
 * "Top rated" has to be sorted by rating.
 *
 * It was `.order('up_count')` — the raw count of yes-votes — so it sorted by
 * POPULARITY while calling itself a rating. Verified against production before
 * the fix: The L Word sat 6th at 58% ("Divisive") and Killing Eve 10th at 60%,
 * above entries at 97%, purely on volume. Every well-liked entry with a modest
 * vote count fell off the list entirely.
 *
 * This is the one ranked list a woman uses to pick what to watch tonight.
 */

const row = (slug: string, vote_count: number, up_count: number) => ({
  id: slug, slug, title: slug, media_type: 'film', release_year: 2019,
  creator: null, length_label: null, summary: null, cover_url: null,
  cover_gradient: null, vote_count, up_count, review_count: 0,
  has_score: vote_count >= 10, published_at: '2026-08-01T00:00:00Z',
});

beforeEach(() => { mockRows.length = 0; });

describe('Top rated', () => {
  it('ranks a beloved entry above a popular divisive one', async () => {
    mockRows.push(row('divisive', 1571, 912), row('beloved', 300, 291));
    const out = await fetchArchiveEntries({ sort: 'top' });
    expect(out.map((e) => e.slug)).toEqual(['beloved', 'divisive']);
  });

  it('breaks a tie on sample size, so 100% of ten does not beat 100% of a thousand', async () => {
    mockRows.push(row('thin', 10, 10), row('thick', 1000, 1000));
    const out = await fetchArchiveEntries({ sort: 'top' });
    expect(out.map((e) => e.slug)).toEqual(['thick', 'thin']);
  });

  it('leaves the other sorts to the database', async () => {
    // 'voted' and 'newest' are orderable in SQL; only the ratio is not.
    mockRows.push(row('a', 10, 1), row('b', 20, 20));
    const out = await fetchArchiveEntries({ sort: 'voted' });
    expect(out.map((e) => e.slug)).toEqual(['a', 'b']);
  });
});
