import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import CommunityChannelsScreen from '../../app/(tabs)/discover/community/channels/[communityId]';
// eslint-disable-next-line import/first
import { clearChannelCache } from '../../components/channels/channelCache';
import type { ChannelMessage } from '../../lib/channels';

/**
 * CHAT-09 in the channel: a moderator can remove or ban the sender of a
 * message — but only someone below her rank (the server refuses the rest, so
 * the menu never offers it). Both ask first.
 */
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ communityId: 'com1' }),
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), hashUserId: (s: string) => s }));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn(), confirmAction: jest.fn().mockResolvedValue(true) }));
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: object) => unknown) => {
    const state = { user: { id: 'me' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../hooks/useAccess', () => ({ useAccess: () => ({ canCommunity: () => true }) }));
jest.mock('../../store/safetyStore', () => ({
  useSafetyStore: (sel?: (s: object) => unknown) => {
    const state = { blockedUserIds: [], mutedUserIds: [], blockUser: jest.fn(), openReportModal: jest.fn() };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: 'Queer Gamers', slug: 'qg' } }) }) }),
    }),
    channel: () => { const ch: any = { on: () => ch, subscribe: () => ch }; return ch; },
    removeChannel: jest.fn(),
    rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

const msg = (id: string, sender: string, name: string): ChannelMessage => ({
  id, channel_id: 'c-general', sender_id: sender, body: `${name} says hi`, created_at: '2026-10-11T10:00:00Z',
  edited_at: null, deleted_at: null,
  author: { id: sender, username: name.toLowerCase(), display_name: name, avatar_url: null },
});

const mockIsMod = { value: true };
jest.mock('../../lib/channels', () => {
  const actual = jest.requireActual('../../lib/channels');
  return {
    ...actual,
    fetchChannels: jest.fn(() => Promise.resolve([
      { id: 'c-general', community_id: 'com1', slug: 'general', topic: null, position: 0, is_default: true },
    ])),
    fetchMyChannelRole: jest.fn(() => Promise.resolve({ isModerator: mockIsMod.value })),
    fetchLiveStage: jest.fn(() => Promise.resolve(null)),
    fetchChannelMessages: jest.fn(() => Promise.resolve([msg('m1', 'sam', 'Sam'), msg('m2', 'ana', 'Ana')])),
    fetchChannelMessage: jest.fn(() => Promise.resolve(null)),
    markChannelRead: jest.fn(() => Promise.resolve()),
    setChannelNotifications: jest.fn(() => Promise.resolve()),
    fetchChannelNotifications: jest.fn(() => Promise.resolve(false)),
  };
});
jest.mock('../../lib/communityMembership', () => ({
  ...jest.requireActual('../../lib/communityMembership'),
  fetchElevatedRoles: jest.fn(() => Promise.resolve(new Map([['me', 'moderator'], ['ana', 'admin']]))),
  removeCommunityMember: jest.fn(() => Promise.resolve()),
}));

const membership = jest.requireMock('../../lib/communityMembership');
const { confirmAction, showAlert } = jest.requireMock('../../lib/confirm');

beforeEach(() => {
  clearChannelCache();
  jest.clearAllMocks();
  mockIsMod.value = true;
});

async function openMenuFor(view: ReturnType<typeof render>, id: string) {
  await view.findByTestId(`channel-message-${id}`);
  await waitFor(() => expect(membership.fetchElevatedRoles).toHaveBeenCalled());
  await act(async () => { fireEvent(view.getByTestId(`channel-message-${id}`), 'longPress'); });
}

it('a moderator can remove or ban a member from the message menu', async () => {
  const view = render(<CommunityChannelsScreen />);
  await openMenuFor(view, 'm1');
  expect(view.getByTestId('channel-actions-remove-member')).toBeTruthy();
  expect(view.getByTestId('channel-actions-ban-member')).toBeTruthy();
});

it('never offers to remove someone at or above her rank', async () => {
  const view = render(<CommunityChannelsScreen />);
  await openMenuFor(view, 'm2'); // Ana is an admin; she is a moderator
  expect(view.queryByTestId('channel-actions-remove-member')).toBeNull();
  expect(view.queryByTestId('channel-actions-ban-member')).toBeNull();
});

it('a plain member gets neither', async () => {
  mockIsMod.value = false;
  const view = render(<CommunityChannelsScreen />);
  await view.findByTestId('channel-message-m1');
  await act(async () => { fireEvent(view.getByTestId('channel-message-m1'), 'longPress'); });
  expect(view.queryByTestId('channel-actions-remove-member')).toBeNull();
  expect(membership.fetchElevatedRoles).not.toHaveBeenCalled();
});

it('ban asks first, then calls remove_community_member with ban', async () => {
  const view = render(<CommunityChannelsScreen />);
  await openMenuFor(view, 'm1');
  await act(async () => { fireEvent.press(view.getByTestId('channel-actions-ban-member')); });
  await waitFor(() => expect(membership.removeCommunityMember).toHaveBeenCalledWith('com1', 'sam', { ban: true }));
  expect(confirmAction).toHaveBeenCalledWith('Ban Sam?', expect.stringMatching(/can't rejoin/), 'Ban');
  expect(showAlert).toHaveBeenCalledWith('Done', 'Sam is banned from this community.');
});

it('remove asks first; saying no removes nobody', async () => {
  confirmAction.mockResolvedValueOnce(false);
  const view = render(<CommunityChannelsScreen />);
  await openMenuFor(view, 'm1');
  await act(async () => { fireEvent.press(view.getByTestId('channel-actions-remove-member')); });
  await waitFor(() => expect(confirmAction).toHaveBeenCalled());
  expect(membership.removeCommunityMember).not.toHaveBeenCalled();
});
