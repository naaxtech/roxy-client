/**
 * Her watchlist reads the entries she saved BY ID, with the real lib/archive
 * under it and only supabase mocked.
 *
 * It used to ask the browse query for the 200 most-voted entries and narrow
 * locally. Once 138 routes browse through `archive_search`, which refuses a
 * limit over 50 (22023, HTTP 400), that request fails and You › Saved shows
 * "Could not load your watchlist" to every woman with a list. And even before,
 * an entry outside the top 200 silently fell off her list. The ids are already
 * in the store, so the screen asks for exactly those.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getSession: jest.fn() } },
}));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn(), logBreadcrumb: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { SavedWatchlist } from '../../../components/profile/SavedWatchlist';
import { useArchiveStore } from '../../../store/archiveStore';
import type { ArchiveEntry } from '../../../lib/archive';

const { supabase } = jest.requireMock('../../../lib/supabase') as {
  supabase: { rpc: jest.Mock; from: jest.Mock };
};

const row = (id: string, votes: number): ArchiveEntry => ({
  id, slug: `slug-${id}`, title: `Title ${id}`, media_type: 'film', release_year: 2019, creator: null,
  length_label: null, summary: null, cover_url: null, cover_gradient: null, vote_count: votes, up_count: 0,
  review_count: 0, has_score: false, published_at: '2026-10-01T00:00:00Z',
});

/** archive_ranked_view, answering `.in('id', ids)` with exactly the rows asked for. */
function viewById(catalogue: Map<string, ArchiveEntry>, tables: string[], asked: string[][]) {
  supabase.from.mockImplementation((table: string) => {
    tables.push(table);
    let rows: ArchiveEntry[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'range']) chain[m] = () => chain;
    chain.in = (_col: string, ids: string[]) => {
      asked.push(ids);
      rows = ids.map((id) => catalogue.get(id)).filter((r): r is ArchiveEntry => Boolean(r));
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  });
}

beforeEach(() => {
  supabase.rpc.mockReset();
  supabase.from.mockReset();
  // If anything still went through the search engine, it would get the
  // engine's real answer to limit 200.
  supabase.rpc.mockResolvedValue({
    data: null, error: { code: '22023', message: 'archive_search: limit runs from 1 to 50' }, status: 400,
  });
});

describe('SavedWatchlist reads by id', () => {
  it('a list of 60 never goes to archive_search; every saved entry is read by id and shown, most voted first', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `w${String(i).padStart(2, '0')}`);
    const catalogue = new Map(ids.map((id, i) => [id, row(id, i)]));
    const tables: string[] = [];
    const asked: string[][] = [];
    viewById(catalogue, tables, asked);
    useArchiveStore.setState({ watchlist: ids } as never);

    const { getByTestId, queryByTestId, getAllByTestId } = render(<SavedWatchlist />);
    await waitFor(() => expect(getByTestId('saved-watchlist')).toBeTruthy());
    await waitFor(() => expect(getByTestId('watchlist-slug-w00')).toBeTruthy());

    expect(queryByTestId('watchlist-error')).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(new Set(tables)).toEqual(new Set(['archive_ranked_view']));
    expect(asked.flat().sort()).toEqual(ids);
    // Votes rise with the index, so most-voted-first is the ids reversed.
    const shown = getAllByTestId(/^watchlist-slug-/).map((n) => String(n.props.testID).replace('watchlist-slug-', ''));
    expect(shown).toEqual([...ids].reverse());
  });

  it('an entry far down the vote ranking is still on her list', async () => {
    // The old over-fetch kept only the top 200 by votes.
    const catalogue = new Map([['quiet', row('quiet', 0)]]);
    viewById(catalogue, [], []);
    useArchiveStore.setState({ watchlist: ['quiet'] } as never);
    const { getByTestId } = render(<SavedWatchlist />);
    await waitFor(() => expect(getByTestId('watchlist-slug-quiet')).toBeTruthy());
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
