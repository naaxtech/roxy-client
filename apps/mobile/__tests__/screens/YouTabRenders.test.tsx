import 'react-native-gesture-handler/jestSetup';
import React, { Profiler } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

/**
 * Jank audit #9: the You tab subscribed to whole stores (auth, profile, build,
 * marketplace), so Discover's `loadBusinesses`, a token refresh or any other
 * write to those stores re-rendered the hidden You tab synchronously inside a
 * network callback. Here the stores are real zustand stores; a write to a
 * field You does not read must not commit a render.
 */

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
// No navigator here: a focus effect runs once, on mount (the bell reads its
// unread count on focus).
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb: () => unknown) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb() as void | (() => void), [cb]);
  },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/notifications', () => ({ fetchUnreadNotificationCount: jest.fn(async () => 0) }));
jest.mock('../../components/profile/ProfilePhotoGrid', () => ({ ProfilePhotoGrid: () => null }));
jest.mock('../../components/profile/ProfilePostsGrid', () => ({ ProfilePostsGrid: () => null }));
jest.mock('../../components/profile/ProfileFavorites', () => ({ ProfileFavorites: () => null }));
jest.mock('../../components/profile/SavedPosts', () => ({ SavedPosts: () => null }));
jest.mock('../../components/profile/SavedWatchlist', () => ({ SavedWatchlist: () => null }));
jest.mock('../../components/profile/BadgeRow', () => ({ BadgeRow: () => null }));
jest.mock('../../components/profile/SelfControls', () => ({ SelfControls: () => null }));
jest.mock('../../components/grow/MiniWinsCard', () => ({ MiniWinsCard: () => null }));
jest.mock('../../components/feed/MiniWinsSheet', () => ({ MiniWinsSheet: () => null }));
jest.mock('../../components/build/OrderDetailSheet', () => ({ OrderDetailSheet: () => null }));
jest.mock('../../lib/profileHosted', () => ({
  hostedTabFlags: () => ({ events: false, rooms: false, games: false }),
  loadHostedProfile: jest.fn(async () => ({ events: [], rooms: [], games: [] })),
}));
jest.mock('../../lib/supabase', () => {
  const thenable = () => {
    const chain: Record<string, unknown> = {};
    const next = () => chain;
    chain.select = next; chain.eq = next; chain.is = next;
    chain.in = () => Promise.resolve({ data: [], count: 0, error: null });
    chain.single = () => Promise.resolve({ data: null, error: null });
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
    return chain;
  };
  return { supabase: { from: jest.fn(() => thenable()) } };
});
jest.mock('../../store/authStore', () => {
  const { create } = require('zustand');
  return { useAuthStore: create(() => ({ user: { id: 'u1' }, session: { access_token: 'a' } })) };
});
jest.mock('../../store/buildStore', () => {
  const { create } = require('zustand');
  const ids = new Set<string>();
  return { useBuildStore: create(() => ({ bookmarkedBusinessIds: ids, loadBookmarks: () => undefined, searchQuery: '' })) };
});
jest.mock('../../store/marketplaceStore', () => {
  const { create } = require('zustand');
  return {
    useMarketplaceStore: create(() => ({
      orders: [], loadingOrders: false, ordersError: null, fetchOrders: () => undefined, businesses: [],
    })),
  };
});
jest.mock('../../store/archiveStore', () => ({
  useArchiveStore: (sel: (s: { hydrateMine: () => void; watchlist: string[] }) => unknown) =>
    sel({ hydrateMine: () => undefined, watchlist: [] }),
}));

import ProfileScreen from '../../app/(tabs)/you/index';
import { useProfileStore } from '../../store/profileStore';
import { useAuthStore } from '../../store/authStore';
import { useBuildStore } from '../../store/buildStore';
import { useMarketplaceStore } from '../../store/marketplaceStore';

beforeEach(() => {
  useProfileStore.setState({
    profile: {
      id: 'u1', username: 'her', display_name: 'Her', bio: 'Here.', pronouns: [], identity_labels: [],
      avatar_url: null, gamification_points: 40, onboarding_completed: true,
    } as never,
  });
});

it('a write to a store field You does not read does not re-render the You tab', async () => {
  let commits = 0;
  const v = render(
    <Profiler id="you" onRender={() => { commits += 1; }}>
      <ProfileScreen />
    </Profiler>,
  );
  await waitFor(() => expect(v.getByTestId('profile-shell')).toBeTruthy());
  // Let the mount-time fetches settle.
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  const before = commits;

  act(() => { (useMarketplaceStore as unknown as { setState: (p: object) => void }).setState({ businesses: [{ id: 'b1' }] }); });
  act(() => { (useAuthStore as unknown as { setState: (p: object) => void }).setState({ session: { access_token: 'refreshed' } }); });
  act(() => { (useBuildStore as unknown as { setState: (p: object) => void }).setState({ searchQuery: 'candles' }); });

  expect(commits).toBe(before);
});
