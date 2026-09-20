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
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';

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

jest.mock('../../hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    background: '#14082A', backgroundAlt: '#1A0A2E', surface: '#211039',
    surfaceLight: '#2D1B4E', line: '#3D2B5E', lineStrong: '#55407F',
    textPrimary: '#F7F3FC', textSecondary: '#C6B5E4', textMuted: '#9C89C2',
    primary: '#F22481', primaryInk: '#FF7AB5', secondary: '#A78BFA', secondaryInk: '#C9B9F5',
    gold: '#F5B73D', goldInk: '#FFD37E', warning: '#F5B73D',
    success: '#2FC97E', successInk: '#7CE0AC', error: '#EF4444', errorInk: '#F15B5B',
    sister: '#8E9BFF', sisterInk: '#BCC5FF', roxy: '#E879A6', devPanel: '#FF1493',
  }),
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

describe('Discover — the events rail carries the true event mode', () => {
  it('gives a hybrid event its own word instead of forcing it onto one side', async () => {
    const { getByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('event-e-hybrid')).toBeTruthy());

    const card = within(getByTestId('event-e-hybrid'));
    expect(card.getByText(/BOTH/)).toBeTruthy();
    // The colour pill only ever tells the truth — BadgeKind has no hybrid
    // value, so a hybrid card must never wear the "IN PERSON" pill.
    expect(card.queryByText('IN PERSON')).toBeNull();
  });

  it('still carries the word for a plain online event', async () => {
    const { getByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('event-e-online')).toBeTruthy());

    // Two, deliberately: the colour pill (truthful for this mode) and the
    // subtitle line (`eventModeLabel`, always present for every mode). Unlike
    // the hybrid card, there is no lie to avoid here — just the word said
    // twice by two independent parts of the card.
    expect(within(getByTestId('event-e-online')).getAllByText(/ONLINE/).length).toBeGreaterThan(0);
  });

  it('does not let the hero card force a hybrid event onto one side either', async () => {
    // The hero had the same `=== 'online' ? 'online' : 'inPerson'` collapse the
    // rail was just fixed for, and it is the LOUDEST card on the screen — a
    // full-width promise that a both-ways event is in-person only.
    //
    // Reaching it through the "In person" chip is the point: a hybrid event
    // survives BOTH event filters, so this selects a board whose only event is
    // the hybrid one, which makes it the hero.
    const { getByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('event-chips-in_person')).toBeTruthy());

    fireEvent.press(getByTestId('event-chips-in_person'));

    const hero = within(getByTestId('discover-hero'));
    expect(hero.getByText(/Hybrid Meetup/)).toBeTruthy();
    expect(hero.getByText(/BOTH/)).toBeTruthy();
    expect(hero.queryByText('IN PERSON')).toBeNull();
  });

  it('keeps the truthful pill on a hero that really is one mode', async () => {
    const { getByTestId } = render(<DiscoverScreen />);
    await waitFor(() => expect(getByTestId('discover-hero')).toBeTruthy());

    const hero = within(getByTestId('discover-hero'));
    expect(hero.getByText(/Online Mixer/)).toBeTruthy();
    expect(hero.getAllByText(/ONLINE/).length).toBeGreaterThan(0);
  });
});
