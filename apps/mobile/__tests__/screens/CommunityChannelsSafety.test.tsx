import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import CommunityChannelsScreen from '../../app/(tabs)/discover/community/channels/[communityId]';
// eslint-disable-next-line import/first
import { clearChannelCache } from '../../components/channels/channelCache';
import type { ChannelMessage } from '../../lib/channels';

/**
 * Channel safety + live updates.
 *
 * CHAT-10: after she blocks someone from the message menu, that woman's
 * messages leave the list at once (no refetch, no app restart), and she is
 * told so. Muted senders stay out of her channel view too.
 * CHAT-16: an incoming message is fetched by id and appended — the page is
 * not re-read for every message anyone posts.
 */
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ communityId: 'com1' }),
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), hashUserId: (s: string) => s }));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn(), confirmAction: jest.fn() }));
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: object) => unknown) => {
    const state = { user: { id: 'me' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../hooks/useAccess', () => ({ useAccess: () => ({ canCommunity: () => true }) }));

// A real zustand-shaped store so a block re-renders the screen like the app does.
// (Factory touches these only at call time: jest.mock is hoisted above them.)
const mockSafety = { blockedUserIds: [] as string[], mutedUserIds: [] as string[], version: 0 };
const mockListeners = new Set<() => void>();
const mockNotify = () => { mockSafety.version += 1; mockListeners.forEach((l) => l()); };
const mockBlockUser = jest.fn(async (id: string) => {
  mockSafety.blockedUserIds = [...mockSafety.blockedUserIds, id];
  mockNotify();
});
jest.mock('../../store/safetyStore', () => {
  const { useSyncExternalStore } = require('react');
  let snap: unknown = null;
  let seen = -1;
  const getSnap = () => {
    if (seen !== mockSafety.version) {
      seen = mockSafety.version;
      snap = {
        blockedUserIds: mockSafety.blockedUserIds,
        mutedUserIds: mockSafety.mutedUserIds,
        blockUser: mockBlockUser,
        openReportModal: jest.fn(),
      };
    }
    return snap;
  };
  const subscribe = (l: () => void) => { mockListeners.add(l); return () => mockListeners.delete(l); };
  return {
    useSafetyStore: (sel?: (s: unknown) => unknown) => {
      const s = useSyncExternalStore(subscribe, getSnap);
      return sel ? sel(s) : s;
    },
  };
});

const mockHandlers: Record<string, (p: { new: { id: string } }) => void> = {};
const mockChannelObj: any = {
  on: jest.fn((_t: string, f: { event: string }, cb: (p: { new: { id: string } }) => void) => {
    mockHandlers[f.event] = cb;
    return mockChannelObj;
  }),
  subscribe: jest.fn(() => mockChannelObj),
};
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: 'Queer Gamers', slug: 'qg' } }) }) }),
    }),
    channel: jest.fn(() => mockChannelObj),
    removeChannel: jest.fn(),
    rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

const msg = (id: string, sender: string, name: string, body: string, at: string): ChannelMessage => ({
  id, channel_id: 'c-general', sender_id: sender, body, created_at: at, edited_at: null, deleted_at: null,
  author: { id: sender, username: name.toLowerCase(), display_name: name, avatar_url: null },
});

const mockFetchMessages = jest.fn();
const mockFetchOne = jest.fn();
jest.mock('../../lib/channels', () => {
  const actual = jest.requireActual('../../lib/channels');
  return {
    ...actual,
    fetchChannels: jest.fn(() => Promise.resolve([
      { id: 'c-general', community_id: 'com1', slug: 'general', topic: null, position: 0, is_default: true },
    ])),
    fetchMyChannelRole: jest.fn(() => Promise.resolve({ isModerator: false })),
    fetchLiveStage: jest.fn(() => Promise.resolve(null)),
    fetchChannelMessages: (...a: unknown[]) => mockFetchMessages(...a),
    fetchChannelMessage: (...a: unknown[]) => mockFetchOne(...a),
    markChannelRead: jest.fn(() => Promise.resolve()),
    setChannelNotifications: jest.fn(() => Promise.resolve()),
    fetchChannelNotifications: jest.fn(() => Promise.resolve(false)),
  };
});

