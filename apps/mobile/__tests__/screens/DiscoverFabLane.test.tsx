/**
 * Roxy AI's lane on Discover (design direction v2 › The Roxy AI button): the
 * ROOT list reports its scroll to the button (she tucks while it scrolls down)
 * and ends `FAB_LANE` higher, so the last item can always scroll clear of
 * her. Only those props belong to the roxy-ai lane; the screen is the screens
 * lane's. Mocks mirror DiscoverScreen.test.tsx.
 */
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({ tier: 'beta', isBeta: true, can: () => true, canCommunity: () => true }),
}));
jest.mock('../../lib/notifications', () => ({
  fetchUnreadNotificationCount: jest.fn(() => Promise.resolve(0)),
}));
jest.mock('../../store/authStore', () => {
  const state = { user: { id: 'lane-test-user' } };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
jest.mock('../../store/communityStore', () => {
  const state = { allCommunities: [] as unknown[], joinedIds: new Set<string>(), hydrate: jest.fn(() => Promise.resolve()) };
  return { useCommunityStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
jest.mock('../../store/buildStore', () => {
  const state = {
    businesses: [] as unknown[],
    bookmarkedBusinessIds: new Set<string>(),
    loadBusinesses: jest.fn(() => Promise.resolve()),
    loadBookmarks: jest.fn(() => Promise.resolve()),
  };
  return { useBuildStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
jest.mock('../../components/discover/useDiscoverData', () => ({
  useLiveRooms: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useEvents: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useGames: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useImpact: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useSupport: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
}));
jest.mock('../../components/grow/QuestionOfTheDayCard', () => ({ QuestionOfTheDayCard: () => null }));

import DiscoverScreen from '../../app/(tabs)/discover/index';
import { onListScroll, onListContentSizeChange, LIST_SCROLL_THROTTLE } from '../../lib/roxyFab';
import { FAB_LANE } from '../../components/nav/navTokens';

describe('Discover — Roxy AI lane hookups', () => {
  it('the root list tucks Roxy on scroll and ends FAB_LANE higher', async () => {
    const v = render(<DiscoverScreen />);
    await waitFor(() => expect(v.UNSAFE_getAllByType(ScrollView).length).toBeGreaterThan(0));
    const roots = v.UNSAFE_getAllByType(ScrollView).filter((n) => n.props.onScroll === onListScroll);
    expect(roots).toHaveLength(1);
    expect(roots[0].props.scrollEventThrottle).toBe(LIST_SCROLL_THROTTLE);
    // Rails that land after she came out at the end grow the list under her
    // with no scroll event: the size change re-judges her lane (Wave 3 lane rule).
    expect(roots[0].props.onContentSizeChange).toBe(onListContentSizeChange);
    const content = StyleSheet.flatten(roots[0].props.contentContainerStyle) as { paddingBottom?: number };
    expect(content.paddingBottom).toBeGreaterThanOrEqual(FAB_LANE);
  });
});
