/**
 * `/communities?near=1` is where the Near you rail's "See all" lands: the
 * nearby browser under a "Communities near you" title. Without the param the
 * route is the full communities browser, unchanged.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockParams: { near?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: { user: { id: string } }) => unknown) => {
    const state = { user: { id: 'u1' } };
    return sel ? sel(state) : state;
  },
}));
jest.mock('../../store/communityStore', () => ({
  useCommunityStore: (sel?: (s: { hydrate: () => Promise<void> }) => unknown) => {
    const state = { hydrate: () => Promise.resolve() };
    return sel ? sel(state) : state;
  },
}));
jest.mock('../../components/community/CommunitiesBrowser', () => {
  const { Text } = require('react-native');
  return { CommunitiesBrowser: () => <Text testID="communities-browser">all</Text> };
});
jest.mock('../../components/nearby/NearbyBrowser', () => {
  const { Text } = require('react-native');
  return { NearbyBrowser: () => <Text testID="nearby-browser">near</Text> };
});

import CommunitiesScreen from '../../app/communities';

beforeEach(() => {
  delete mockParams.near;
});

describe('/communities', () => {
  it('?near=1 is the nearby browser', () => {
    mockParams.near = '1';
    const v = render(<CommunitiesScreen />);
    expect(v.getByTestId('nearby-browser')).toBeTruthy();
    expect(v.queryByTestId('communities-browser')).toBeNull();
    expect(v.getByText('Communities near you')).toBeTruthy();
  });

  it('no param: the full browser, as before', () => {
    const v = render(<CommunitiesScreen />);
    expect(v.getByTestId('communities-browser')).toBeTruthy();
    expect(v.queryByTestId('nearby-browser')).toBeNull();
    expect(v.getByText('Communities')).toBeTruthy();
  });
});
