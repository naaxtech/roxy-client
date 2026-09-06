/**
 * `/communities` is the destination the Discover screen test proves the
 * "See all" link navigates to (`__tests__/screens/DiscoverScreen.test.tsx`).
 * This file proves the destination itself actually works: it hydrates the
 * store `CommunitiesBrowser` reads directly (the browser does not hydrate
 * itself), and it renders the browser rather than an empty shell.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock('../../hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    background: '#14082A', surface: '#211039', surfaceLight: '#2D1B4E',
    textPrimary: '#F7F3FC', textSecondary: '#C6B5E4', textMuted: '#9C89C2',
    primary: '#F22481', secondary: '#A78BFA', roxy: '#E879A6',
  }),
}));

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  const { createElement } = require('react');
  return {
    FlashList: ({ data, renderItem, ListEmptyComponent }: {
      data: unknown[];
      renderItem: (arg: { item: unknown; index: number }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
    }) =>
      (data && data.length > 0)
        ? createElement(
            View,
            null,
            ...data.map((item, index) => createElement(View, { key: index }, renderItem({ item, index }))),
          )
        : ListEmptyComponent ?? null,
  };
});

jest.mock('../../store/authStore', () => ({
  useAuthStore: (selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: 'communities-test-user' } };
    return selector ? selector(state) : state;
  },
}));

jest.mock('../../store/communityStore', () => {
  const hydrate = jest.fn(() => Promise.resolve());
  const state = {
    allCommunities: [
      {
        id: 'c1', name: 'Femme Founders', slug: 'femme-founders', description: 'For builders',
        cover_image_url: null, category: 'general', is_private: false,
        member_count: 42, created_by: 'u0', created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    joinedIds: new Set<string>(),
    joinCommunity: jest.fn(() => Promise.resolve()),
    leaveCommunity: jest.fn(() => Promise.resolve()),
    hydrate,
  };
  return {
    __hydrate: hydrate,
    useCommunityStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

import CommunitiesScreen from '../../app/communities';

const { __hydrate: hydrate } = jest.requireMock('../../store/communityStore');

beforeEach(() => { jest.clearAllMocks(); });

describe('CommunitiesScreen', () => {
  it('hydrates the community store for the signed-in member', async () => {
    render(<CommunitiesScreen />);
    await waitFor(() => expect(hydrate).toHaveBeenCalledWith('communities-test-user'));
  });

  it('renders the full browser rather than an empty shell', async () => {
    const { getByText, getByPlaceholderText } = render(<CommunitiesScreen />);
    await waitFor(() => expect(getByText('Femme Founders')).toBeTruthy());
    expect(getByPlaceholderText('Search communities...')).toBeTruthy();
  });

  it('titles the header Communities with a way back', () => {
    const { getByText, getByLabelText } = render(<CommunitiesScreen />);
    expect(getByText('Communities')).toBeTruthy();
    expect(getByLabelText('Back')).toBeTruthy();
  });
});
