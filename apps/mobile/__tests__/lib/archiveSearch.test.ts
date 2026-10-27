/**
 * The Archive search engine (migration 138), and the floor under it.
 *
 * Both browse and search go through `archive_search`, and the type chips go
 * through `archive_search_facets`. Production will not have 138 until the owner
 * applies it, so a missing RPC must fall back to today's ILIKE query and today's
 * five head counts. "Missing" is PostgREST's PGRST202 (the function is not in
 * its schema cache) and nothing else: a 42883 or a bare 404 can be the deployed
 * engine failing, and a fallback there would hide it behind the old search. The
 * first fallback of a session leaves one breadcrumb, with no query text. Any
 * other error is real: it is logged and thrown.
 */
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), logBreadcrumb: jest.fn() }));

import {
  fetchArchiveEntries, fetchArchiveEntriesByIds, fetchArchiveTypeCounts, ARCHIVE_SEARCH_MAX_LIMIT, type ArchiveEntry,
} from '../../lib/archive';

const { supabase } = jest.requireMock('../../lib/supabase') as {
  supabase: { rpc: jest.Mock; from: jest.Mock };
};
const { logError, logBreadcrumb } = jest.requireMock('../../lib/errorLogger') as {
  logError: jest.Mock; logBreadcrumb: jest.Mock;
};

type Call = [string, unknown[]];

/** A PostgREST builder: every filter records itself, and the chain resolves to `result`. */
function builder(result: { data?: unknown; error?: unknown; count?: number | null }, calls: Call[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit', 'range']) {
    chain[m] = (...args: unknown[]) => { calls.push([m, args]); return chain; };
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, count: null, ...result }).then(resolve, reject);
  return chain;
}

const entry = (slug: string, over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  id: slug, slug, title: slug, media_type: 'film', release_year: 2019, creator: null, length_label: null,
  summary: null, cover_url: null, cover_gradient: null, vote_count: 0, up_count: 0, review_count: 0,
  has_score: false, published_at: '2026-10-01T00:00:00Z', ...over,
});

const MISSING = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.archive_search(p_q) in the schema cache' }, status: 404 };

beforeEach(() => {
  supabase.rpc.mockReset();
  supabase.from.mockReset();
  logError.mockReset();
  logBreadcrumb.mockReset();
});

