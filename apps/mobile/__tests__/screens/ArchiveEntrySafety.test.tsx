/**
 * ARC-01 / 02 / 03 / 05 / 06 / 12 — the Archive entry screen.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ArchiveEntry } from '../../lib/archive';

const mockPush = jest.fn();
let mockStatus: 'pending' | 'approved' = 'approved';
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ slug: 'carol' }),
}));
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: 'me' } }),
}));
jest.mock('../../hooks/useMembership', () => ({
  useMembership: () => ({
    status: mockStatus, canBrowseArchive: true,
    canReview: mockStatus !== 'pending', canEdit: mockStatus !== 'pending',
  }),
}));
jest.mock('../../lib/analytics', () => ({
  Analytics: new Proxy({}, { get: () => jest.fn() }),
}));
const mockFetchEntry = jest.fn();
const mockFetchDetail = jest.fn();
jest.mock('../../lib/archive', () => {
  const actual = jest.requireActual('../../lib/archive');
  return {
    ...actual,
    fetchArchiveEntry: (...a: unknown[]) => mockFetchEntry(...a),
    fetchArchiveEntryDetail: (...a: unknown[]) => mockFetchDetail(...a),
  };
});
const mockSubmitReview = jest.fn();
jest.mock('../../components/archive/composerActions', () => ({
  submitReview: (...a: unknown[]) => mockSubmitReview(...a),
}));
const mockMyHelpful = jest.fn();
const mockSetHelpful = jest.fn();
const mockDeleteReview = jest.fn();
const mockReport = jest.fn();
jest.mock('../../lib/archiveSafety', () => ({
  fetchMyHelpful: (...a: unknown[]) => mockMyHelpful(...a),
  setReviewHelpful: (...a: unknown[]) => mockSetHelpful(...a),
  deleteMyReview: (...a: unknown[]) => mockDeleteReview(...a),
  reportArchiveContent: (...a: unknown[]) => mockReport(...a),
}));
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() }, callEdgeFunction: jest.fn() }));
const mockShelfIds = jest.fn();
const mockSetShelf = jest.fn();
jest.mock('../../lib/profileExtras', () => ({
  fetchArchiveShelf: (...a: unknown[]) => mockShelfIds(...a),
  setArchiveShelf: (...a: unknown[]) => mockSetShelf(...a),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import ArchiveEntryScreen from '../../app/archive/[slug]';
import { useArchiveStore } from '../../store/archiveStore';
import { useSafetyStore } from '../../store/safetyStore';

const entry: ArchiveEntry = {
  id: 'e1', slug: 'carol', title: 'Carol', media_type: 'film', release_year: 2015,
  creator: 'Todd Haynes', length_label: null, summary: null, cover_url: null, cover_gradient: null,
  vote_count: 100, up_count: 89, star_sum: 420, review_count: 2, has_score: true, published_at: null,
} as ArchiveEntry;

const review = (id: string, author: string, over: Record<string, unknown> = {}) => ({
  id, body: `body ${id}`, is_recommend: true, helpful_count: 0, created_at: '2026-08-02T00:00:00Z',
  author: { id: author, display_name: author === 'me' ? 'Me' : 'Ari', username: author, avatar_url: null },
  ...over,
});

const mockAgree = jest.fn();
const mockUnagree = jest.fn();
const mockBlock = jest.fn();

beforeEach(() => {
  mockStatus = 'approved';
  mockPush.mockReset();
  mockSubmitReview.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null });
  mockFetchEntry.mockReset().mockResolvedValue(entry);
  mockFetchDetail.mockReset().mockResolvedValue({
    notes: [
      { id: 'n0', label: 'Seeded, nobody agreed yet', agreeCount: 0, agreed: false },
      { id: 'n3', label: 'Confirmed note', agreeCount: 3, agreed: false },
    ],
    reviews: [review('r1', 'ari', { helpful_count: 2 }), review('rb', 'blocked'), review('rm', 'me')],
    lastEdit: null,
  });
  mockMyHelpful.mockReset().mockResolvedValue(new Set<string>());
  mockSetHelpful.mockReset().mockResolvedValue(undefined);
  mockDeleteReview.mockReset().mockResolvedValue(undefined);
  mockReport.mockReset().mockResolvedValue(undefined);
  mockAgree.mockReset().mockResolvedValue(undefined);
  mockUnagree.mockReset().mockResolvedValue(undefined);
  mockBlock.mockReset().mockResolvedValue(undefined);
  mockShelfIds.mockReset().mockResolvedValue([{ id: 'x1' }]);
  mockSetShelf.mockReset().mockResolvedValue(undefined);
  useArchiveStore.setState({
    myVotes: {}, watchlist: [], noteAgreements: [],
    agreeNote: mockAgree, unagreeNote: mockUnagree,
    hydrateMine: jest.fn().mockResolvedValue(undefined),
    vote: jest.fn().mockResolvedValue(undefined),
  } as never);
  useSafetyStore.setState({ blockedUserIds: ['blocked'], mutedUserIds: [], blockUser: mockBlock } as never);
});

const ready = async (r: ReturnType<typeof render>) => {
  await waitFor(() => expect(r.getByTestId('archive-vote-star-5')).toBeTruthy());
};

describe('content notes (ARC-01, ARC-02)', () => {
  it('a note nobody has agreed with yet is shown and can be agreed into view', async () => {
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    expect(r.getByText('Seeded, nobody agreed yet')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('archive-note-n0')); });
    expect(mockAgree).toHaveBeenCalledWith('n0');
  });

  it('tapping an agreed note takes the agreement back', async () => {
    useArchiveStore.setState({ noteAgreements: ['n3'] } as never);
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    await act(async () => { fireEvent.press(r.getByTestId('archive-note-n3')); });
    expect(mockUnagree).toHaveBeenCalledWith('n3');
    expect(mockAgree).not.toHaveBeenCalled();
  });

  it('a pending member gets the locked explanation, not a refused write', async () => {
    mockStatus = 'pending';
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    fireEvent.press(r.getByTestId('archive-note-n0'));
    expect(r.getByTestId('archive-locked-sheet')).toBeTruthy();
    expect(mockAgree).not.toHaveBeenCalled();
  });
});

describe('reviews: block, report, helpful, own (ARC-03, ARC-06, ARC-12)', () => {
  it("a blocked author's review is not shown", async () => {
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    expect(r.queryByText('body rb')).toBeNull();
    expect(r.getByText('body r1')).toBeTruthy();
  });

  it('⋯ on a review → Spoiler files an archive_review report', async () => {
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    fireEvent.press(r.getByTestId('archive-review-r1-more'));
    await act(async () => { fireEvent.press(r.getByTestId('archive-review-action-spoiler')); });
    expect(mockReport).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'archive_review', contentId: 'r1', userId: 'ari', reason: 'archive_spoiler',
    }));
    expect(r.getByTestId('archive-review-action-done')).toBeTruthy();
  });

  it('⋯ on a review → Block author, confirmed', async () => {
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    fireEvent.press(r.getByTestId('archive-review-r1-more'));
    fireEvent.press(r.getByTestId('archive-review-action-block'));
    await act(async () => { fireEvent.press(r.getByTestId('archive-review-action-block-confirm')); });
    expect(mockBlock).toHaveBeenCalledWith('ari');
  });

  it('the hero ⋯ reports a wrong entry', async () => {
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    fireEvent.press(r.getByTestId('archive-entry-more'));
    await act(async () => { fireEvent.press(r.getByTestId('archive-entry-report-wrong')); });
    expect(mockReport).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'archive_entry', contentId: 'e1', reason: 'archive_bad_entry',
    }));
  });

  it('Helpful marks the review, counts it, and rolls back on failure', async () => {
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    await act(async () => { fireEvent.press(r.getByTestId('archive-review-r1-helpful')); });
    expect(mockSetHelpful).toHaveBeenCalledWith('r1', true);
    expect(r.getByText(/3 found this helpful/)).toBeTruthy();
    mockSetHelpful.mockRejectedValueOnce(new Error('x'));
    await act(async () => { fireEvent.press(r.getByTestId('archive-review-r1-helpful')); });
    expect(r.getByText(/3 found this helpful/)).toBeTruthy();
  });

  it('her own review has no Helpful, offers Edit and Delete', async () => {
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    expect(r.queryByTestId('archive-review-rm-helpful')).toBeNull();
    fireEvent.press(r.getByTestId('archive-review-rm-more'));
    fireEvent.press(r.getByTestId('archive-review-action-edit'));
    expect(mockPush).toHaveBeenCalledWith('/archive/carol/review');
    fireEvent.press(r.getByTestId('archive-review-rm-more'));
    fireEvent.press(r.getByTestId('archive-review-action-delete'));
    await act(async () => { fireEvent.press(r.getByTestId('archive-review-action-delete-confirm')); });
    expect(mockDeleteReview).toHaveBeenCalledWith('rm');
    expect(r.queryByText('body rm')).toBeNull();
  });

  it('the author name opens her profile', async () => {
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    fireEvent.press(r.getByTestId('archive-review-r1-author'));
    expect(mockPush).toHaveBeenCalledWith('/user/ari');
  });
});

describe('Archive top four (delight)', () => {
  it('adds this entry to her shelf after the ones already there', async () => {
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    await waitFor(() => expect(r.getByTestId('archive-shelf-toggle')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('archive-shelf-toggle')); });
    expect(mockSetShelf).toHaveBeenCalledWith(['x1', 'e1']);
  });

  it('a full shelf says so instead of dropping one', async () => {
    mockShelfIds.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    await waitFor(() => expect(r.getByTestId('archive-shelf-toggle')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('archive-shelf-toggle')); });
    expect(mockSetShelf).not.toHaveBeenCalled();
    expect(r.getByTestId('archive-action-error')).toBeTruthy();
  });
});

describe('inline review (ARC-05)', () => {
  it('unrated: no review box, "Rate it first"', async () => {
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    expect(r.queryByTestId('archive-vote-comment')).toBeNull();
    expect(r.getByTestId('archive-vote-rate-first')).toBeTruthy();
  });

  it('rated: Post needs the no-spoilers box ticked, and sends her verdict from her stars', async () => {
    useArchiveStore.setState({ myVotes: { e1: 2 } } as never);
    const r = render(<ArchiveEntryScreen />);
    await ready(r);
    fireEvent.changeText(r.getByTestId('archive-vote-comment'), 'Slow.');
    await act(async () => { fireEvent.press(r.getByTestId('archive-vote-review-submit')); });
    expect(mockSubmitReview).not.toHaveBeenCalled();
    fireEvent.press(r.getByTestId('archive-vote-ack'));
    await act(async () => { fireEvent.press(r.getByTestId('archive-vote-review-submit')); });
    expect(mockSubmitReview).toHaveBeenCalledWith('e1', 'Slow.', false, true);
  });
});
