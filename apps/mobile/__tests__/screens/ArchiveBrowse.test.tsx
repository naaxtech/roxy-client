import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import ArchiveBrowseScreen from '../../app/archive/index';
import { RoxyRefresh } from '../../components/feedback/RoxyRefresh';
import { useArchiveStore } from '../../store/archiveStore';
import { useProfileStore } from '../../store/profileStore';
import { THEMES } from '../../lib/theme';
import type { ArchiveEntry } from '../../lib/archive';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

/**
 * The Archive's front door, and the one screen a pending member can use.
 *
 * Migration 079 is the postmortem this exists for: a new signup landed on
 * vetting_status='pending', every RLS helper answered false, and she was locked
 * out of the whole app with no screen explaining it. So the banner is not
 * decoration — it is the explanation she never got.
 */

const mockPush = jest.fn();
let mockStatus: 'unvetted' | 'pending' | 'approved' = 'approved';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

jest.mock('../../hooks/useMembership', () => ({
  useMembership: () => ({
    status: mockStatus,
    canBrowseArchive: true,
    canReview: mockStatus !== 'pending',
    canEdit: mockStatus !== 'pending',
  }),
}));

jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => {
    const state = { user: { id: 'u1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

jest.mock('../../lib/analytics', () => ({
  Analytics: { archiveViewed: jest.fn(), archiveSearch: jest.fn(), archiveEntryViewed: jest.fn() },
}));

const entry = (over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  id: 'e1', slug: 'carol', title: 'Carol', media_type: 'film', release_year: 2015,
  creator: 'Todd Haynes', length_label: '1h 58m', summary: 'A shopgirl and a woman in a fur coat.',
  cover_url: null, cover_gradient: null, vote_count: 100, up_count: 89,
  review_count: 12, has_score: true, published_at: '2026-08-01T00:00:00Z', ...over,
});

const mockLoad = jest.fn();
const mockSetFilters = jest.fn();
const mockHydrateMine = jest.fn();

function seed(over: Record<string, unknown> = {}) {
  useArchiveStore.setState({
    entries: [entry()],
    loading: false,
    error: null,
    filters: { query: '', mediaType: null, sort: 'top' },
    myVotes: {},
    watchlist: [],
    noteAgreements: [],
    load: mockLoad,
    setFilters: mockSetFilters,
    hydrateMine: mockHydrateMine,
    ...over,
  } as never);
}

beforeEach(() => {
  mockPush.mockClear();
  mockLoad.mockReset().mockResolvedValue(undefined);
  mockSetFilters.mockReset();
  mockHydrateMine.mockReset().mockResolvedValue(undefined);
  mockStatus = 'approved';
  useProfileStore.setState({ profile: { vetting_status: 'approved' } as never });
  seed();
});

describe('ARC-07 / ARC-09: refresh, paging, debounce, confirmation', () => {
  it('the list has pull-to-refresh and pages on reaching the end', () => {
    const mockRefresh = jest.fn().mockResolvedValue(undefined);
    const mockLoadMore = jest.fn().mockResolvedValue(undefined);
    seed({ refresh: mockRefresh, loadMore: mockLoadMore, hasMore: true, refreshing: false });
    const { getByTestId } = render(<ArchiveBrowseScreen />);
    const list = getByTestId('archive-list');
    expect(list.props.refreshControl).toBeTruthy();
    list.props.refreshControl.props.onRefresh();
    expect(mockRefresh).toHaveBeenCalled();
    list.props.onEndReached();
    expect(mockLoadMore).toHaveBeenCalled();
  });

  it('pulls to refresh through the shared RoxyRefresh (the faceless pink O), not a bare RefreshControl', () => {
    const mockRefresh = jest.fn().mockResolvedValue(undefined);
    seed({ refresh: mockRefresh, loadMore: jest.fn(), hasMore: false, refreshing: true });
    const v = render(<ArchiveBrowseScreen />);
    const pull = v.UNSAFE_getByType(RoxyRefresh);
    expect(pull.props.refreshing).toBe(true);
    pull.props.onRefresh();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('typing does not fire a load per keystroke', async () => {
    jest.useFakeTimers();
    try {
      const r = render(<ArchiveBrowseScreen />);
      mockLoad.mockClear();
      // The store mock does not apply setFilters, so drive the effect by
      // re-seeding the query the way the real store would.
      act(() => { useArchiveStore.setState({ filters: { query: 'c', mediaType: null, sort: 'top' } } as never); });
      act(() => { useArchiveStore.setState({ filters: { query: 'ca', mediaType: null, sort: 'top' } } as never); });
      act(() => { useArchiveStore.setState({ filters: { query: 'car', mediaType: null, sort: 'top' } } as never); });
      expect(mockLoad).not.toHaveBeenCalled();
      act(() => { jest.advanceTimersByTime(300); });
      expect(mockLoad).toHaveBeenCalledTimes(1);
      r.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the "sent to the mods" confirmation a composer left behind, once', () => {
    seed({ flash: 'Sent to the mods ✿ credited to you' });
    const { getByTestId } = render(<ArchiveBrowseScreen />);
    expect(getByTestId('archive-submitted-toast')).toBeTruthy();
    expect(useArchiveStore.getState().flash).toBeNull();
  });
});

describe('the Archive browse screen', () => {
  it('loads the catalogue on mount', async () => {
    render(<ArchiveBrowseScreen />);
    await waitFor(() => expect(mockLoad).toHaveBeenCalled());
  });

  it('lists what came back', () => {
    const { getByText } = render(<ArchiveBrowseScreen />);
    expect(getByText('Carol')).toBeTruthy();
  });

  it('opens an entry by slug', () => {
    const { getByText } = render(<ArchiveBrowseScreen />);
    fireEvent.press(getByText('Carol'));
    expect(mockPush).toHaveBeenCalledWith('/archive/carol');
  });

  it('shows the pending banner to a pending member and not to an approved one', () => {
    const approved = render(<ArchiveBrowseScreen />);
    expect(approved.queryByTestId('archive-pending-banner')).toBeNull();
    expect(approved.queryByTestId('account-status-tag')).toBeNull();
    approved.unmount();

    mockStatus = 'pending';
    useProfileStore.setState({ profile: { vetting_status: 'pending' } as never });
    const pending = render(<ArchiveBrowseScreen />);
    expect(pending.getByTestId('archive-pending-banner')).toBeTruthy();
    expect(pending.getByTestId('account-status-tag')).toBeTruthy();
  });

  it('paints a regular centered search bar you can actually read', () => {
    const { getByTestId } = render(<ArchiveBrowseScreen />);
    const wrap = getByTestId('archive-search-wrap');
    const input = getByTestId('archive-search');
    const wrapStyle = flat(wrap);
    const inputStyle = flat(input);
    expect(wrapStyle.alignSelf).toBe('center');
    // Light is the default theme since v2 (Nicole, 2026-10-21); this screen
    // renders under the default, so its tokens are the light ones.
    expect(wrapStyle.backgroundColor).toBe(THEMES.light.surfaceLight);
    expect(wrapStyle.backgroundColor).not.toBe(THEMES.light.background);
    expect(inputStyle.color).toBe(THEMES.light.textPrimary);
    expect(inputStyle.backgroundColor).toBe(THEMES.light.surfaceLight);
    expect(input.props.placeholderTextColor).toBe(THEMES.light.textSecondary);
  });

  it('pushes the typed query into the store filters', () => {
    const { getByTestId } = render(<ArchiveBrowseScreen />);
    fireEvent.changeText(getByTestId('archive-search'), 'carol');
    expect(mockSetFilters).toHaveBeenCalledWith({ query: 'carol' });
  });

  it('narrows by media type and by sort', () => {
    const { getByTestId } = render(<ArchiveBrowseScreen />);
    fireEvent.press(getByTestId('archive-type-chips-book'));
    expect(mockSetFilters).toHaveBeenCalledWith({ mediaType: 'book' });

    fireEvent.press(getByTestId('archive-sort-chips-newest'));
    expect(mockSetFilters).toHaveBeenCalledWith({ sort: 'newest' });
  });

  it('renders a loading state rather than an empty list while it is still fetching', () => {
    seed({ entries: [], loading: true });
    const { getByTestId, queryByTestId } = render(<ArchiveBrowseScreen />);
    expect(getByTestId('archive-loading')).toBeTruthy();
    expect(queryByTestId('archive-empty')).toBeNull();
  });

  it('loads as skeleton rows at their final layout, not a spinner (v2 › Bans)', () => {
    seed({ entries: [], loading: true });
    const { getAllByTestId, UNSAFE_queryAllByType } = render(<ArchiveBrowseScreen />);
    expect(getAllByTestId('archive-skeleton-row').length).toBeGreaterThanOrEqual(3);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('separates rows by space, not by cards', () => {
    const { getByTestId } = render(<ArchiveBrowseScreen />);
    expect(flat({ props: { style: getByTestId('archive-list').props.contentContainerStyle } }).gap).toBe(24);
  });

  it('says a locked action in words, never with a lock emoji', () => {
    mockStatus = 'pending';
    seed({ entries: [], filters: { query: 'x', mediaType: null, sort: 'top' } });
    const { getByTestId, queryByText } = render(<ArchiveBrowseScreen />);
    expect(getByTestId('archive-empty-suggest')).toHaveTextContent('Suggest an entry once you’re approved');
    expect(queryByText(/🔒/)).toBeNull();
  });

  it('offers a retry on error instead of looking like an empty Archive', () => {
    seed({ entries: [], loading: false, error: 'nope' });
    const { getByTestId, queryByTestId } = render(<ArchiveBrowseScreen />);
    expect(getByTestId('archive-error')).toBeTruthy();
    expect(queryByTestId('archive-empty')).toBeNull();
    fireEvent.press(getByTestId('archive-retry'));
    expect(mockLoad).toHaveBeenCalled();
  });

  it('offers to add the missing thing when a search finds nothing', () => {
    // Content-forward, not an apology: the empty state is the best moment to
    // ask for a contribution, because she has just told us what is missing.
    seed({ entries: [], filters: { query: 'gentleman', mediaType: null, sort: 'top' } });
    const { getByTestId } = render(<ArchiveBrowseScreen />);
    expect(getByTestId('archive-empty')).toHaveTextContent(/suggest it/i);
  });

  it('tells a pending member the suggest action is locked, rather than hiding it', () => {
    // An explicit product rule: locked actions explain the unlock, never a
    // greyed-out dead control.
    mockStatus = 'pending';
    seed({ entries: [], filters: { query: 'x', mediaType: null, sort: 'top' } });
    const { getByTestId } = render(<ArchiveBrowseScreen />);
    fireEvent.press(getByTestId('archive-empty-suggest'));
    expect(getByTestId('archive-locked-sheet')).toBeTruthy();
  });
});
