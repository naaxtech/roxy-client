/**
 * Discover mounts the Near you rail wherever communities are on screen: under
 * For you and under the Communities chip, and nowhere else. The rail's own
 * states are in `__tests__/components/nearby/NearbyRail.test.tsx`; this file
 * only proves the screen puts it where a member can reach it.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useFocusEffect: (cb: () => unknown) => { useEffect(() => { const c = cb(); return typeof c === 'function' ? (c as () => void) : undefined; }, [cb]); },
  };
});
jest.mock('../../hooks/useThemeColors', () => ({
  useThemeColors: () => jest.requireActual('../../lib/theme').THEMES.light,
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({ tier: 'beta', isBeta: true, can: () => true, canCommunity: () => true }),
}));
jest.mock('../../lib/notifications', () => ({ fetchUnreadNotificationCount: jest.fn(() => Promise.resolve(0)) }));
jest.mock('../../store/authStore', () => {
  const state = { user: { id: 'discover-test-user' } };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
jest.mock('../../store/communityStore', () => {
  const state = {
    allCommunities: [] as unknown[],
    joinedIds: new Set<string>(),
    hydrate: jest.fn(() => Promise.resolve()),
    joinCommunity: jest.fn(() => Promise.resolve('joined')),
    requestedIds: new Set<string>(),
  };
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
jest.mock('../../components/nearby/NearbyRail', () => {
  const { Text } = require('react-native');
  return { NearbyRail: () => <Text testID="nearby-rail-stub">near you</Text> };
});

import DiscoverScreen from '../../app/(tabs)/discover/index';

describe('Discover — Near you rail', () => {
  it('is on For you, next to Communities for you', async () => {
    const v = render(<DiscoverScreen />);
    await waitFor(() => expect(v.getByTestId('nearby-rail-stub')).toBeTruthy());
    expect(v.getByTestId('rail-communities')).toBeTruthy();
  });

  it('stays under the Communities chip and leaves with every other chip', async () => {
    const v = render(<DiscoverScreen />);
    await waitFor(() => expect(v.getByTestId('nearby-rail-stub')).toBeTruthy());
    fireEvent.press(v.getByTestId('discover-chips-comms'));
    expect(v.getByTestId('nearby-rail-stub')).toBeTruthy();
    fireEvent.press(v.getByTestId('discover-chips-events'));
    expect(v.queryByTestId('nearby-rail-stub')).toBeNull();
  });
});
