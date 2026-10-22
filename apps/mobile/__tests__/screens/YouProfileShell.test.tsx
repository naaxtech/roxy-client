import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import { StyleSheet } from 'react-native';
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
jest.mock('../../components/profile/ProfilePostsGrid', () => ({ ProfilePostsGrid: () => null }));
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
jest.mock('../../components/feed/MiniWinsSheet', () => ({ MiniWinsSheet: () => null }));
jest.mock('../../components/build/OrderDetailSheet', () => ({ OrderDetailSheet: () => null }));

const thenable = (data: unknown, count = 0) => {
  const chain: Record<string, unknown> = {};
  const next = () => chain;
  chain.select = next;
  chain.eq = next;
  chain.is = next;
  chain.in = () => Promise.resolve({ data, count, error: null });
  chain.single = () => Promise.resolve({ data, error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, count, error: null }).then(resolve);
  return chain;
};

jest.mock('../../lib/profileHosted', () => ({
  hostedTabFlags: () => ({ events: false, rooms: false, games: false }),
  loadHostedProfile: jest.fn(async () => ({ events: [], rooms: [], games: [] })),
}));

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
  useArchiveStore: (sel: (s: { hydrateMine: () => void; watchlist: string[] }) => unknown) =>
    sel({ hydrateMine: jest.fn(), watchlist: [] }),
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

describe('You while her profile loads (F8, F11)', () => {
  it('shows her profile header\'s shape, never a spinner', () => {
    useProfileStore.setState({ profile: null });
    const v = render(<ProfileScreen />);
    expect(v.getByTestId('you-loading').props.accessibilityRole).toBe('progressbar');
    expect(v.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
  });
});

describe('You on the unified shell', () => {
  it('draws the self variant instead of ProfileCard', async () => {
    const { getByTestId, getByText } = render(<ProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
    expect(getByText('Her')).toBeTruthy();
    expect(getByTestId('you-coming-soon')).toBeTruthy();
    expect(getByTestId('you-more')).toBeTruthy();
    expect(getByTestId('profile-tab-posts')).toBeTruthy();
    // Text posts get their own tab: a square crops the one thing a written
    // post is made of.
    expect(getByTestId('profile-tab-thoughts')).toBeTruthy();
    expect(getByTestId('profile-tab-saved')).toBeTruthy();
    expect(getByText('Edit')).toBeTruthy();
  });

  it('draws no XP pill, no level badge and no badge chip (v2 bans them on her own profile)', async () => {
    // Was: '40 XP' visible. XP is reachable inside Mini Wins instead.
    const { getByTestId, queryByTestId, queryByText } = render(<ProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
    expect(queryByText('40 XP')).toBeNull();
    expect(queryByTestId('profile-xp')).toBeNull();
    expect(queryByTestId('profile-level-badge')).toBeNull();
    expect(queryByTestId('profile-badge-chip')).toBeNull();
  });

  it('drops the coming-soon card once she is tagged beta', async () => {
    useProfileStore.setState({
      profile: { ...useProfileStore.getState().profile, access_tier: 'beta' } as never,
    });
    const { getByTestId, queryByTestId } = render(<ProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
    expect(queryByTestId('you-coming-soon')).toBeNull();
  });

  it('puts Dating, Ghost and Mini Wins back on You, then the rows she goes to', async () => {
    // Reversed by design direction v2 › You (2026-10-21): "the two switches
    // that matter, Dating and Ghost, as plain rows" — ghost mode one tap away.
    // Was: asserted self-controls absent.
    const { getByTestId } = render(<ProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
    expect(getByTestId('self-controls')).toBeTruthy();
    expect(getByTestId('you-rows')).toBeTruthy();
  });

  it('shows no stat card — Posts / Badges / Orders was shelved', async () => {
    const { getByTestId, queryByTestId } = render(<ProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
    expect(queryByTestId('profile-stats')).toBeNull();
  });

  /**
   * Direction v2 › The Roxy AI button: on You, Roxy tucks while the list
   * scrolls down, and the list ends at least FAB_LANE higher so the last row
   * can always scroll clear of her lane. The root list is ProfileShell's.
   */
  it('hooks the root list to the Roxy AI tuck and ends it a lane higher', async () => {
    const { onListScroll, onListContentSizeChange, LIST_SCROLL_THROTTLE } = jest.requireActual('../../lib/roxyFab') as
      typeof import('../../lib/roxyFab');
    const { FAB_LANE } = jest.requireActual('../../components/nav/navTokens') as
      typeof import('../../components/nav/navTokens');
    const { getByTestId } = render(<ProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
    const root = getByTestId('profile-shell');
    expect(root.props.onScroll).toBe(onListScroll);
    // Content that lands after she came out at the end re-judges her lane (Wave 3).
    expect(root.props.onContentSizeChange).toBe(onListContentSizeChange);
    expect(root.props.scrollEventThrottle).toBe(LIST_SCROLL_THROTTLE);
    const content = StyleSheet.flatten(root.props.contentContainerStyle) as { paddingBottom?: number };
    expect(Number(content.paddingBottom)).toBeGreaterThanOrEqual(FAB_LANE);
  });
});
