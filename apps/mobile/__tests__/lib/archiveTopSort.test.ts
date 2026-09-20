const mockRows: Record<string, unknown>[] = [];
const mockOps: [string, unknown[]][] = [];

const applySorting = (rows: any[]) => {
  const orders: { col: string; asc: boolean }[] = [];
  
  mockOps.forEach(([op, args]) => {
    if (op === 'order') {
      const [col, options] = args as [string, { ascending: boolean }];
      orders.push({ col, asc: options.ascending });
    }
  });

  return [...rows].sort((a, b) => {
    for (const { col, asc } of orders) {
      let valA: any = a[col];
      let valB: any = b[col];

      if (col === 'calculated_percent') {
        // Mirror 123_archive_ranked_view: the number the client shows. Stars
        // normalise the average to a percentage; without stars it is the
        // recommend percentage. The mock rows carry no star_sum, so they fall
        // to the up_count branch — the same fallback the view applies.
        const calc = (r: any) => {
          const votes = r.vote_count || 0;
          const stars = r.star_sum || 0;
          const ups = r.up_count || 0;
          if (votes <= 0) return 0;
          if (stars > 0) return (stars / votes) / 5 * 100;
          return (ups / votes) * 100;
        };
        valA = calc(a);
        valB = calc(b);
      } else if (col === 'rank_priority') {
        const tier = (v: number) => (v >= 10 ? 0 : v > 0 ? 1 : 2);
        valA = tier(a.vote_count);
        valB = tier(b.vote_count);
      }

      if (valA < valB) return asc ? -1 : 1;
      if (valA > valB) return asc ? 1 : -1;
    }
    return 0;
  });
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: any = {};
      ['select', 'eq', 'or', 'order', 'ilike'].forEach((m) => { 
        chain[m] = (...args: any[]) => { mockOps.push([m, args]); return chain; }; 
      });
      chain.limit = () => Promise.resolve({ data: applySorting(mockRows), error: null });
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
    // 'voted' and 'newest' are orderable in SQL; only the ratio is not. The
    // client issues .order('vote_count', desc) and the mock plays the DB back,
    // so the most-voted entry leads.
    mockRows.push(row('a', 10, 1), row('b', 20, 20));
    const out = await fetchArchiveEntries({ sort: 'voted' });
    expect(out.map((e) => e.slug)).toEqual(['b', 'a']);
  });
});
