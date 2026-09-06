import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SavedWatchlist } from '../../../components/profile/SavedWatchlist';
import { useArchiveStore } from '../../../store/archiveStore';
import type { ArchiveEntry } from '../../../lib/archive';

/**
 * Her watchlist, on You › Saved.
 *
 * The Archive lets a pending member keep a list before she can do anything else
 * on Roxy — it is the one thing she can accumulate while she waits. If it only
 * exists inside the Archive it is a list she has to remember she made.
 */

const mockPush = jest.fn();
const mockFetch = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../../lib/archive', () => {
  const actual = jest.requireActual('../../../lib/archive');
  return { ...actual, fetchArchiveEntries: (...a: unknown[]) => mockFetch(...a) };
});

const entry = (over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  id: 'e1', slug: 'carol', title: 'Carol', media_type: 'film', release_year: 2015,
  creator: 'Todd Haynes', length_label: '1h 58m', summary: 'A shopgirl.',
  cover_url: null, cover_gradient: null, vote_count: 100, up_count: 89,
  review_count: 2, has_score: true, published_at: '2026-08-01T00:00:00Z', ...over,
});

beforeEach(() => {
  mockPush.mockClear();
  mockFetch.mockReset().mockResolvedValue([entry(), entry({ id: 'e2', slug: 'bound', title: 'Bound' })]);
  useArchiveStore.setState({ watchlist: ['e1', 'e2'] } as never);
});

describe('SavedWatchlist', () => {
  it('lists what she saved', async () => {
    const { getByText } = render(<SavedWatchlist />);
    await waitFor(() => expect(getByText('Carol')).toBeTruthy());
    expect(getByText('Bound')).toBeTruthy();
  });

  it('opens an entry by slug', async () => {
    const { getByText } = render(<SavedWatchlist />);
    await waitFor(() => expect(getByText('Carol')).toBeTruthy());
    fireEvent.press(getByText('Carol'));
    expect(mockPush).toHaveBeenCalledWith('/archive/carol');
  });

  it('shows only what is on her list, not everything it fetched', async () => {
    // The query cannot filter by a client-side id list without a round trip per
    // entry, so it over-fetches and narrows here. A version that rendered the
    // whole response would put the entire Archive in her saved tab.
    useArchiveStore.setState({ watchlist: ['e2'] } as never);
    const { getByText, queryByText } = render(<SavedWatchlist />);
    await waitFor(() => expect(getByText('Bound')).toBeTruthy());
    expect(queryByText('Carol')).toBeNull();
  });

  it('renders nothing at all when her list is empty', async () => {
    // Not an empty state: this sits inside a Saved tab that already has its own
    // sections, and a second "nothing here yet" panel under the first is noise.
    useArchiveStore.setState({ watchlist: [] } as never);
    const { toJSON } = render(<SavedWatchlist />);
    await waitFor(() => expect(toJSON()).toBeNull());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('says so when the fetch fails instead of showing an empty list', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const { getByTestId } = render(<SavedWatchlist />);
    await waitFor(() => expect(getByTestId('watchlist-error')).toBeTruthy());
  });

  it('scores each row through formatScore, never its own arithmetic', async () => {
    // Unrated reads "Unreviewed" — not 0%, and not a count dressed as a score.
    useArchiveStore.setState({ watchlist: ['e3'] } as never);
    mockFetch.mockResolvedValue([entry({ id: 'e3', slug: 'new', title: 'New', vote_count: 0, up_count: 0, has_score: false })]);
    const { getByText, queryByText } = render(<SavedWatchlist />);
    await waitFor(() => expect(getByText('New')).toBeTruthy());
    expect(queryByText('0%')).toBeNull();
    expect(getByText('Unreviewed')).toBeTruthy();
  });
});
