import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ArchiveEntryScreen from '../../app/archive/[slug]';
import { useArchiveStore } from '../../store/archiveStore';
import type { ArchiveEntry } from '../../lib/archive';

const mockPush = jest.fn();
let mockStatus: 'unvetted' | 'pending' | 'approved' = 'approved';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ slug: 'carol' }),
}));

jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: { id: 'u1' } }),
}));

jest.mock('../../hooks/useMembership', () => ({
  useMembership: () => ({
    status: mockStatus,
    canBrowseArchive: true,
    canReview: mockStatus !== 'pending',
    canEdit: mockStatus !== 'pending',
  }),
}));

jest.mock('../../lib/analytics', () => ({
  Analytics: {
    archiveEntryViewed: jest.fn(),
    archiveVoteCast: jest.fn(),
    archiveWatchlistAdded: jest.fn(),
    archiveReviewPublished: jest.fn(),
    archiveNoteAgreed: jest.fn(),
  },
}));

const mockFetchEntry = jest.fn();
const mockFetchDetail = jest.fn();
const mockSubmitReview = jest.fn();
jest.mock('../../lib/archive', () => {
  const actual = jest.requireActual('../../lib/archive');
  return {
    ...actual,
    fetchArchiveEntry: (...a: unknown[]) => mockFetchEntry(...a),
    fetchArchiveEntryDetail: (...a: unknown[]) => mockFetchDetail(...a),
  };
});
jest.mock('../../components/archive/composerActions', () => ({
  submitReview: (...a: unknown[]) => mockSubmitReview(...a),
}));

const entry: ArchiveEntry = {
  id: 'e1', slug: 'carol', title: 'Carol', media_type: 'film', release_year: 2015,
  creator: 'Todd Haynes', length_label: '1h 58m',
  summary: 'A shopgirl and a woman in a fur coat.',
  cover_url: null, cover_gradient: null, vote_count: 100, up_count: 89, star_sum: 420,
  review_count: 2, has_score: true, published_at: '2026-08-01T00:00:00Z',
};

const mockVote = jest.fn();
const mockToggleWatch = jest.fn();
const mockAgreeNote = jest.fn();
const mockHydrateMine = jest.fn();

function seedStore(over: Record<string, unknown> = {}) {
  useArchiveStore.setState({
    myVotes: {}, watchlist: [], noteAgreements: [],
    vote: mockVote, toggleWatch: mockToggleWatch, agreeNote: mockAgreeNote,
    hydrateMine: mockHydrateMine,
    ...over,
  } as never);
}

beforeEach(() => {
  mockPush.mockClear();
  mockStatus = 'approved';
  mockHydrateMine.mockReset().mockResolvedValue(undefined);
  mockVote.mockReset().mockResolvedValue(undefined);
  mockToggleWatch.mockReset().mockResolvedValue(undefined);
  mockAgreeNote.mockReset().mockResolvedValue(undefined);
  mockSubmitReview.mockReset().mockResolvedValue({ error: null });
  mockFetchEntry.mockReset().mockResolvedValue(entry);
  mockFetchDetail.mockReset().mockResolvedValue({
    notes: [{ id: 'n1', label: 'Period homophobia', agreeCount: 22, agreed: false }],
    reviews: [{
      id: 'r1', body: 'The gloves scene.', is_recommend: true, helpful_count: 4,
      created_at: '2026-08-02T00:00:00Z',
      author: { id: 'u2', display_name: 'Ari', username: 'ari', avatar_url: null },
    }],
  });
  seedStore();
});

