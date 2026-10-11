/**
 * ARC-07: the Archive list pages past 50, refreshes, and a slow earlier
 * search can never overwrite a later one.
 */
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), auth: { getSession: jest.fn() } } }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/archive', () => {
  const actual = jest.requireActual('../../lib/archive');
  return { ...actual, fetchArchiveEntries: jest.fn() };
});

import { act } from '@testing-library/react-native';
import { useArchiveStore, ARCHIVE_PAGE } from '../../store/archiveStore';
import type { ArchiveEntry } from '../../lib/archive';

const { fetchArchiveEntries } = jest.requireMock('../../lib/archive') as { fetchArchiveEntries: jest.Mock };

const e = (id: string): ArchiveEntry => ({
  id, slug: id, title: id, media_type: 'film', release_year: null, creator: null, length_label: null,
  summary: null, cover_url: null, cover_gradient: null, vote_count: 0, up_count: 0, review_count: 0,
  has_score: false, published_at: null,
});
const page = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => e(`${prefix}${i}`));

beforeEach(() => {
  fetchArchiveEntries.mockReset();
  useArchiveStore.setState({
    entries: [], loading: false, error: null, hasMore: false, loadingMore: false, refreshing: false,
    filters: { query: '', mediaType: null, sort: 'top' },
  } as never);
});

describe('archiveStore paging and races', () => {
  it('a slower earlier load never overwrites the later one', async () => {
    let releaseFirst: (v: ArchiveEntry[]) => void = () => undefined;
    fetchArchiveEntries
      .mockImplementationOnce(() => new Promise((r) => { releaseFirst = r; }))
      .mockResolvedValueOnce([e('carol')]);
    const first = useArchiveStore.getState().load();
    useArchiveStore.getState().setFilters({ query: 'carol' });
    await act(async () => { await useArchiveStore.getState().load(); });
    await act(async () => { releaseFirst([e('stale')]); await first; });
    expect(useArchiveStore.getState().entries.map((x) => x.id)).toEqual(['carol']);
    expect(useArchiveStore.getState().loading).toBe(false);
  });

  it('a full page means there may be more; loadMore asks for the next offset and appends', async () => {
    fetchArchiveEntries.mockResolvedValueOnce(page('a', ARCHIVE_PAGE)).mockResolvedValueOnce(page('b', 3));
    await act(async () => { await useArchiveStore.getState().load(); });
    expect(useArchiveStore.getState().hasMore).toBe(true);
    await act(async () => { await useArchiveStore.getState().loadMore(); });
    expect(fetchArchiveEntries).toHaveBeenLastCalledWith(expect.objectContaining({ offset: ARCHIVE_PAGE, limit: ARCHIVE_PAGE }));
    expect(useArchiveStore.getState().entries).toHaveLength(ARCHIVE_PAGE + 3);
    expect(useArchiveStore.getState().hasMore).toBe(false);
  });

  it('loadMore does nothing when the list is complete', async () => {
    fetchArchiveEntries.mockResolvedValueOnce(page('a', 2));
    await act(async () => { await useArchiveStore.getState().load(); });
    await act(async () => { await useArchiveStore.getState().loadMore(); });
    expect(fetchArchiveEntries).toHaveBeenCalledTimes(1);
  });

  it('refresh reloads from the top and clears its own spinner', async () => {
    fetchArchiveEntries.mockResolvedValueOnce([e('fresh')]);
    useArchiveStore.setState({ entries: [e('old')] } as never);
    await act(async () => { await useArchiveStore.getState().refresh(); });
    expect(useArchiveStore.getState().entries.map((x) => x.id)).toEqual(['fresh']);
    expect(useArchiveStore.getState().refreshing).toBe(false);
  });
});
