import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

/**
 * Jank audit #4 at the screen: every Discover section loads as the card it
 * will draw, at the width it will draw it (budgets F8/F9) — not 140 x 180
 * boxes that each rail then replaces with a different size.
 */
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
// No navigator here: a focus effect runs once, on mount (the bell reads its
// unread count on focus).
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb: () => unknown) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb() as void | (() => void), [cb]);
  },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../../hooks/useThemeColors', () => ({
  useThemeColors: () => jest.requireActual('../../lib/theme').THEMES.light,
}));
jest.mock('../../hooks/useAppWidth', () => ({ useAppWidth: () => 390 }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({ tier: 'beta', isBeta: true, can: () => true, canCommunity: () => true }),
}));
jest.mock('../../lib/notifications', () => ({
  fetchUnreadNotificationCount: jest.fn(() => Promise.resolve(0)),
}));
jest.mock('../../store/authStore', () => {
  const state = { user: { id: 'u' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
jest.mock('../../store/communityStore', () => {
  const state = {
    allCommunities: [], joinedIds: new Set<string>(), requestedIds: new Set<string>(),
    hydrate: jest.fn(() => new Promise(() => undefined)), joinCommunity: jest.fn(),
  };
  return { useCommunityStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
jest.mock('../../store/buildStore', () => {
  const state = {
    businesses: [], bookmarkedBusinessIds: new Set<string>(),
    loadBusinesses: jest.fn(() => new Promise(() => undefined)),
    loadBookmarks: jest.fn(() => new Promise(() => undefined)),
  };
  return { useBuildStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
jest.mock('../../components/discover/useDiscoverData', () => {
  const loading = () => ({ rows: [], status: 'loading', reload: jest.fn() });
  return { useLiveRooms: loading, useEvents: loading, useGames: loading, useImpact: loading, useSupport: loading };
});
jest.mock('../../components/grow/QuestionOfTheDayCard', () => ({ QuestionOfTheDayCard: () => null }));
jest.mock('../../lib/topMembers', () => ({
  ...jest.requireActual('../../lib/topMembers'),
  fetchTopMembers: jest.fn(() => new Promise(() => undefined)),
}));
jest.mock('../../lib/archive', () => ({
  ...jest.requireActual('../../lib/archive'),
  fetchArchiveEntries: jest.fn(() => new Promise(() => undefined)),
}));
jest.mock('../../components/archive/archiveCount', () => ({
  fetchArchiveTotal: jest.fn(() => new Promise(() => undefined)),
}));

import DiscoverScreen from '../../app/(tabs)/discover/index';

/** Skeleton blocks are hidden from assistive tech (the group is the progressbar). */
const HIDDEN = { includeHiddenElements: true } as const;
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | undefined>;

describe('Discover — loading at the final geometry', () => {
  it('draws event posters, member cards and shop tiles at the rail\'s card width', () => {
    const v = render(<DiscoverScreen />);
    // 390 wide: (390 - MARGIN 16 - 2 x SPACE[2] 12) / 2.4 cards in view.
    const cardWidth = Math.round((390 - 16 - 2 * 12) / 2.4);

    const poster = flat(v.getByTestId('rail-events-skeleton-0', HIDDEN));
    expect(poster.width).toBe(cardWidth);
    expect(poster.height).toBe(Math.round(cardWidth * 4 / 3));
    expect(flat(v.getByTestId('rail-top10-skeleton-0-media', HIDDEN)).height).toBe(Math.round(cardWidth * 5 / 4));
    expect(flat(v.getByTestId('rail-economy-skeleton-0-media', HIDDEN)).height).toBe(Math.round(cardWidth * 3 / 4));
  });

  it('draws rows, as many as the communities section shows', () => {
    const v = render(<DiscoverScreen />);
    expect(v.getAllByTestId(/^rail-communities-skeleton-\d+$/, HIDDEN)).toHaveLength(3);
    expect(flat(v.getByTestId('rail-live-skeleton-0', HIDDEN)).minHeight).toBe(72);
    expect(flat(v.getByTestId('rail-games-skeleton-0', HIDDEN)).minHeight).toBe(72);
  });
});
