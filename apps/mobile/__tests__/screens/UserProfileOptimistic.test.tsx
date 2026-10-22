import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import UserProfileScreen from '../../app/(tabs)/you/[userId]';
import { useFriendStore } from '../../store/friendStore';

/**
 * F10 on her profile, with the REAL friend store: "Add friend" turns into
 * "Requested" in the same act() as the tap while the insert is still in
 * flight, and a refused insert puts "Add friend" back with a snackbar that
 * offers Retry. No writes leave this file: `friendships.insert` is a promise
 * this file holds open or rejects.
 */

let mockInsert: () => Promise<unknown> = () => new Promise(() => undefined);
const mockFollow = jest.fn(async () => true);
const mockAlert = jest.fn();
const mockStable = { hydrate: jest.fn(), unfollow: jest.fn(async () => true), joinCommunity: jest.fn(), report: jest.fn(), block: jest.fn(), mute: jest.fn(), unmute: jest.fn() };
const mockNoIds = new Set<string>();
const mockNoMuted: string[] = [];

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ userId: 'u2' }),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ Analytics: new Proxy({}, { get: () => jest.fn() }) }));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({ tier: 'beta', isBeta: true, can: () => true, canCommunity: () => true }),
}));
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => {
    const state = { user: { id: 'u1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../store/followStore', () => ({
  useFollowStore: (sel: (s: unknown) => unknown) => {
    const state = { followingIds: mockNoIds, hydrate: mockStable.hydrate, follow: mockFollow, unfollow: mockStable.unfollow };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../store/communityStore', () => ({
  useCommunityStore: (sel: (s: unknown) => unknown) => {
    const state = { joinedIds: mockNoIds, hydrate: mockStable.hydrate, joinCommunity: mockStable.joinCommunity };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../store/safetyStore', () => ({
  useSafetyStore: (sel?: (s: never) => unknown) => {
    const state = { openReportModal: mockStable.report, blockUser: mockStable.block, mutedUserIds: mockNoMuted, muteUser: mockStable.mute, unmuteUser: mockStable.unmute } as never;
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../lib/confirm', () => ({
  confirmAction: jest.fn(async () => true),
  showAlert: (...a: unknown[]) => mockAlert(...a),
}));
jest.mock('../../components/profile/ProfilePhotoGrid', () => ({ ProfilePhotoGrid: () => null }));
jest.mock('../../components/profile/ProfilePostsGrid', () => ({ ProfilePostsGrid: () => null }));

jest.mock('../../lib/supabase', () => {
  const profile = {
    id: 'u2', display_name: 'Ari', username: 'ari', bio: null, pronouns: [], identity_labels: [],
    avatar_url: null, gamification_points: 0,
  };
  const make = (table: string) => {
    const chain: Record<string, unknown> = {};
    const done = () => Promise.resolve(
      table === 'profiles' ? { data: profile, error: null } : { data: [], error: null },
    );
    for (const k of ['select', 'eq', 'in', 'is', 'or', 'gte', 'neq', 'order', 'limit', 'contains', 'update', 'delete']) {
      chain[k] = () => chain;
    }
    chain.single = done;
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => done().then(res, rej);
    chain.insert = () => mockInsert();
    return chain;
  };
  return {
    supabase: {
      from: jest.fn(make),
      rpc: jest.fn(() => Promise.resolve({ data: [], error: null })),
      auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })) },
    },
  };
});

const friendLabel = (v: ReturnType<typeof render>) => {
  const node = v.getByTestId('profile-friend');
  return v.queryAllByText(/Add friend|Requested|Accept/).map((n) => n.props.children).join('|') || String(node);
};

beforeEach(() => {
  mockInsert = () => new Promise(() => undefined);
  mockFollow.mockReset().mockResolvedValue(true);
  mockAlert.mockReset();
  useFriendStore.setState({
    friends: [], pendingReceived: [], pendingSent: [], pendingCount: 0, _userId: 'u1', _lastHeartbeat: Date.now(),
  });
});

describe('her profile answers the tap, not the network (F10)', () => {
  it('"Add friend" reads "Requested" in the same frame, while the insert is still in flight', async () => {
    const v = render(<UserProfileScreen />);
    await waitFor(() => expect(v.getByText('Add friend')).toBeTruthy());
    act(() => { fireEvent.press(v.getByText('Add friend')); });
    expect(v.getByText('Requested')).toBeTruthy();
    expect(v.queryByText('Add friend')).toBeNull();
    expect(friendLabel(v)).toMatch(/Requested/);
  });

  it('a refused request rolls back to "Add friend" and offers Retry in a snackbar', async () => {
    mockInsert = () => Promise.resolve({ error: { code: '42501', message: 'policy text' } });
    const v = render(<UserProfileScreen />);
    await waitFor(() => expect(v.getByText('Add friend')).toBeTruthy());
    await act(async () => { fireEvent.press(v.getByText('Add friend')); });

    await waitFor(() => expect(v.getByTestId('profile-action-snackbar')).toBeTruthy());
    expect(v.getByText('Add friend')).toBeTruthy();
    expect(v.getByText('Could not send that request.')).toBeTruthy();
    expect(v.queryByText(/policy text/)).toBeNull();
    // A snackbar, not a blocking alert.
    expect(mockAlert).not.toHaveBeenCalled();

    // Retry sends it again (and flips again at once).
    mockInsert = () => new Promise(() => undefined);
    act(() => { fireEvent.press(v.getByTestId('profile-action-snackbar-action')); });
    expect(v.getByText('Requested')).toBeTruthy();
  });

  it('a follow that fails says so in a snackbar with Retry', async () => {
    mockFollow.mockResolvedValue(false);
    const v = render(<UserProfileScreen />);
    await waitFor(() => expect(v.getByText('Follow')).toBeTruthy());
    await act(async () => { fireEvent.press(v.getByText('Follow')); });
    await waitFor(() => expect(v.getByText('Could not follow her.')).toBeTruthy());
    expect(mockAlert).not.toHaveBeenCalled();
    mockFollow.mockResolvedValue(true);
    await act(async () => { fireEvent.press(v.getByTestId('profile-action-snackbar-action')); });
    expect(mockFollow).toHaveBeenCalledTimes(2);
  });
});