describe('the Archive entry screen', () => {
  it('hydrates her existing rating so the stars refill', async () => {
    render(<ArchiveEntryScreen />);
    await waitFor(() => expect(mockHydrateMine).toHaveBeenCalledWith('u1'));
  });

  it('renders the entry, its score and its verdict', async () => {
    const { getByText } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByText('Carol')).toBeTruthy());
    expect(getByText('4.2')).toBeTruthy();
    // 420 stars across 100 votes is 4.2 / 5 (84%) — Worth your night.
    expect(getByText('Worth your night')).toBeTruthy();
  });

  it('records a star rating through the store', async () => {
    const { getByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByTestId('archive-vote-star-5')).toBeTruthy());

    fireEvent.press(getByTestId('archive-vote-star-5'));
    await waitFor(() => expect(mockVote).toHaveBeenCalledWith('e1', 5));

    fireEvent.press(getByTestId('archive-vote-star-2'));
    await waitFor(() => expect(mockVote).toHaveBeenCalledWith('e1', 2));
  });

  it('lets a PENDING member rate — that is the whole point of the feature', async () => {
    mockStatus = 'pending';
    const { getByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByTestId('archive-vote-star-5')).toBeTruthy());
    fireEvent.press(getByTestId('archive-vote-star-5'));
    await waitFor(() => expect(mockVote).toHaveBeenCalledWith('e1', 5));
  });

  it('locks writing a review for a pending member, with an explanation', async () => {
    mockStatus = 'pending';
    const { getByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByTestId('archive-write-review')).toBeTruthy());
    fireEvent.press(getByTestId('archive-write-review'));
    expect(getByTestId('archive-locked-sheet')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the composer for an approved member', async () => {
    const { getByTestId, queryByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByTestId('archive-write-review')).toBeTruthy());
    fireEvent.press(getByTestId('archive-write-review'));
    expect(queryByTestId('archive-locked-sheet')).toBeNull();
    expect(mockPush).toHaveBeenCalled();
  });

  it('toggles the watchlist, which a pending member may also do', async () => {
    mockStatus = 'pending';
    const { getByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByTestId('archive-watch')).toBeTruthy());
    fireEvent.press(getByTestId('archive-watch'));
    await waitFor(() => expect(mockToggleWatch).toHaveBeenCalledWith('e1'));
  });

  it('shows community content notes and records agreement', async () => {
    const { getByText, getByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByText('Period homophobia')).toBeTruthy());
    fireEvent.press(getByTestId('archive-note-n1'));
    await waitFor(() => expect(mockAgreeNote).toHaveBeenCalledWith('n1'));
  });

  it('shows member reviews with their author', async () => {
    const { getByText } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByText('The gloves scene.')).toBeTruthy());
    expect(getByText('Ari')).toBeTruthy();
  });

  it('says so when the entry does not exist, instead of an empty shell', async () => {
    mockFetchEntry.mockResolvedValue(null);
    const { getByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByTestId('archive-entry-missing')).toBeTruthy());
  });

  it('offers a retry when the fetch fails', async () => {
    mockFetchEntry.mockRejectedValue(new Error('offline'));
    const { getByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByTestId('archive-entry-error')).toBeTruthy());
    fireEvent.press(getByTestId('archive-entry-retry'));
    await waitFor(() => expect(mockFetchEntry).toHaveBeenCalledTimes(2));
  });

  it('posts a named review comment after she rates it', async () => {
    seedStore({ myVotes: { e1: 5 } });
    const { getByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByTestId('archive-vote-comment')).toBeTruthy());
    fireEvent.changeText(getByTestId('archive-vote-comment'), 'The gloves scene.');
    fireEvent.press(getByTestId('archive-vote-review-submit'));
    await waitFor(() =>
      expect(mockSubmitReview).toHaveBeenCalledWith('e1', 'The gloves scene.', true, true),
    );
  });

  it('hides the review comment box while she is pending', async () => {
    mockStatus = 'pending';
    const { queryByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(queryByTestId('archive-vote-star-5')).toBeTruthy());
    expect(queryByTestId('archive-vote-comment')).toBeNull();
  });

  it('offers the invitation instead of an empty ring when nobody has rated it', async () => {
    // A ring is a container for a percentage. With none it renders as an empty
    // circle with "Unreviewed" spilling past its edge — caught in a screenshot,
    // not by any assertion.
    mockFetchEntry.mockResolvedValue({ ...entry, vote_count: 0, up_count: 0, has_score: false });
    const { getByTestId, queryByTestId } = render(<ArchiveEntryScreen />);
    await waitFor(() => expect(getByTestId('archive-entry-unrated')).toBeTruthy());
    expect(queryByTestId('archive-entry-ring')).toBeNull();
  });
});