const { showAlert } = jest.requireMock('../../lib/confirm');

beforeEach(() => {
  clearChannelCache();
  jest.clearAllMocks();
  // clearAllMocks keeps queued *Once values; a test that fails early must not
  // hand its leftovers to the next one.
  mockFetchOne.mockReset();
  mockFetchMessages.mockReset();
  mockSafety.blockedUserIds = [];
  mockSafety.mutedUserIds = [];
  mockNotify();
  mockFetchMessages.mockResolvedValue([
    msg('m1', 'sam', 'Sam', 'hey all', '2026-10-11T10:00:00Z'),
    msg('m2', 'ana', 'Ana', 'hi Sam', '2026-10-11T10:01:00Z'),
  ]);
});

describe('CHAT-10 block and mute in channels', () => {
  it('blocking from the menu removes her messages at once and says so', async () => {
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m1');
    fireEvent(view.getByTestId('channel-message-m1'), 'longPress');
    await act(async () => { fireEvent.press(await view.findByText('Block Sam')); });
    await waitFor(() => expect(view.queryByTestId('channel-message-m1')).toBeNull());
    expect(view.getByTestId('channel-message-m2')).toBeTruthy();
    expect(mockBlockUser).toHaveBeenCalledWith('sam');
    expect(showAlert).toHaveBeenCalledWith('Blocked', "You won't see Sam's messages here any more.");
    // No refetch was needed to hide her.
    expect(mockFetchMessages).toHaveBeenCalledTimes(1);
  });

  it('someone she muted is not shown in her channel view', async () => {
    mockSafety.mutedUserIds = ['sam'];
    mockNotify();
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m2');
    expect(view.queryByTestId('channel-message-m1')).toBeNull();
  });

  it('a block that fails says so instead of pretending', async () => {
    mockBlockUser.mockRejectedValueOnce(new Error('offline'));
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m1');
    fireEvent(view.getByTestId('channel-message-m1'), 'longPress');
    await act(async () => { fireEvent.press(await view.findByText('Block Sam')); });
    await waitFor(() => expect(showAlert).toHaveBeenCalledWith('Not blocked', expect.any(String)));
    expect(view.getByTestId('channel-message-m1')).toBeTruthy();
  });
});

describe('CHAT-16 live channel', () => {
  it('appends an incoming message by id instead of re-reading the page', async () => {
    mockFetchOne.mockResolvedValueOnce(msg('m3', 'bea', 'Bea', 'new one', '2026-10-11T10:02:00Z'));
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m2');
    await act(async () => { mockHandlers.INSERT({ new: { id: 'm3' } }); });
    await view.findByTestId('channel-message-m3');
    expect(mockFetchOne).toHaveBeenCalledWith('m3');
    expect(mockFetchMessages).toHaveBeenCalledTimes(1);
  });

  it('an incoming message from someone she blocked never appears', async () => {
    mockSafety.blockedUserIds = ['bea'];
    mockNotify();
    mockFetchOne.mockResolvedValueOnce(msg('m3', 'bea', 'Bea', 'sneaky', '2026-10-11T10:02:00Z'));
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m2');
    await act(async () => { mockHandlers.INSERT({ new: { id: 'm3' } }); });
    await waitFor(() => expect(mockFetchOne).toHaveBeenCalled());
    expect(view.queryByTestId('channel-message-m3')).toBeNull();
  });

  it('a moderator removal arrives as an update and is shown in place', async () => {
    mockFetchOne.mockResolvedValueOnce({ ...msg('m2', 'ana', 'Ana', 'hi Sam', '2026-10-11T10:01:00Z'), deleted_at: '2026-10-11T10:05:00Z' });
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m2');
    await act(async () => { mockHandlers.UPDATE({ new: { id: 'm2' } }); });
    await view.findByTestId('channel-message-m2-removed');
    expect(mockFetchMessages).toHaveBeenCalledTimes(1);
  });
});
