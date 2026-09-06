import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'c1' }),
  usePathname: () => '/community/c1',
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
jest.mock('../../lib/analytics', () => ({ Analytics: { communityViewed: jest.fn(), communityJoined: jest.fn() } }));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn() }));
jest.mock('../../lib/realtimeChannel', () => ({
  freshChannel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
}));
jest.mock('../../components/feed/FeedCard', () => ({ FeedCard: () => null }));
jest.mock('../../components/feed/ReelsFeed', () => ({ ReelsFeed: () => null }));
jest.mock('../../components/community/CommunityRoomCard', () => ({ CommunityRoomCard: () => null }));
jest.mock('../../components/events/EventsCalendar', () => ({ EventsCalendar: () => null }));
jest.mock('../../components/ui/EmptyState', () => ({ EmptyState: () => null }));

const community = {
  id: 'c1',
  name: 'WLW London',
  slug: 'wlw-london',
  description: 'A house for sapphics in the city.',
  cover_image_url: null,
  category: 'city',
  is_private: false,
  member_count: 1240,
  created_by: 'u1',
  created_at: '2025-03-01T00:00:00Z',
};

jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: { user: { id: string } }) => unknown) => {
    const state = { user: { id: 'u1' } };
    return sel ? sel(state) : state;
  },
}));
jest.mock('../../store/communityStore', () => ({
  useCommunityStore: () => ({
    joinedIds: new Set(['c1']),
    allCommunities: [community],
    joinCommunity: jest.fn(),
    leaveCommunity: jest.fn(),
    fetchAll: jest.fn(),
    fetchJoined: jest.fn(),
  }),
}));
jest.mock('../../store/feedStore', () => ({
  useFeedStore: () => ({
    likedPostIds: new Set(),
    savedPostIds: new Set(),
    init: jest.fn(),
    toggleLike: jest.fn(),
    toggleSave: jest.fn(),
  }),
}));

const thenable = (data: unknown) => {
  const chain: Record<string, unknown> = {};
  const next = () => chain;
  chain.select = next;
  chain.eq = next;
  chain.neq = next;
  chain.gte = next;
  chain.is = next;
  chain.order = next;
  chain.limit = () => Promise.resolve({ data, error: null });
  chain.single = () => Promise.resolve({ data, error: null });
  chain.delete = next;
  chain.insert = () => Promise.resolve({ data, error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return chain;
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => thenable([])),
    removeChannel: jest.fn(),
  },
}));

import CommunityDetailScreen from '../../app/(tabs)/discover/community/[id]';

describe('community on the unified shell', () => {
  it('draws the community variant of ProfileShell, not a private header', async () => {
    const { getByTestId, getByText } = render(<CommunityDetailScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
    expect(getByText('WLW London')).toBeTruthy();
    expect(getByTestId('profile-tab-about')).toBeTruthy();
  });

  it('gives a joined member a Channels action on the shell', async () => {
    const { getByTestId } = render(<CommunityDetailScreen />);
    await waitFor(() => expect(getByTestId('community-channels-link')).toBeTruthy());
  });
});
