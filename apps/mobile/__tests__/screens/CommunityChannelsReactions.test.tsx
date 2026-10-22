import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import CommunityChannelsScreen from '../../app/(tabs)/discover/community/channels/[communityId]';
// eslint-disable-next-line import/first
import { clearChannelCache } from '../../components/channels/channelCache';
import type { ChannelMessage } from '../../lib/channels';

/**
 * CHAT-17: reactions and typing in community channels.
 *
 * DMs and groups had both; a community channel had neither, so the busiest
 * rooms in the app were the least alive. Both now ride the same hooks as chat,
 * on the channel's own private topics (chan:<id>:reactions / :typing).
 */
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ communityId: 'com1' }),
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('rn-emoji-keyboard', () => 'EmojiKeyboard');
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), hashUserId: (s: string) => s }));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn(), confirmAction: jest.fn() }));
jest.mock('../../lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: object) => unknown) => {
    const state = { user: { id: 'me' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../store/profileStore', () => ({
  useProfileStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'me', display_name: 'Jo', username: 'jo' } }),
}));
jest.mock('../../hooks/useAccess', () => ({ useAccess: () => ({ canCommunity: () => true }) }));
jest.mock('../../store/safetyStore', () => {
  const state = { blockedUserIds: [], mutedUserIds: [], blockUser: jest.fn(), openReportModal: jest.fn() };
  return { useSafetyStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) };
});

const mockAdd = jest.fn();
const mockRemove = jest.fn();
const mockReactionsArgs: unknown[] = [];
let mockReactionsMap: Record<string, { id: string; message_id: string; user_id: string; emoji: string; created_at: string }[]> = {};
jest.mock('../../hooks/useReactions', () => ({
  useReactions: (opts: unknown) => {
    mockReactionsArgs.push(opts);
    return { reactionsMap: mockReactionsMap, addReaction: mockAdd, removeReaction: mockRemove };
  },
}));
const mockSendTyping = jest.fn();
const mockStopTyping = jest.fn();
const mockTypingArgs: unknown[] = [];
let mockTypingNames: string[] = [];
jest.mock('../../hooks/useTyping', () => ({
  useTyping: (opts: unknown) => {
    mockTypingArgs.push(opts);
    return { partnerIsTyping: mockTypingNames.length > 0, typingNames: mockTypingNames, sendTyping: mockSendTyping, stopTyping: mockStopTyping };
  },
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

const msg = (id: string, sender: string, extra: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id, channel_id: 'c-general', sender_id: sender, body: `body ${id}`,
  created_at: '2026-10-11T10:00:00Z', edited_at: null, deleted_at: null,
  author: { id: sender, username: sender, display_name: sender === 'sam' ? 'Sam' : 'Jo', avatar_url: null },
  ...extra,
});

const mockSend = jest.fn();
jest.mock('../../lib/channels', () => {
  const actual = jest.requireActual('../../lib/channels');
  return {
    ...actual,
    fetchChannels: jest.fn(() => Promise.resolve([
      { id: 'c-general', community_id: 'com1', slug: 'general', topic: null, position: 0, is_default: true },
    ])),
    fetchMyChannelRole: jest.fn(() => Promise.resolve({ isModerator: false })),
    fetchLiveStage: jest.fn(() => Promise.resolve(null)),
    fetchChannelMessages: jest.fn(() => Promise.resolve([
      msg('m1', 'sam'),
      msg('m2', 'me'),
      msg('m3', 'sam', { deleted_at: '2026-10-11T10:05:00Z', body: '' }),
    ])),
    fetchOlderChannelMessages: jest.fn(() => Promise.resolve([])),
    fetchChannelMessage: jest.fn(),
    sendChannelMessage: (...a: unknown[]) => mockSend(...a),
    markChannelRead: jest.fn(() => Promise.resolve()),
    setChannelNotifications: jest.fn(() => Promise.resolve()),
    fetchChannelNotifications: jest.fn(() => Promise.resolve(false)),
  };
});

beforeEach(() => {
  clearChannelCache();
  jest.clearAllMocks();
  mockReactionsArgs.length = 0;
  mockTypingArgs.length = 0;
  mockReactionsMap = {};
  mockTypingNames = [];
});

describe('CHAT-17 channel reactions', () => {
  it('loads reactions for the open channel on its own private topic', async () => {
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m1');
    const last = mockReactionsArgs[mockReactionsArgs.length - 1] as { conversationId: string; scope: string; messageIds: string[] };
    expect(last.scope).toBe('channel');
    expect(last.conversationId).toBe('c-general');
    expect(last.messageIds).toEqual(['m1', 'm2', 'm3']);
  });

  it('shows reaction chips under a message; her own chip takes hers back, another adds hers', async () => {
    mockReactionsMap = {
      m1: [
        { id: 'r1', message_id: 'm1', user_id: 'sam', emoji: '🔥', created_at: '' },
        { id: 'r2', message_id: 'm1', user_id: 'me', emoji: '💜', created_at: '' },
      ],
    };
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m1');
    fireEvent.press(view.getByLabelText('Remove your 💜 reaction'));
    expect(mockRemove).toHaveBeenCalledWith('m1', '💜', 'me');
    fireEvent.press(view.getByLabelText('React with 🔥, 1 so far'));
    expect(mockAdd).toHaveBeenCalledWith('m1', '🔥', 'me');
  });

  it('the long-press menu reacts in one tap', async () => {
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m1');
    fireEvent(view.getByTestId('channel-message-m1'), 'longPress');
    await act(async () => { fireEvent.press(view.getByLabelText('React with 💜')); });
    expect(mockAdd).toHaveBeenCalledWith('m1', '💜', 'me');
  });

  it('haptic map (§3.3): long-press menu = one selection tick, a committed reaction = one light tap', async () => {
    const { haptic } = jest.requireMock('../../lib/haptics') as { haptic: jest.Mock };
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m1');
    haptic.mockClear();
    fireEvent(view.getByTestId('channel-message-m1'), 'longPress');
    expect(haptic.mock.calls).toEqual([['select']]);
    haptic.mockClear();
    await act(async () => { fireEvent.press(view.getByLabelText('React with 💜')); });
    expect(haptic.mock.calls).toEqual([['light']]);
  });

  it('a removed message offers no reactions', async () => {
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m3');
    fireEvent(view.getByTestId('channel-message-m3'), 'longPress');
    expect(view.queryByLabelText('React with 💜')).toBeNull();
  });
});

describe('CHAT-17 channel typing', () => {
  it('joins the channel typing room with her own name', async () => {
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m1');
    const last = mockTypingArgs[mockTypingArgs.length - 1] as { conversationId: string; scope: string; currentUserId: string; selfName: string };
    expect(last).toEqual(expect.objectContaining({ conversationId: 'c-general', scope: 'channel', currentUserId: 'me', selfName: 'Jo' }));
  });

  it('typing says so, sending says she stopped', async () => {
    mockSend.mockResolvedValue(msg('m9', 'me', { body: 'hi' }));
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m1');
    fireEvent.changeText(view.getByTestId('channel-composer-input'), 'hi');
    expect(mockSendTyping).toHaveBeenCalled();
    await act(async () => { fireEvent.press(view.getByTestId('channel-composer-send')); });
    expect(mockStopTyping).toHaveBeenCalled();
  });

  it('shows who is typing in the channel', async () => {
    mockTypingNames = ['Sam', 'Ana'];
    const view = render(<CommunityChannelsScreen />);
    await view.findByTestId('channel-message-m1');
    expect(view.getByText('Sam and Ana are typing')).toBeTruthy();
  });
});
