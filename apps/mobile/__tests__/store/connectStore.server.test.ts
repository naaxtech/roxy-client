/**
 * CHAT-13: unread had three owners (a tab-layout listener that incremented,
 * the inbox's own count, the chat screen's clear) and they drifted. One owner
 * now: the server. `refresh()` replaces the inbox and the badge from
 * inbox_summary() + messages_badge(); nothing on the phone increments.
 */
jest.mock('../../lib/chat', () => {
  const actual = jest.requireActual('../../lib/chat');
  return {
    ...actual,
    fetchInbox: jest.fn(),
    fetchMessagesBadge: jest.fn(),
    markConversationRead: jest.fn(),
  };
});
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { act } from '@testing-library/react-native';
import { useConnectStore } from '../../store/connectStore';
import type { InboxThread } from '../../lib/chat';

const chat = jest.requireMock('../../lib/chat');

const thread = (id: string, o: Partial<InboxThread> = {}): InboxThread => ({
  conversation_id: id,
  conversation_type: 'direct',
  title: null,
  avatar_emoji: null,
  my_status: 'active',
  my_role: 'member',
  muted_until: null,
  hidden_at: null,
  last_message_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  created_by: null,
  last_message: null,
  unread: 0,
  member_count: 2,
  members: [],
  ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  useConnectStore.getState().reset();
});

describe('connectStore — the server owns unread (CHAT-13)', () => {
  it('refresh replaces inbox and badge from the server', async () => {
    chat.fetchInbox.mockResolvedValue([thread('a', { unread: 2 }), thread('r', { my_status: 'request' })]);
    chat.fetchMessagesBadge.mockResolvedValue({ chats: 2, message_requests: 1, friend_requests: 3, communities: 4 });
    await act(async () => { await useConnectStore.getState().refresh(); });
    const s = useConnectStore.getState();
    expect(s.threads.map((t) => t.conversation_id)).toEqual(['a']);
    expect(s.requests.map((t) => t.conversation_id)).toEqual(['r']);
    expect(s.badge).toEqual({ chats: 2, message_requests: 1, friend_requests: 3, communities: 4 });
    expect(s.badgeTotal).toBe(10);
  });

  it('refresh SETS — calling it twice never doubles a count', async () => {
    chat.fetchInbox.mockResolvedValue([thread('a', { unread: 2 })]);
    chat.fetchMessagesBadge.mockResolvedValue({ chats: 2, message_requests: 0, friend_requests: 0, communities: 0 });
    await act(async () => { await useConnectStore.getState().refresh(); });
    await act(async () => { await useConnectStore.getState().refresh(); });
    expect(useConnectStore.getState().badgeTotal).toBe(2);
    expect(useConnectStore.getState().unreadCounts).toEqual({ a: 2 });
  });

  it('a failed refresh keeps the last good numbers and says so', async () => {
    chat.fetchInbox.mockResolvedValue([thread('a', { unread: 1 })]);
    chat.fetchMessagesBadge.mockResolvedValue({ chats: 1, message_requests: 0, friend_requests: 0, communities: 0 });
    await act(async () => { await useConnectStore.getState().refresh(); });
    chat.fetchInbox.mockRejectedValue(new Error('offline'));
    await act(async () => { await useConnectStore.getState().refresh(); });
    const s = useConnectStore.getState();
    expect(s.badgeTotal).toBe(1);
    expect(s.error).toBe(true);
  });

  it('a muted thread keeps its own count but does not hold up the badge', async () => {
    chat.fetchInbox.mockResolvedValue([thread('m', { unread: 5, muted_until: '2999-01-01T00:00:00Z' })]);
    chat.fetchMessagesBadge.mockResolvedValue({ chats: 0, message_requests: 0, friend_requests: 0, communities: 0 });
    await act(async () => { await useConnectStore.getState().refresh(); });
    expect(useConnectStore.getState().unreadCounts.m).toBe(5);
    expect(useConnectStore.getState().badgeTotal).toBe(0);
  });

  it('markRead zeroes the thread at once, asks the server, then refreshes', async () => {
    chat.fetchInbox.mockResolvedValue([thread('a', { unread: 3 })]);
    chat.fetchMessagesBadge.mockResolvedValue({ chats: 3, message_requests: 0, friend_requests: 0, communities: 0 });
    await act(async () => { await useConnectStore.getState().refresh(); });

    chat.markConversationRead.mockResolvedValue(3);
    chat.fetchInbox.mockResolvedValue([thread('a', { unread: 0 })]);
    chat.fetchMessagesBadge.mockResolvedValue({ chats: 0, message_requests: 0, friend_requests: 0, communities: 0 });
    await act(async () => { await useConnectStore.getState().markRead('a'); });
    expect(chat.markConversationRead).toHaveBeenCalledWith('a');
    expect(useConnectStore.getState().unreadCounts.a).toBe(0);
    expect(useConnectStore.getState().badgeTotal).toBe(0);
  });

  it('clearUnread still exists for older callers and only zeroes the local row', () => {
    useConnectStore.setState({ unreadCounts: { a: 4 } });
    useConnectStore.getState().clearUnread('a');
    expect(useConnectStore.getState().unreadCounts.a).toBe(0);
  });
});
