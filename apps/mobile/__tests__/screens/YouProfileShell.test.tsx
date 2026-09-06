import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/notifications', () => ({ fetchUnreadNotificationCount: jest.fn(async () => 0) }));
jest.mock('../../components/profile/ProfilePhotoGrid', () => ({ ProfilePhotoGrid: () => null }));
jest.mock('../../components/profile/ProfileFavorites', () => ({ ProfileFavorites: () => null }));
jest.mock('../../components/profile/SavedPosts', () => ({ SavedPosts: () => null }));
jest.mock('../../components/profile/SavedWatchlist', () => ({ SavedWatchlist: () => null }));
jest.mock('../../components/profile/BadgeRow', () => ({ BadgeRow: () => null }));
jest.mock('../../components/profile/SelfControls', () => ({
  SelfControls: () => {
    const { View } = require('react-native');
    return <View testID="self-controls" />;
  },
}));
jest.mock('../../components/grow/MiniWinsCard', () => ({ MiniWinsCard: () => null }));
jest.mock('../../components/build/OrderDetailSheet', () => ({ OrderDetailSheet: () => null }));

const thenable = (data: unknown, count = 0) => {
  const chain: Record<string, unknown> = {};
  const next = () => chain;
  chain.select = next;
  chain.eq = next;
  chain.in = () => Promise.resolve({ data, count, error: null });
  chain.single = () => Promise.resolve({ data, error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, count, error: null }).then(resolve);
  return chain;
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'posts') return thenable([], 2);
      if (table === 'user_badge_progress') return thenable([]);
      if (table === 'businesses') return thenable([]);
      return thenable([]);
    }),
  },
}));

jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: { user: { id: string } }) => unknown) => {
    const state = { user: { id: 'u1' } };
    return sel ? sel(state) : state;
  },
}));
jest.mock('../../store/buildStore', () => {
  const bookmarkedBusinessIds = new Set<string>();
  const loadBookmarks = jest.fn();
  return {
    useBuildStore: (sel?: (s: { bookmarkedBusinessIds: Set<string>; loadBookmarks: () => void }) => unknown) => {
      const state = { bookmarkedBusinessIds, loadBookmarks };
      return sel ? sel(state) : state;
    },
  };
});
jest.mock('../../store/marketplaceStore', () => {
  const fetchOrders = jest.fn();
  const orders: never[] = [];
  return {
    useMarketplaceStore: (sel?: (s: {
      orders: never[]; loadingOrders: boolean; ordersError: null; fetchOrders: () => void;
    }) => unknown) => {
      const state = { orders, loadingOrders: false, ordersError: null, fetchOrders };
      return sel ? sel(state) : state;
    },
  };
});
jest.mock('../../store/archiveStore', () => ({
  useArchiveStore: (sel: (s: { hydrateMine: () => void }) => unknown) =>
    sel({ hydrateMine: jest.fn() }),
}));

import ProfileScreen from '../../app/(tabs)/you/index';
import { useProfileStore } from '../../store/profileStore';

beforeEach(() => {
  useProfileStore.setState({
    profile: {
      id: 'u1',
      username: 'her',
      display_name: 'Her',
      bio: 'Here.',
      pronouns: ['she/her'],
      identity_labels: ['lesbian'],
      avatar_url: null,
      gamification_points: 40,
      onboarding_completed: true,
    } as never,
  });
});

describe('You on the unified shell', () => {
  it('draws the self variant instead of ProfileCard', async () => {
    const { getByTestId, getByText } = render(<ProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
    expect(getByText('Her')).toBeTruthy();
    expect(getByTestId('you-coming-soon')).toBeTruthy();
    expect(getByTestId('profile-tab-saved')).toBeTruthy();
    expect(getByText('Edit')).toBeTruthy();
  });

  it('shows the full self controls once she is tagged beta', async () => {
    useProfileStore.setState({
      profile: { ...useProfileStore.getState().profile, access_tier: 'beta' } as never,
    });
    const { getByTestId } = render(<ProfileScreen />);
    await waitFor(() => expect(getByTestId('self-controls')).toBeTruthy());
  });
});
