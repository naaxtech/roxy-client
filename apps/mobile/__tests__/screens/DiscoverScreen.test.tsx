/**
 * Discover took over three things the 3.0 redesign deleted a tab for: the
 * Question of the Day card (`grow/index.tsx`, deleted), the full communities
 * browser (`connect/index.tsx`, deleted), and the never-wired EventModeBadge.
 * This file proves each one actually reaches the screen rather than trusting
 * that wiring code compiled.
 *
 * Every store and data hook below is mocked directly rather than through
 * Supabase — `useDiscoverData.ts` and the Zustand stores already have their
 * own tests; this file only has to prove the screen asks them the right
 * questions and puts the answer where a member can reach it.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { IDENTITY } from '../../lib/theme';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

// Inline mock factories only — see CLAUDE.md §12.2 (jest.mock hoisting). Push
// and back are captured on the module object so assertions can reach the same
// jest.fn() the screen actually called, across every render.
jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  return { __push: push, __back: back, useRouter: () => ({ push, back }) };
});

// A navigator's focus, without a navigator: each `useFocusEffect` runs on
// mount, and `__refocus()` replays blur-then-focus the way returning to the
// tab does (the bell re-reads its count there).
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  const live = new Map<() => unknown, unknown>();
  return {
    ...jest.requireActual('@react-navigation/native'),
    __refocus: () => live.forEach((cleanup, cb) => {
      if (typeof cleanup === 'function') cleanup();
      live.set(cb, cb());
    }),
    useFocusEffect: (cb: () => unknown) => {
      useEffect(() => {
        live.set(cb, cb());
        return () => {
          const cleanup = live.get(cb);
          live.delete(cb);
          if (typeof cleanup === 'function') cleanup();
        };
      }, [cb]);
    },
  };
});

jest.mock('../../hooks/useThemeColors', () => ({
  useThemeColors: () => jest.requireActual('../../lib/theme').THEMES.light,
}));

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({
    tier: 'beta',
    isBeta: true,
    can: () => true,
    canCommunity: () => true,
  }),
}));
jest.mock('../../lib/notifications', () => ({
  fetchUnreadNotificationCount: jest.fn(() => Promise.resolve(0)),
}));

jest.mock('../../store/authStore', () => {
  const state: { user: { id: string } | null } = { user: { id: 'discover-test-user' } };
  return {
    __authState: state,
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

jest.mock('../../store/communityStore', () => {
  const state = {
    allCommunities: [] as unknown[],
    joinedIds: new Set<string>(['joined-c1', 'joined-c2']),
    hydrate: jest.fn(() => Promise.resolve()),
    joinCommunity: jest.fn(() => Promise.resolve('joined')),
    requestedIds: new Set<string>(),
  };
  return {
    __communityState: state,
    useCommunityStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

jest.mock('../../store/buildStore', () => {
  const state = {
    businesses: [] as unknown[],
    bookmarkedBusinessIds: new Set<string>(),
    loadBusinesses: jest.fn(() => Promise.resolve()),
    loadBookmarks: jest.fn(() => Promise.resolve()),
  };
  return {
    __buildState: state,
    useBuildStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

// One rail per hook, real shape from useDiscoverData.ts — a hybrid event is
// the whole point of this fixture: `event_type: 'hybrid'` is a real value the
// schema stores, not an edge case invented for the test.
jest.mock('../../components/discover/useDiscoverData', () => ({
  useLiveRooms: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useEvents: () => ({
    rows: [
      {
        id: 'e-online', title: 'Online Mixer', starts_at: '2026-09-01T18:00:00.000Z',
        event_type: 'online', location_text: null, is_paid: false, price_cents: null,
        community_name: 'Test Community',
      },
      {
        id: 'e-hybrid', title: 'Hybrid Meetup', starts_at: '2026-09-02T18:00:00.000Z',
        event_type: 'hybrid', location_text: 'Central Hall', is_paid: false, price_cents: null,
        community_name: null,
      },
    ],
    status: 'ready',
    reload: jest.fn(),
  }),
  useGames: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useImpact: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useSupport: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
}));

// QuestionOfTheDayCard has its own test file covering its internals
// (loading skeleton, null-when-no-question, answered state). Stubbed here to
// a value that proves only what this screen owns: whether it renders at all,
// and whether the props it is handed are the right ones.
jest.mock('../../components/grow/QuestionOfTheDayCard', () => {
  const { Text } = require('react-native');
  const { createElement } = require('react');
  return {
    QuestionOfTheDayCard: (props: { communityIds: string[]; userId: string }) =>
      createElement(
        Text,
        { testID: 'qotd-card-stub' },
        `qotd:${props.userId}:${props.communityIds.join(',')}`,
      ),
  };
});

import DiscoverScreen from '../../app/(tabs)/discover/index';

const { __authState: authState } = jest.requireMock('../../store/authStore');
const { __push: push } = jest.requireMock('expo-router');

beforeEach(() => {
  jest.clearAllMocks();
  authState.user = { id: 'discover-test-user' };
});

describe('Discover — Question of the Day rail', () => {
  it('renders first on the all chip, wired to her joined communities and id', async () => {
    const { getByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('rail-qotd')).toBeTruthy());
    expect(getByTestId('qotd-card-stub').props.children)
      .toBe('qotd:discover-test-user:joined-c1,joined-c2');
  });

  it('disappears under the Events chip — qotd is an all-view-only rail', async () => {
    const { getByTestId, queryByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('rail-qotd')).toBeTruthy());

    fireEvent.press(getByTestId('discover-chips-events'));

    await waitFor(() => expect(queryByTestId('rail-qotd')).toBeNull());
  });

  /**
   * `QuestionOfTheDayCard` does `.eq('user_id', userId)` — an undefined id
   * there is a query that quietly matches nothing rather than an error, so
   * the screen must not render the card at all until it has a real id.
   */
  it('does not render before there is a signed-in user id', async () => {
    authState.user = null;
    const { queryByTestId, getByTestId } = render(<DiscoverScreen />);
    // Something else that doesn't depend on a user id proves the screen did
    // mount rather than the assertion passing on an empty tree.
    await waitFor(() => expect(getByTestId('discover-search')).toBeTruthy());
    expect(queryByTestId('rail-qotd')).toBeNull();
    expect(queryByTestId('qotd-card-stub')).toBeNull();
  });
});

