jest.mock('../../../lib/archive', () => ({
  fetchArchiveEntry: jest.fn(),
}));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { renderHook, waitFor } from '@testing-library/react-native';
import { useComposerEntry } from '../../../components/archive/useComposerEntry';
import { fetchArchiveEntry } from '../../../lib/archive';
import type { ArchiveEntry } from '../../../lib/archive';

const mockFetch = fetchArchiveEntry as jest.Mock;

const entry: ArchiveEntry = {
  id: 'e1', slug: 'carol', title: 'Carol', media_type: 'film', release_year: 2015,
  creator: 'Todd Haynes', length_label: '1h 58m', summary: 'A shopgirl and a woman in a fur coat.',
  cover_url: null, cover_gradient: null, vote_count: 100, up_count: 89,
  review_count: 2, has_score: true, published_at: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('useComposerEntry', () => {
  it('loads the entry by slug and settles ready', async () => {
    mockFetch.mockResolvedValue(entry);
    const { result } = renderHook(() => useComposerEntry('carol'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.entry).toEqual(entry);
  });

  it('reports missing rather than a blank composer when no entry matches', async () => {
    mockFetch.mockResolvedValue(null);
    const { result } = renderHook(() => useComposerEntry('nope'));
    await waitFor(() => expect(result.current.status).toBe('missing'));
    expect(result.current.entry).toBeNull();
  });

  it('reports error and logs, never throwing out of the hook', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useComposerEntry('carol'));
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('does nothing until a slug exists', () => {
    renderHook(() => useComposerEntry(undefined));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
