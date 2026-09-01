import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import UserProfileScreen from '../../app/(tabs)/you/[userId]';

/**
 * The user profile renders the unified shell, and loses nothing doing it.
 *
 * `ProfileCard` drew this screen with its own header and a `photos | about |
 * badges` strip. The shell's tab set has no `badges` — correctly, because the
 * prototype puts badges in the header as a chip, not as a tab (markup line 470)
 * — and its header already carries the bio and the level that `about` existed to
 * show. So the swap is only safe if the earned-badge strip survives, and that is
 * what the first test here is for.
 *
 * The second is the rule the whole shell exists for: a tab with nothing in it is
 * absent, not empty. A Shop tab on a woman who has never applied to sell is a
 * checkout in front of an unvetted account.
 */

const mockPush = jest.fn();
let mockProfile: Record<string, unknown> | null = null;
let mockBadges: unknown[] = [];
let mockPostCount = 0;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({ userId: 'u2' }),
}));

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => {
    const state = { user: { id: 'u1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

jest.mock('../../store/friendStore', () => ({
  useFriendStore: () => ({
    friends: [], pendingReceived: [], pendingSent: [],
    sendRequest: jest.fn(), acceptRequest: jest.fn(),
  }),
}));

// The grid runs its own query; this suite is about which tabs exist, not what
// is inside one.
jest.mock('../../components/profile/ProfilePhotoGrid', () => ({
  ProfilePhotoGrid: () => null,
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.contains = () => chain;
      chain.single = () =>
        Promise.resolve(
          mockProfile ? { data: mockProfile, error: null } : { data: null, error: { message: 'no row' } }
        );
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.then = undefined;
      if (table === 'user_badge_progress') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: mockBadges, error: null }) }),
        };
      }
      if (table === 'posts') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ count: mockPostCount, error: null }),
            }),
          }),
        };
      }
      return chain;
    }),
  },
}));

const aProfile = {
  id: 'u2',
  display_name: 'Ari',
  username: 'ari',
  bio: 'Hiker. Baker.',
  pronouns: ['she/her'],
  identity_labels: ['lesbian'],
  avatar_url: null,
  gamification_points: 120,
};

const aBadge = {
  id: 'b1',
  user_id: 'u2',
  badge_id: 'bd1',
  earned_at: '2026-08-01T00:00:00Z',
  progress: 1,
  badges: { id: 'bd1', name: 'First post', icon: '🌸', description: 'Posted once', tier: 'bronze' },
};

beforeEach(() => {
  mockPush.mockClear();
  mockProfile = { ...aProfile };
  mockBadges = [aBadge];
  mockPostCount = 3;
});

describe('user profile on the unified shell', () => {
  it('renders the shell', async () => {
    const { getByTestId } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
  });

  it('keeps the earned badges that ProfileCard showed', async () => {
    const { getByTestId } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-badges')).toBeTruthy());
  });

  it('shows Posts when she has media, and no Shop for a woman who has not applied to sell', async () => {
    const { getByTestId, queryByTestId } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-tab-posts')).toBeTruthy());
    expect(queryByTestId('profile-tab-shop')).toBeNull();
  });

  it('omits the Posts tab entirely when she has posted nothing, rather than drawing an empty one', async () => {
    mockPostCount = 0;
    const { getByTestId, queryByTestId } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
    expect(queryByTestId('profile-tab-posts')).toBeNull();
  });

  it('says so when the profile is missing instead of rendering an empty shell', async () => {
    mockProfile = null;
    const { getByTestId } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-not-found')).toBeTruthy());
  });
});
