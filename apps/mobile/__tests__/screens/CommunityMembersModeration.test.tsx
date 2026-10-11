import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import MembersScreen from '../../app/(tabs)/discover/community/members/[communityId]';

/**
 * CHAT-09 on the Members screen: moderators see who is asking to join a
 * private community and say yes or no, and can remove or ban a member below
 * their rank. Members see none of it.
 */
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ communityId: 'com1' }),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn(), confirmAction: jest.fn().mockResolvedValue(true) }));
jest.mock('../../store/authStore', () => ({ useAuthStore: () => ({ user: { id: 'me' } }) }));
jest.mock('../../store/friendStore', () => ({
  useFriendStore: () => ({
    friends: [], pendingReceived: [], pendingSent: [],
    sendRequest: jest.fn(), acceptRequest: jest.fn(), fetchAll: jest.fn().mockResolvedValue(undefined),
  }),
}));
const mockMembers = [
  { profiles: { id: 'me', display_name: 'Me', username: 'me', avatar_url: null } },
  { profiles: { id: 'sam', display_name: 'Sam', username: 'sam', avatar_url: null } },
  { profiles: { id: 'ana', display_name: 'Ana', username: 'ana', avatar_url: null } },
];
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = { select: () => q, eq: () => q, limit: () => Promise.resolve({ data: mockMembers, error: null }) };
      return q;
    },
  },
}));
const mockRoles = { value: new Map<string, string>([['me', 'moderator'], ['ana', 'admin']]) };
jest.mock('../../lib/channels', () => ({
  ...jest.requireActual('../../lib/channels'),
  fetchMyChannelRole: jest.fn(() => Promise.resolve({ isModerator: mockRoles.value.get('me') !== undefined })),
}));
jest.mock('../../lib/communityMembership', () => ({
  ...jest.requireActual('../../lib/communityMembership'),
  fetchElevatedRoles: jest.fn(() => Promise.resolve(mockRoles.value)),
  fetchJoinRequests: jest.fn(() => Promise.resolve([
    { user_id: 'bea', note: 'Ana sent me', created_at: '2026-10-11T09:00:00Z', profile: { id: 'bea', display_name: 'Bea', username: 'bea', avatar_url: null } },
  ])),
  respondJoinRequest: jest.fn(() => Promise.resolve()),
  removeCommunityMember: jest.fn(() => Promise.resolve()),
  fetchCommunityBans: jest.fn(() => Promise.resolve([
    { user_id: 'kim', reason: 'spam', created_at: '2026-10-10T09:00:00Z', expires_at: null, profile: { id: 'kim', display_name: 'Kim', username: 'kim', avatar_url: null } },
  ])),
  unbanCommunityMember: jest.fn(() => Promise.resolve()),
}));

const membership = jest.requireMock('../../lib/communityMembership');
const { confirmAction } = jest.requireMock('../../lib/confirm');

beforeEach(() => {
  jest.clearAllMocks();
  mockRoles.value = new Map([['me', 'moderator'], ['ana', 'admin']]);
});

it('a moderator sees who is asking to join, with her note', async () => {
  const view = render(<MembersScreen />);
  expect(await view.findByTestId('join-request-bea')).toBeTruthy();
  expect(view.getByText('Ana sent me')).toBeTruthy();
});

it('approve and decline go through respond_join_request', async () => {
  const view = render(<MembersScreen />);
  await view.findByTestId('join-request-bea');
  await act(async () => { fireEvent.press(view.getByLabelText('Let Bea in')); });
  await waitFor(() => expect(membership.respondJoinRequest).toHaveBeenCalledWith('com1', 'bea', true));
  await waitFor(() => expect(view.queryByTestId('join-request-bea')).toBeNull());
});

it('a moderator can remove or ban a member below her rank, never an admin', async () => {
  const view = render(<MembersScreen />);
  await view.findByTestId('member-sam');
  await waitFor(() => expect(view.getByLabelText('Remove Sam from the community')).toBeTruthy());
  expect(view.getByLabelText('Ban Sam')).toBeTruthy();
  expect(view.queryByLabelText('Remove Ana from the community')).toBeNull();
  expect(view.queryByLabelText('Remove Me from the community')).toBeNull();
});

it('ban asks first and calls remove_community_member with ban', async () => {
  const view = render(<MembersScreen />);
  await waitFor(() => expect(view.getByLabelText('Ban Sam')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByLabelText('Ban Sam')); });
  await waitFor(() => expect(membership.removeCommunityMember).toHaveBeenCalledWith('com1', 'sam', { ban: true }));
  expect(confirmAction).toHaveBeenCalledWith('Ban Sam?', expect.any(String), 'Ban');
  await waitFor(() => expect(view.queryByTestId('member-sam')).toBeNull());
});

it('a plain member sees no queue and no moderation buttons', async () => {
  mockRoles.value = new Map([['ana', 'admin']]);
  const view = render(<MembersScreen />);
  await view.findByTestId('member-sam');
  expect(view.queryByTestId('join-request-bea')).toBeNull();
  expect(view.queryByLabelText('Ban Sam')).toBeNull();
  expect(membership.fetchJoinRequests).not.toHaveBeenCalled();
  expect(membership.fetchCommunityBans).not.toHaveBeenCalled();
  expect(view.queryByTestId('community-bans')).toBeNull();
});

it('a moderator sees who is banned and why, and can lift a ban after confirming', async () => {
  const view = render(<MembersScreen />);
  expect(await view.findByTestId('banned-kim')).toBeTruthy();
  expect(view.getByText('Banned · 1')).toBeTruthy();
  expect(view.getByText('spam')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText('Lift the ban on Kim')); });
  expect(confirmAction).toHaveBeenCalledWith('Lift the ban on Kim?', expect.any(String), 'Lift ban');
  await waitFor(() => expect(membership.unbanCommunityMember).toHaveBeenCalledWith('com1', 'kim'));
  await waitFor(() => expect(view.queryByTestId('banned-kim')).toBeNull());
});

it('changing her mind about lifting a ban changes nothing', async () => {
  confirmAction.mockResolvedValueOnce(false);
  const view = render(<MembersScreen />);
  await view.findByTestId('banned-kim');
  await act(async () => { fireEvent.press(view.getByLabelText('Lift the ban on Kim')); });
  expect(membership.unbanCommunityMember).not.toHaveBeenCalled();
  expect(view.getByTestId('banned-kim')).toBeTruthy();
});

it('banning someone puts her in the Banned list at once', async () => {
  membership.fetchCommunityBans.mockResolvedValueOnce([]);
  const view = render(<MembersScreen />);
  await waitFor(() => expect(view.getByLabelText('Ban Sam')).toBeTruthy());
  expect(view.queryByTestId('banned-sam')).toBeNull();
  await act(async () => { fireEvent.press(view.getByLabelText('Ban Sam')); });
  expect(await view.findByTestId('banned-sam')).toBeTruthy();
});
