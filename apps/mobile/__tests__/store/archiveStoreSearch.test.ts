/**
 * The browse store on the search engine, with the REAL lib/archive under it.
 *
 * archiveStorePaging mocks fetchArchiveEntries away; this one does not, so it
 * proves what the screen actually sends: her search, her type chip and her sort
 * reach `archive_search`, the next page asks for the next offset, and a missing
 * RPC (production before 138) still fills the list through the ILIKE fallback.
 */
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getSession: jest.fn() } } }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), logBreadcrumb: jest.fn() }));

import { act } from '@testing-library/react-native';
import { useArchiveStore, ARCHIVE_PAGE } from '../../store/archiveStore';
import type { ArchiveEntry } from '../../lib/archive';

const { supabase } = jest.requireMock('../../lib/supabase') as {
  supabase: { rpc: jest.Mock; from: jest.Mock };
};

const e = (id: string): ArchiveEntry => ({
  id, slug: id, title: id, media_type: 'book', release_year: null, creator: null, length_label: null,
  summary: null, cover_url: null, cover_gradient: null, vote_count: 0, up_count: 0, review_count: 0,
  has_score: false, published_at: null,
});
const page = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => e(`${prefix}${i}`));

function ilikeBuilder(rows: ArchiveEntry[], calls: string[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'or', 'order', 'limit', 'range']) {
    chain[m] = (...args: unknown[]) => { calls.push(`${m}:${JSON.stringify(args)}`); return chain; };
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return chain;
}

beforeEach(() => {
  supabase.rpc.mockReset();
  supabase.from.mockReset();
  useArchiveStore.setState({
    entries: [], loading: false, error: null, hasMore: false, loadingMore: false, refreshing: false,
    filters: { query: '', mediaType: null, sort: 'top' },
  } as never);
});

describe('archiveStore search and browse through archive_search', () => {
  it('load sends her search, type chip and sort to the RPC and shows what it returns', async () => {
    supabase.rpc.mockResolvedValue({ data: [e('fingersmith'), e('tipping-the-velvet')], error: null, status: 200 });
    useArchiveStore.getState().setFilters({ query: 'sarah watres', mediaType: 'book', sort: 'newest' });
    await act(async () => { await useArchiveStore.getState().load(); });
    expect(supabase.rpc).toHaveBeenCalledWith('archive_search', {
      p_q: 'sarah watres', p_types: ['book'], p_sort: 'newest', p_limit: ARCHIVE_PAGE, p_offset: 0,
    });
    const s = useArchiveStore.getState();
    expect(s.entries.map((x) => x.id)).toEqual(['fingersmith', 'tipping-the-velvet']);
    expect(s.error).toBeNull();
    expect(s.loading).toBe(false);
  });

  it('loadMore asks the RPC for the next offset with the same filters', async () => {
    supabase.rpc
      .mockResolvedValueOnce({ data: page('a', ARCHIVE_PAGE), error: null, status: 200 })
      .mockResolvedValueOnce({ data: page('b', 2), error: null, status: 200 });
    useArchiveStore.getState().setFilters({ query: 'the', sort: 'voted' });
    await act(async () => { await useArchiveStore.getState().load(); });
    await act(async () => { await useArchiveStore.getState().loadMore(); });
    expect(supabase.rpc).toHaveBeenLastCalledWith('archive_search', {
      p_q: 'the', p_types: null, p_sort: 'voted', p_limit: ARCHIVE_PAGE, p_offset: ARCHIVE_PAGE,
    });
    expect(useArchiveStore.getState().entries).toHaveLength(ARCHIVE_PAGE + 2);
    expect(useArchiveStore.getState().hasMore).toBe(false);
  });

  it('with the RPC missing, the list still loads through the ILIKE fallback', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 });
    const calls: string[] = [];
    supabase.from.mockImplementation(() => ilikeBuilder([e('carol')], calls));
    useArchiveStore.getState().setFilters({ query: 'carol' });
    await act(async () => { await useArchiveStore.getState().load(); });
    const s = useArchiveStore.getState();
    expect(s.entries.map((x) => x.id)).toEqual(['carol']);
    expect(s.error).toBeNull();
    expect(calls).toContain('or:["title.ilike.%carol%,creator.ilike.%carol%"]');
  });

  it('a real engine error shows the retry state, not an empty Archive', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' }, status: 500 });
    useArchiveStore.setState({ entries: [e('kept')] } as never);
    await act(async () => { await useArchiveStore.getState().load(); });
    const s = useArchiveStore.getState();
    expect(s.error).toBe("We couldn't load the Archive. Pull to try again.");
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