describe('fetchArchiveEntries on the search engine', () => {
  it('asks archive_search with her query, type, sort and page, and touches no table', async () => {
    supabase.rpc.mockResolvedValue({ data: [entry('portrait-of-a-lady-on-fire')], error: null, status: 200 });
    const rows = await fetchArchiveEntries({ query: '  portrat  ', mediaType: 'film', sort: 'newest', limit: 50 });
    expect(supabase.rpc).toHaveBeenCalledWith('archive_search', {
      p_q: 'portrat', p_types: ['film'], p_sort: 'newest', p_limit: 50, p_offset: 0,
    });
    expect(rows.map((r) => r.slug)).toEqual(['portrait-of-a-lady-on-fire']);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('browses with no query and no type: null filters, the default sort and page', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null, status: 200 });
    await fetchArchiveEntries();
    expect(supabase.rpc).toHaveBeenCalledWith('archive_search', {
      p_q: null, p_types: null, p_sort: 'top', p_limit: 50, p_offset: 0,
    });
  });

  it('a pasted query longer than the engine allows is cut to 100 characters, never sent to fail', async () => {
    // The search field has no maxLength; archive_search refuses q over 100
    // characters (22023). The cut counts code points as Postgres does, so an
    // emoji on the edge is kept whole rather than split into a lone surrogate.
    supabase.rpc.mockResolvedValue({ data: [], error: null, status: 200 });
    const long = `  ${'a'.repeat(99)}\u{1F308}${'b'.repeat(50)}  `;
    await fetchArchiveEntries({ query: long });
    const sent = (supabase.rpc.mock.calls[0][1] as { p_q: string }).p_q;
    expect(Array.from(sent)).toHaveLength(100);
    expect(sent.endsWith('\u{1F308}')).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('passes the offset for the next page', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null, status: 200 });
    await fetchArchiveEntries({ query: 'carol', limit: 50, offset: 50 });
    expect(supabase.rpc).toHaveBeenCalledWith('archive_search', expect.objectContaining({ p_offset: 50, p_limit: 50 }));
  });

  it('never sends archive_search a limit it refuses: a bigger page is cut to the engine bound', async () => {
    // archive_search answers limit > 50 with 22023 (HTTP 400), which is not a
    // missing RPC, so the screen would show its error state. That is how the
    // saved watchlist (limit 200) broke; it now reads by id instead.
    supabase.rpc.mockResolvedValue({ data: [], error: null, status: 200 });
    await fetchArchiveEntries({ sort: 'voted', limit: 200 });
    expect(ARCHIVE_SEARCH_MAX_LIMIT).toBe(50);
    expect(supabase.rpc).toHaveBeenCalledWith('archive_search', expect.objectContaining({ p_limit: ARCHIVE_SEARCH_MAX_LIMIT }));
  });

  it('a real error from the engine is logged and thrown, with no silent fallback', async () => {
    const err = { code: '22023', message: 'archive_search: q is longer than 100 characters' };
    supabase.rpc.mockResolvedValue({ data: null, error: err, status: 400 });
    await expect(fetchArchiveEntries({ query: 'x' })).rejects.toBe(err);
    expect(logError).toHaveBeenCalledWith(err, 'archive.fetchArchiveEntries');
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

const NOT_MISSING: [string, { data: null; error: { code: string; message: string }; status: number }][] = [
  // A function the deployed engine calls is missing: the engine is broken, not absent.
  ['42883', { data: null, error: { code: '42883', message: 'function extensions.word_similarity(text, text) does not exist' }, status: 404 }],
  ['a bare 404', { data: null, error: { code: '', message: 'Not Found' }, status: 404 }],
  ['PGRST203 (ambiguous overload)', { data: null, error: { code: 'PGRST203', message: 'Could not choose the best candidate function' }, status: 300 }],
];

describe('fetchArchiveEntries before 138 is applied', () => {
  it('PGRST202 falls back to the title/creator ILIKE on archive_ranked_view', async () => {
    supabase.rpc.mockResolvedValue(MISSING);
    const calls: Call[] = [];
    supabase.from.mockImplementation((table: string) => {
      calls.push(['from', [table]]);
      return builder({ data: [entry('carol')] }, calls);
    });
    const rows = await fetchArchiveEntries({ query: 'carol', mediaType: 'film', sort: 'voted' });
    expect(rows.map((r) => r.slug)).toEqual(['carol']);
    expect(calls).toEqual(expect.arrayContaining([
      ['from', ['archive_ranked_view']],
      ['eq', ['media_type', 'film']],
      ['or', ['title.ilike.%carol%,creator.ilike.%carol%']],
      ['order', ['vote_count', { ascending: false }]],
      ['limit', [50]],
    ]));
    expect(logError).not.toHaveBeenCalled();
  });

  it.each(NOT_MISSING)('%s is a real error: logged and thrown, with no fallback', async (_label, failed) => {
    supabase.rpc.mockResolvedValue(failed);
    await expect(fetchArchiveEntries({ query: 'carol' })).rejects.toBe(failed.error);
    expect(logError).toHaveBeenCalledWith(failed.error, 'archive.fetchArchiveEntries');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('a fallback that fails is still a real, logged error', async () => {
    supabase.rpc.mockResolvedValue(MISSING);
    const err = { code: '57014', message: 'canceling statement due to statement timeout' };
    supabase.from.mockImplementation(() => builder({ error: err }, []));
    await expect(fetchArchiveEntries({ query: 'carol' })).rejects.toBe(err);
    expect(logError).toHaveBeenCalledWith(err, 'archive.fetchArchiveEntries');
  });

  it('the first fallback of a session leaves one breadcrumb per RPC, and never her query', async () => {
    // A fresh lib/archive, so the once-per-session memory starts empty. The
    // mocks are read from inside the isolated registry, which is correct
    // whether jest hands back the shared mock instance or a fresh one.
    await jest.isolateModulesAsync(async () => {
      const lib = require('../../lib/archive') as typeof import('../../lib/archive');
      const { supabase: sb } = require('../../lib/supabase') as { supabase: { rpc: jest.Mock; from: jest.Mock } };
      const { logBreadcrumb: crumb } = require('../../lib/errorLogger') as { logBreadcrumb: jest.Mock };
      sb.rpc.mockResolvedValue(MISSING);
      sb.from.mockImplementation(() => builder({ data: [], count: 0 }, []));

      await lib.fetchArchiveEntries({ query: 'her private search' });
      await lib.fetchArchiveEntries({ query: 'another one', offset: 50 });
      await lib.fetchArchiveTypeCounts();
      await lib.fetchArchiveTypeCounts();

      expect(crumb.mock.calls).toEqual([
        ['archive_search_fallback', { rpc: 'archive_search' }],
        ['archive_search_fallback', { rpc: 'archive_search_facets' }],
      ]);
      expect(JSON.stringify(crumb.mock.calls)).not.toMatch(/private|another/);
    });
  });

  it('a real error leaves no fallback breadcrumb', async () => {
    await jest.isolateModulesAsync(async () => {
      const lib = require('../../lib/archive') as typeof import('../../lib/archive');
      const { supabase: sb } = require('../../lib/supabase') as { supabase: { rpc: jest.Mock } };
      const { logBreadcrumb: crumb } = require('../../lib/errorLogger') as { logBreadcrumb: jest.Mock };
      sb.rpc.mockResolvedValue(NOT_MISSING[0][1]);
      await expect(lib.fetchArchiveEntries({ query: 'x' })).rejects.toBeTruthy();
      expect(crumb).not.toHaveBeenCalled();
    });
  });
});

describe('fetchArchiveEntriesByIds (the saved watchlist)', () => {
  const ids = (n: number, prefix = 'id') => Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(3, '0')}`);

  it('reads the entries she saved by id from archive_ranked_view, never through archive_search', async () => {
    const calls: Call[] = [];
    supabase.from.mockImplementation((table: string) => {
      calls.push(['from', [table]]);
      return builder({ data: [entry('carol', { id: 'id-001', vote_count: 3 }), entry('bound', { id: 'id-000', vote_count: 9 })] }, calls);
    });
    const rows = await fetchArchiveEntriesByIds(['id-000', 'id-001']);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(calls).toEqual(expect.arrayContaining([
      ['from', ['archive_ranked_view']],
      ['in', ['id', ['id-000', 'id-001']]],
    ]));
    // The order the watchlist always had: most voted first, then id.
    expect(rows.map((r) => r.slug)).toEqual(['bound', 'carol']);
  });

  it('a list longer than one request allows is read in chunks, every id asked for once, ordered across chunks', async () => {
    const want = ids(230);
    const asked: string[][] = [];
    supabase.from.mockImplementation(() => {
      const calls: Call[] = [];
      const chain = builder({}, calls) as Record<string, unknown>;
      chain.in = (_col: string, values: string[]) => {
        asked.push(values);
        // Votes rise with the index, so the merged order must reverse the input.
        (chain as { result?: unknown }).result = values.map((id) => entry(id, { id, vote_count: Number(id.slice(3)) }));
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: (chain as { result?: unknown }).result ?? [], error: null }).then(resolve);
      return chain;
    });
    const rows = await fetchArchiveEntriesByIds([...want, want[0], want[5]]);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(asked.length).toBeGreaterThan(1);
    for (const chunk of asked) expect(chunk.length).toBeLessThanOrEqual(100);
    expect(asked.flat().sort()).toEqual(want);
    expect(rows.map((r) => r.id)).toEqual([...want].reverse());
  });

  it('an empty list asks for nothing', async () => {
    await expect(fetchArchiveEntriesByIds([])).resolves.toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('a failed read is logged and thrown, so the watchlist shows its error and not an empty list', async () => {
    const err = { code: '57014', message: 'canceling statement due to statement timeout' };
    supabase.from.mockImplementation(() => builder({ error: err }, []));
    await expect(fetchArchiveEntriesByIds(['id-000'])).rejects.toBe(err);
    expect(logError).toHaveBeenCalledWith(err, 'archive.fetchArchiveEntriesByIds');
  });
});

describe('fetchArchiveTypeCounts', () => {
  it('reads the counts from archive_search_facets in one request, zero for a type it omits', async () => {
    supabase.rpc.mockResolvedValue({
      data: [
        { media_type: 'film', entry_count: 12 }, { media_type: 'tv', entry_count: 10 },
        { media_type: 'book', entry_count: 11 }, { media_type: 'comic', entry_count: 6 },
      ],
      error: null,
      status: 200,
    });
    await expect(fetchArchiveTypeCounts()).resolves.toEqual({ film: 12, tv: 10, book: 11, comic: 6, music: 0 });
    expect(supabase.rpc).toHaveBeenCalledWith('archive_search_facets', {});
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('falls back to five head counts of published entries when the RPC is missing', async () => {
    supabase.rpc.mockResolvedValue(MISSING);
    const calls: Call[] = [];
    let n = 0;
    supabase.from.mockImplementation((table: string) => {
      calls.push(['from', [table]]);
      n += 1;
      return builder({ count: n }, calls);
    });
    await expect(fetchArchiveTypeCounts()).resolves.toEqual({ film: 1, tv: 2, book: 3, comic: 4, music: 5 });
    expect(supabase.from).toHaveBeenCalledTimes(5);
    expect(calls).toEqual(expect.arrayContaining([
      ['from', ['archive_entries']],
      ['select', ['id', { count: 'exact', head: true }]],
      ['eq', ['status', 'published']],
      ['eq', ['media_type', 'music']],
    ]));
  });

  it.each(NOT_MISSING)('%s from the facets is a real error, not a cue for the head counts', async (_label, failed) => {
    supabase.rpc.mockResolvedValue(failed);
    await expect(fetchArchiveTypeCounts()).rejects.toBe(failed.error);
    expect(logError).toHaveBeenCalledWith(failed.error, 'archive.fetchArchiveTypeCounts');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('a real facets error is logged and thrown, so the chips render without numbers', async () => {
    const err = { code: '42501', message: 'permission denied for function archive_search_facets' };
    supabase.rpc.mockResolvedValue({ data: null, error: err, status: 403 });
    await expect(fetchArchiveTypeCounts()).rejects.toBe(err);
    expect(logError).toHaveBeenCalledWith(err, 'archive.fetchArchiveTypeCounts');
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
