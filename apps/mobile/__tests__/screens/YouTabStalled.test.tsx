import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

// This suite is about the branch BEFORE the profile exists. Once a retry
// succeeds the screen renders its full tree, and every one of these children
// owns a query of its own — none of which this file is testing.
jest.mock('../../components/profile/ProfileCard', () => ({ ProfileCard: () => null }));
jest.mock('../../components/profile/ProfileShell', () => ({ ProfileShell: () => null }));
jest.mock('../../components/profile/ProfilePhotoGrid', () => ({ ProfilePhotoGrid: () => null }));
jest.mock('../../components/profile/ProfileFavorites', () => ({ ProfileFavorites: () => null }));
jest.mock('../../components/profile/SavedPosts', () => ({ SavedPosts: () => null }));
jest.mock('../../components/profile/SavedWatchlist', () => ({ SavedWatchlist: () => null }));
jest.mock('../../components/profile/BadgeRow', () => ({ BadgeRow: () => null }));
jest.mock('../../components/profile/SelfControls', () => ({ SelfControls: () => null }));
jest.mock('../../components/grow/MiniWinsCard', () => ({ MiniWinsCard: () => null }));
jest.mock('../../components/build/OrderDetailSheet', () => ({ OrderDetailSheet: () => null }));
jest.mock('../../lib/notifications', () => ({ fetchUnreadNotificationCount: jest.fn(async () => 0) }));

const mockSingle = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: mockSingle,
          maybeSingle: mockSingle,
          order: jest.fn(() => Promise.resolve({ data: [], error: null })),
          in: jest.fn(() => Promise.resolve({ count: 0, error: null })),
        })),
        in: jest.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  },
}));

jest.mock('../../store/authStore', () => {
  const state = { user: { id: 'u1' } };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});
jest.mock('../../store/buildStore', () => {
  const state = { bookmarkedBusinessIds: new Set<string>(), loadBookmarks: jest.fn() };
  return {
    useBuildStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});
jest.mock('../../store/marketplaceStore', () => {
  const state = {
    orders: [], loadingOrders: false, ordersError: null, fetchOrders: jest.fn(),
  };
  return {
    useMarketplaceStore: (selector?: (s: typeof state) => unknown) =>
      (selector ? selector(state) : state),
  };
});
jest.mock('../../store/archiveStore', () => ({
  useArchiveStore: (sel: (s: { hydrateMine: () => void }) => unknown) =>
    sel({ hydrateMine: jest.fn() }),
}));

import ProfileScreen from '../../app/(tabs)/you/index';
import { useProfileStore } from '../../store/profileStore';

beforeEach(() => {
  jest.useFakeTimers();
  mockSingle.mockReset();
  useProfileStore.setState({ profile: null });
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * You is the only door to `/people` and `/badges`.
 *
 * The profile is loaded by the root layout, and the store has no error signal —
 * a failed or hanging load leaves `profile` null forever and this screen showed
 * a bare `ActivityIndicator` with no branch out of it. That was a permanent
 * spinner before the parity pass; now it is a permanent spinner that also takes
 * the friends list and the badges screen with it.
 */
describe('You — the profile never arrives', () => {
  it('shows a spinner first, not an error', () => {
    const view = render(<ProfileScreen />);
    expect(view.queryByTestId('you-profile-stalled')).toBeNull();
  });

  it('offers a way out once the wait stops being reasonable', async () => {
    const view = render(<ProfileScreen />);

    await act(async () => { jest.advanceTimersByTime(9_000); });

    await waitFor(() => expect(view.getByTestId('you-profile-stalled')).toBeTruthy());
    expect(view.getByTestId('you-profile-retry')).toBeTruthy();
  });

  it('retry re-reads the profile and the screen recovers', async () => {
    mockSingle.mockResolvedValue({
      data: { id: 'u1', username: 'her', display_name: 'Her', onboarding_completed: true },
      error: null,
    });

    const view = render(<ProfileScreen />);
    await act(async () => { jest.advanceTimersByTime(9_000); });
    await waitFor(() => expect(view.getByTestId('you-profile-retry')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('you-profile-retry')); });

    await waitFor(() => expect(useProfileStore.getState().profile?.id).toBe('u1'));
  });

  it('a failed retry says so instead of spinning again forever', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'network' } });

    const view = render(<ProfileScreen />);
    await act(async () => { jest.advanceTimersByTime(9_000); });
    await act(async () => { fireEvent.press(view.getByTestId('you-profile-retry')); });

    await waitFor(() => expect(view.getByTestId('you-profile-stalled')).toBeTruthy());
    expect(view.getByTestId('you-profile-retry')).toBeTruthy();
  });
});
