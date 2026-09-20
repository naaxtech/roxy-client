const mockRows: Record<string, unknown>[] = [];
const mockOps: [string, unknown[]][] = [];

const applySorting = (rows: any[]) => {
  const orders: { col: string; asc: boolean }[] = [];
  
  // Extract order calls from the mock operations history
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
 * A sort must never empty the catalogue.
 *
 * `Top rated` filtered `has_score = true`. That was invisible while every entry
 * carried seeded vote weight — and the moment migration 104 removed the
 * fabricated votes, the Archive's DEFAULT view returned zero rows and 45 real
 * titles rendered as "The Archive is empty right now."
 *
 * The >=10 rule still matters: it stops a 100% built from one vote leading a
 * ranked list. But that is a reason to rank an unrated entry BELOW a rated one,
 * never a reason to pretend it does not exist.
 */

const row = (slug: string, vote_count: number, up_count: number) => ({
  id: slug, slug, title: slug, media_type: 'film', release_year: 2019,
  creator: null, length_label: null, summary: null, cover_url: null,
  cover_gradient: null, vote_count, up_count, review_count: 0,
  has_score: vote_count >= 10, published_at: `2026-08-0${(slug.length % 9) + 1}T00:00:00Z`,
});

beforeEach(() => { mockRows.length = 0; mockOps.length = 0; });

describe('Top rated with nothing rated', () => {
  it('returns the whole catalogue rather than nothing', async () => {
    mockRows.push(row('a', 0, 0), row('b', 0, 0), row('c', 0, 0));
    const out = await fetchArchiveEntries({ sort: 'top' });
    expect(out).toHaveLength(3);
  });

  it('never asks the database to exclude unrated rows', async () => {
    mockRows.push(row('a', 0, 0));
    await fetchArchiveEntries({ sort: 'top' });
    const filtered = mockOps.filter(([op, args]) =>
      op === 'eq' && (args as unknown[])[0] === 'has_score');
    expect(filtered).toEqual([]);
  });
});

describe('Top rated with a mix', () => {
  it('puts every rated entry above every unrated one', async () => {
    mockRows.push(row('unrated', 0, 0), row('rated-poor', 20, 4), row('rated-good', 20, 19));
    const out = await fetchArchiveEntries({ sort: 'top' });
    expect(out.map((e) => e.slug)).toEqual(['rated-good', 'rated-poor', 'unrated']);
  });

  it('ranks a gated entry below one past the gate, whatever its ratio', async () => {
    // The whole reason the gate exists: 100% off one vote must not lead a
    // ranked list. It still appears — it is simply not the top recommendation.
    mockRows.push(row('one-vote-perfect', 1, 1), row('earned', 40, 34));
    const out = await fetchArchiveEntries({ sort: 'top' });
    expect(out.map((e) => e.slug)).toEqual(['earned', 'one-vote-perfect']);
  });

  it('orders two ungated entries by ratio between themselves', async () => {
    mockRows.push(row('thin-poor', 2, 0), row('thin-good', 2, 2));
    const out = await fetchArchiveEntries({ sort: 'top' });
    expect(out.map((e) => e.slug)).toEqual(['thin-good', 'thin-poor']);
  });
});

describe('Needs ratings', () => {
  it('leads with what nobody has rated, so contributing has a front door', async () => {
    mockRows.push(row('rated', 30, 20), row('unrated', 0, 0), row('barely', 2, 1));
    const out = await fetchArchiveEntries({ sort: 'needs' });
    expect(out[0].slug).toBe('unrated');
    expect(out.map((e) => e.slug)).toHaveLength(3);
  });

  it('orders the rest by how few votes they have', async () => {
    mockRows.push(row('many', 40, 30), row('few', 3, 2), row('none', 0, 0));
    const out = await fetchArchiveEntries({ sort: 'needs' });
    expect(out.map((e) => e.slug)).toEqual(['none', 'few', 'many']);
  });
});
