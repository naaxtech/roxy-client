import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import CommunityChannelsScreen from '../../app/(tabs)/discover/community/channels/[communityId]';
import type { ChannelMessage } from '../../lib/channels';

/**
 * CHAT-16: channel history past the newest 50.
 *
 * A channel used to stop at its newest page, so anything older was simply
 * unreachable. Reaching the top (or tapping "Earlier messages") now loads the
 * page before the oldest loaded row and puts it ABOVE what she is reading.
 */
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ communityId: 'com1' }),
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), hashUserId: (s: string) => s }));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn(), confirmAction: jest.fn() }));
jest.mock('../../lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../store/authStore', () => ({ useAuthStore: () => ({ user: { id: 'me' } }) }));
jest.mock('../../hooks/useAccess', () => ({ useAccess: () => ({ canCommunity: () => true }) }));
jest.mock('../../store/safetyStore', () => {
  const state = { blockedUserIds: [], mutedUserIds: [], blockUser: jest.fn(), openReportModal: jest.fn() };
  return { useSafetyStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) };
});
jest.mock('../../hooks/useReactions', () => ({
  useReactions: () => ({ reactionsMap: {}, addReaction: jest.fn(), removeReaction: jest.fn() }),
}));
jest.mock('../../hooks/useTyping', () => ({
  useTyping: () => ({ partnerIsTyping: false, typingNames: [], sendTyping: jest.fn(), stopTyping: jest.fn() }),
}));

const mockChannelObj: { on: jest.Mock; subscribe: jest.Mock } = {
  on: jest.fn(() => mockChannelObj),
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

const T0 = Date.parse('2026-10-11T10:00:00Z');
const msg = (id: string, minute: number): ChannelMessage => ({
  id, channel_id: 'c-general', sender_id: 'sam', body: `body ${id}`,
  created_at: new Date(T0 + minute * 60_000).toISOString(), edited_at: null, deleted_at: null,
  author: { id: 'sam', username: 'sam', display_name: 'Sam', avatar_url: null },
});
/** A full newest page: minutes 100..149. */
const fullPage = () => Array.from({ length: 50 }, (_, i) => msg(`n${i}`, 100 + i));

const mockFetchMessages = jest.fn();
const mockFetchOlder = jest.fn();
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
    fetchOlderChannelMessages: (...a: unknown[]) => mockFetchOlder(...a),
    fetchChannelMessage: jest.fn(),
    markChannelRead: jest.fn(() => Promise.resolve()),
    setChannelNotifications: jest.fn(() => Promise.resolve()),
    fetchChannelNotifications: jest.fn(() => Promise.resolve(false)),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchMessages.mockReset();
  mockFetchOlder.mockReset();
});

describe('CHAT-16 channel history', () => {
  it('a full first page offers earlier messages; tapping loads the page before the oldest row, above it', async () => {
    mockFetchMessages.mockResolvedValue(fullPage());
    mockFetchOlder.mockResolvedValueOnce([msg('o1', 10), msg('o2', 11)]);
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-n0');
    await act(async () => { fireEvent.press(view.getByTestId('channel-load-older')); });
    await view.findByTestId('channel-message-o1');
    expect(mockFetchOlder).toHaveBeenCalledWith('c-general', msg('n0', 100).created_at);
    const list = view.getByTestId('channel-messages');
    const ids = (list.props.data as ChannelMessage[]).map((m) => m.id);
    expect(ids.slice(0, 3)).toEqual(['o1', 'o2', 'n0']);
    // A short page means the beginning of the channel: no more button.
    await waitFor(() => expect(view.queryByTestId('channel-load-older')).toBeNull());
    expect(view.getByText('Start of # general')).toBeTruthy();
  });

  it('reaching the top of the list loads the earlier page by itself', async () => {
    mockFetchMessages.mockResolvedValue(fullPage());
    mockFetchOlder.mockResolvedValueOnce([msg('o1', 10)]);
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-n0');
    await act(async () => {
      fireEvent.scroll(view.getByTestId('channel-messages'), {
        nativeEvent: { contentOffset: { y: 0 }, layoutMeasurement: { height: 600 }, contentSize: { height: 5000 } },
      });
    });
    await waitFor(() => expect(mockFetchOlder).toHaveBeenCalledTimes(1));
  });

  it('a short channel never asks for older messages', async () => {
    mockFetchMessages.mockResolvedValue([msg('n0', 100), msg('n1', 101)]);
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-n0');
    expect(view.queryByTestId('channel-load-older')).toBeNull();
    fireEvent.scroll(view.getByTestId('channel-messages'), {
      nativeEvent: { contentOffset: { y: 0 }, layoutMeasurement: { height: 600 }, contentSize: { height: 700 } },
    });
    expect(mockFetchOlder).not.toHaveBeenCalled();
  });

  it('an earlier page that fails says so and can be tried again', async () => {
    mockFetchMessages.mockResolvedValue(fullPage());
    mockFetchOlder.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([msg('o1', 10)]);
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-n0');
    await act(async () => { fireEvent.press(view.getByTestId('channel-load-older')); });
    await view.findByText("Couldn't load earlier messages. Tap to try again.");
    // What she was reading is still there.
    expect(view.getByTestId('channel-message-n0')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByTestId('channel-load-older')); });
    await view.findByTestId('channel-message-o1');
  });
});
