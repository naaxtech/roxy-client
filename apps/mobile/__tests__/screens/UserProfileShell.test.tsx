import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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
const mockOpenReport = jest.fn();
const mockBlock = jest.fn(async () => undefined);
let mockProfile: Record<string, unknown> | null = null;
let mockBadges: unknown[] = [];
let mockPostCount = 0;
let mockEvents: unknown[] = [];
let mockRooms: unknown[] = [];
let mockGames: unknown[] = [];
let mockCover: string | null = null;
let mockMembers: unknown[] = [];

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({ userId: 'u2' }),
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

jest.mock('../../store/followStore', () => ({
  useFollowStore: (sel: (s: unknown) => unknown) => {
    const state = {
      followingIds: new Set<string>(),
      hydrate: jest.fn(),
      follow: jest.fn(),
      unfollow: jest.fn(),
    };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

jest.mock('../../lib/confirm', () => ({
  confirmAction: jest.fn(async () => true),
  showAlert: jest.fn(),
}));

jest.mock('../../store/safetyStore', () => ({
  useSafetyStore: (sel?: (s: { openReportModal: () => void; blockUser: () => Promise<void> }) => unknown) => {
    const state = { openReportModal: mockOpenReport, blockUser: mockBlock };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

jest.mock('../../store/communityStore', () => ({
  useCommunityStore: (sel: (s: unknown) => unknown) => {
    const state = {
      joinedIds: new Set<string>(),
      hydrate: jest.fn(),
      joinCommunity: jest.fn(),
    };
    return typeof sel === 'function' ? sel(state) : state;
  },
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
      if (table === 'events') {
        const done = () => Promise.resolve({ data: mockEvents, error: null });
        const tail: Record<string, unknown> = {};
        const next = () => tail;
        tail.select = next;
        tail.eq = next;
        tail.gte = next;
        tail.in = next;
        tail.order = done;
        tail.then = (resolve: (v: unknown) => unknown) => done().then(resolve);
        return tail;
      }
      if (table === 'community_rooms') {
        const done = () => Promise.resolve({ data: mockRooms, error: null });
        const tail: Record<string, unknown> = {};
        const next = () => tail;
        tail.select = next;
        tail.eq = next;
        tail.neq = next;
        tail.order = done;
        tail.then = (resolve: (v: unknown) => unknown) => done().then(resolve);
        return tail;
      }
      if (table === 'communities') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { cover_image_url: mockCover },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'community_members') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve({ data: mockMembers, error: null }),
            }),
          }),
        };
      }
      if (table === 'community_games') {
        const done = () => Promise.resolve({ data: mockGames, error: null });
        const tail: Record<string, unknown> = {};
        const next = () => tail;
        tail.select = next;
        tail.eq = next;
        tail.then = (resolve: (v: unknown) => unknown) => done().then(resolve);
        return tail;
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
  mockEvents = [];
  mockRooms = [];
  mockGames = [];
  mockCover = null;
  mockMembers = [];
  mockOpenReport.mockClear();
  mockBlock.mockClear();
});

describe('user profile on the unified shell', () => {
  it('renders the shell', async () => {
    const { getByTestId } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
  });

  it('keeps the earned badges that ProfileCard showed', async () => {
    const { getByTestId } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-badge-chip')).toBeTruthy());
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

  it('shows Follow on a person and Join on an official community account', async () => {
    const person = render(<UserProfileScreen />);
    await waitFor(() => expect(person.getByTestId('profile-follow')).toBeTruthy());
    expect(person.queryByTestId('profile-join')).toBeNull();
    person.unmount();

    mockProfile = { ...aProfile, official_community_id: 'c-official' };
    const official = render(<UserProfileScreen />);
    await waitFor(() => expect(official.getByTestId('profile-join')).toBeTruthy());
    expect(official.getByTestId('profile-follow')).toBeTruthy();
    expect(official.getByTestId('profile-official-chip')).toBeTruthy();
  });

  it('shows Events when she hosts an upcoming night, and no empty Rooms / Games tabs', async () => {
    mockEvents = [{
      id: 'e1', title: 'Pub night', starts_at: '2026-10-01T19:00:00Z',
      event_type: 'in_person', location_text: 'Soho', status: 'active',
    }];
    const { getByTestId, queryByTestId } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-tab-events')).toBeTruthy());
    expect(queryByTestId('profile-tab-rooms')).toBeNull();
    expect(queryByTestId('profile-tab-games')).toBeNull();
  });

  it('shows Rooms and Games on an official account only when those rows exist', async () => {
    mockProfile = { ...aProfile, official_community_id: 'c-official' };
    mockRooms = [{
      id: 'r1', name: 'Sunday lounge', status: 'live', room_type: 'audio',
      description: null, scheduled_at: null, participant_count: 3,
      max_participants: 12, created_by: 'u2',
    }];
    mockGames = [{ games: { id: 'g1', name: 'Quiz', short_description: 'Weekly', category: 'trivia', url: null, publisher_type: 'community' } }];
    const { getByTestId } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-tab-rooms')).toBeTruthy());
    expect(getByTestId('profile-tab-games')).toBeTruthy();
  });

  it('uses the official community cover and an online-now row when members are live', async () => {
    mockProfile = { ...aProfile, official_community_id: 'c-official' };
    mockCover = 'https://cdn.example/wlw-cover.jpg';
    mockMembers = [{
      user_id: 'u3',
      profiles: { display_name: 'Maya', avatar_url: null, last_seen_at: new Date().toISOString() },
    }];
    const { getByTestId, getByText } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-cover-photo')).toBeTruthy());
    expect(getByTestId('profile-online-row')).toBeTruthy();
    expect(getByText(/1 online now · Maya/)).toBeTruthy();
  });

  it('opens Report from the header More, against this profile', async () => {
    const { getByTestId } = render(<UserProfileScreen />);
    await waitFor(() => expect(getByTestId('profile-more')).toBeTruthy());
    fireEvent.press(getByTestId('profile-more'));
    fireEvent.press(getByTestId('profile-more-report'));
    expect(mockOpenReport).toHaveBeenCalledWith({ userId: 'u2', contentType: 'profile' });
  });
});
