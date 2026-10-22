/**
 * CHAT-09: a moderator's invite to a private community waits in Requests →
 * Friends, beside friend requests — named, with Join / Not now. Saying no is
 * quiet: whoever invited her is not told.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/confirm', () => ({ confirmAction: jest.fn().mockResolvedValue(true), showAlert: jest.fn() }));
jest.mock('../../../store/friendStore', () => ({
  useFriendStore: (sel: (s: any) => unknown) => sel({ pendingReceived: [], acceptRequest: jest.fn(), rejectRequest: jest.fn() }),
}));
jest.mock('../../../store/connectStore', () => ({
  useConnectStore: (sel: (s: any) => unknown) => sel({ requests: [], refresh: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('../../../store/safetyStore', () => ({
  useSafetyStore: (sel: (s: any) => unknown) => sel({ blockUser: jest.fn(), openReportModal: jest.fn() }),
}));
const mockFetchJoined = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../store/communityStore', () => ({
  useCommunityStore: (sel: (s: any) => unknown) => sel({ fetchJoined: mockFetchJoined }),
}));
jest.mock('../../../store/authStore', () => ({
  useAuthStore: (sel?: (s: object) => unknown) => {
    const state = { user: { id: 'me' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../../lib/communityMembership', () => ({
  ...jest.requireActual('../../../lib/communityMembership'),
  fetchMyCommunityInvites: jest.fn(),
  respondCommunityInvite: jest.fn().mockResolvedValue(undefined),
}));

import { RequestsSheet } from '../../../components/messages/RequestsSheet';

const membership = jest.requireMock('../../../lib/communityMembership');

beforeEach(() => {
  jest.clearAllMocks();
  membership.fetchMyCommunityInvites.mockResolvedValue([
    { community_id: 'c9', created_at: '2026-10-11T09:00:00Z', community: { id: 'c9', name: 'Quiet Room' } },
  ]);
});

it('opens on Friends and shows the invite with the community name', async () => {
  const view = render(<RequestsSheet visible onClose={jest.fn()} />);
  expect(await view.findByTestId('community-invite-c9')).toBeTruthy();
  expect(view.getByText('Quiet Room')).toBeTruthy();
  expect(view.getByLabelText('Friends, 1 waiting')).toBeTruthy();
});

it('Join accepts through respond_community_invite and refreshes her communities', async () => {
  const view = render(<RequestsSheet visible onClose={jest.fn()} />);
  await view.findByTestId('community-invite-c9');
  await act(async () => { fireEvent.press(view.getByLabelText('Join Quiet Room')); });
  await waitFor(() => expect(membership.respondCommunityInvite).toHaveBeenCalledWith('c9', true));
  expect(mockFetchJoined).toHaveBeenCalledWith('me');
  await waitFor(() => expect(view.queryByTestId('community-invite-c9')).toBeNull());
});

it('Not now declines quietly', async () => {
  const view = render(<RequestsSheet visible onClose={jest.fn()} />);
  await view.findByTestId('community-invite-c9');
  await act(async () => { fireEvent.press(view.getByLabelText('Not now for Quiet Room. Nobody is told.')); });
  await waitFor(() => expect(membership.respondCommunityInvite).toHaveBeenCalledWith('c9', false));
});

it('a sheet that is not open fetches nothing', () => {
  render(<RequestsSheet visible={false} onClose={jest.fn()} />);
  expect(membership.fetchMyCommunityInvites).not.toHaveBeenCalled();
});