describe('Discover — Communities rail "See all"', () => {
  it('exposes rail-communities-link and navigates to /communities', async () => {
    const { getByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('rail-communities-link')).toBeTruthy());

    fireEvent.press(getByTestId('rail-communities-link'));

    expect(push).toHaveBeenCalledWith('/communities');
  });
});

describe('Discover — the events posters carry the true event mode', () => {
  it('gives a hybrid event its own words instead of forcing it onto one side', async () => {
    const { getByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('event-e-hybrid')).toBeTruthy());

    const card = within(getByTestId('event-e-hybrid'));
    // v2: sentence case, no caps pill (direction › Bans). The words still
    // say both, and never "In person" alone.
    expect(card.getByText(/In person and online/)).toBeTruthy();
    expect(card.queryByText(/^In person ·/)).toBeNull();
  });

  it('still carries the word for a plain online event', async () => {
    const { getByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('event-e-online')).toBeTruthy());
    expect(within(getByTestId('event-e-online')).getAllByText(/Online/).length).toBeGreaterThan(0);
  });

  it('does not let the first poster force a hybrid event onto one side either', async () => {
    // v0 had a full-width hero card with the same collapse bug; v2 retires the
    // hero (the posters are the lead block), and the guarantee moves with it:
    // under "In person" the hybrid event is the only poster, and it says both.
    const { getByTestId, queryByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('event-chips-in_person')).toBeTruthy());

    fireEvent.press(getByTestId('event-chips-in_person'));

    await waitFor(() => expect(queryByTestId('event-e-online')).toBeNull());
    const poster = within(getByTestId('event-e-hybrid'));
    expect(poster.getByText(/Hybrid Meetup/)).toBeTruthy();
    expect(poster.getByText(/In person and online/)).toBeTruthy();
    expect(queryByTestId('discover-hero')).toBeNull();
  });

  it('paints each event as a poster in an identity colour, not a gradient', async () => {
    const { getByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('event-e-online')).toBeTruthy());
    const poster = getByTestId('event-e-online');
    const fill = (StyleSheet.flatten(poster.props.style) as { backgroundColor?: string }).backgroundColor;
    expect(IDENTITY as readonly string[]).toContain(fill);
    expect(within(poster).UNSAFE_queryAllByType('LinearGradient' as never)).toHaveLength(0);
  });
});

describe('Discover — the bell', () => {
  it('re-reads the unread count each time Discover regains focus', async () => {
    const { fetchUnreadNotificationCount } = jest.requireMock('../../lib/notifications');
    const { __refocus: refocus } = jest.requireMock('@react-navigation/native');
    (fetchUnreadNotificationCount as jest.Mock).mockResolvedValueOnce(3);
    const v = render(<DiscoverScreen />);
    await waitFor(() => expect(v.getByLabelText('Notifications, 3 unread')).toBeTruthy());
    expect(v.getByTestId('discover-notifications-dot')).toBeTruthy();

    // She cleared them on the notifications screen and came back.
    (fetchUnreadNotificationCount as jest.Mock).mockResolvedValueOnce(0);
    await act(async () => { refocus(); });
    await waitFor(() => expect(v.queryByTestId('discover-notifications-dot')).toBeNull());
    expect(v.getByLabelText('Notifications')).toBeTruthy();
    expect(fetchUnreadNotificationCount).toHaveBeenCalledTimes(2);
    expect(fetchUnreadNotificationCount).toHaveBeenLastCalledWith('discover-test-user');
  });
});

describe('Discover — v2 header', () => {
  it('leads with a search pill and a For you chip', async () => {
    const { getByTestId, getByText } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('discover-search')).toBeTruthy());
    expect(getByText('Search people, communities, events')).toBeTruthy();
    expect(getByTestId('discover-chips-all')).toBeTruthy();
    expect(getByText('For you')).toBeTruthy();
    expect(getByTestId('discover-chips-fade')).toBeTruthy();
  });
});

describe('Discover — Communities for you', () => {
  it('lists communities as rows with a crest and a tonal Join that joins', async () => {
    const { __communityState: state } = jest.requireMock('../../store/communityStore');
    state.allCommunities = [
      { id: 'c-late', name: 'Late Bloomers', member_count: 2310, is_private: false },
    ];
    const { getByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('community-c-late')).toBeTruthy());
    const row = within(getByTestId('community-c-late'));
    expect(row.getByText('LB')).toBeTruthy();
    expect(row.getByText('2,310 members')).toBeTruthy();
    fireEvent.press(getByTestId('community-join-c-late'));
    expect(state.joinCommunity).toHaveBeenCalledWith('c-late', 'discover-test-user');
    state.allCommunities = [];
  });
});
