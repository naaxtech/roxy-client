import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

/**
 * The DM / group thread screen (app/chat/[id].tsx) on the migration-132
 * building blocks.
 *
 *  - send: one client-minted id per message (CHAT-06) — a retry re-sends the
 *    SAME id, so a lost response can never become a second bubble;
 *  - the screen never writes `conversations` (CHAT-03: the trigger owns
 *    last_message_at, and the table grant is gone);
 *  - a message request she received is answered before she can type; one she
 *    sent stops at the cap (CHAT-02);
 *  - reports go through the ONE global ReportSheet with the message id
 *    (CHAT-11) — no second, local report modal;
 *  - scrolling up loads older pages, and a new message while she reads back
 *    shows a pill instead of yanking her down (CHAT-16);
 *  - mute is the conversation's (mute_conversation), not the person's.
 */

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'c1' }),
  useRouter: () => ({ back: mockBack, push: mockPush, replace: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('rn-emoji-keyboard', () => () => null);
jest.mock('../../components/chat/GifPicker', () => ({ GifPicker: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../lib/pushRegistration', () => ({ setActivePath: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ Analytics: { messageSent: jest.fn() } }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), logBreadcrumb: jest.fn() }));
jest.mock('../../lib/confirm', () => ({
  showAlert: jest.fn(),
  confirmAction: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../store/authStore', () => {
  const state = { user: { id: 'me' } };
  return { useAuthStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) };
});

const mockMarkRead = jest.fn(() => Promise.resolve());
const mockRefresh = jest.fn(() => Promise.resolve());
jest.mock('../../store/connectStore', () => {
  const state = {
    markRead: (...a: unknown[]) => (mockMarkRead as (...x: unknown[]) => unknown)(...a),
    refresh: (...a: unknown[]) => (mockRefresh as (...x: unknown[]) => unknown)(...a),
    setActiveConversation: jest.fn(),
  };
  return { useConnectStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) };
});

const mockOpenReport = jest.fn();
const mockBlock = jest.fn(() => Promise.resolve());
jest.mock('../../store/safetyStore', () => {
  const state = {
    openReportModal: (...a: unknown[]) => mockOpenReport(...a),
    blockUser: (...a: unknown[]) => (mockBlock as (...x: unknown[]) => unknown)(...a),
  };
  return { useSafetyStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) };
});
jest.mock('../../store/friendStore', () => ({ isOnline: () => false }));

const mockReload = jest.fn(() => Promise.resolve());
const mockThread: { meta: any; loading: boolean; unavailable: boolean } = {
  meta: null, loading: false, unavailable: false,
};
jest.mock('../../hooks/useThreadMeta', () => ({
  useThreadMeta: () => ({ ...mockThread, reload: mockReload }),
}));
jest.mock('../../hooks/useTyping', () => ({
  useTyping: () => ({ partnerIsTyping: false, typingNames: [], sendTyping: jest.fn(), stopTyping: jest.fn() }),
}));
const mockAddReaction = jest.fn(() => Promise.resolve());
jest.mock('../../hooks/useReactions', () => ({
  useReactions: () => ({
    reactionsMap: {},
    addReaction: (...a: unknown[]) => (mockAddReaction as (...x: unknown[]) => unknown)(...a),
    removeReaction: jest.fn(() => Promise.resolve()),
  }),
}));

// Realtime: capture this thread's INSERT handler so a test can play the echo.
const mockRealtime: { insert?: (p: { new: unknown }) => void } = {};
jest.mock('../../lib/realtimeChannel', () => {
  const channel: any = {
    on: (_e: string, f: { event: string }, cb: (p: { new: unknown }) => void) => {
      if (f.event === 'INSERT') mockRealtime.insert = cb;
      return channel;
    },
    subscribe: () => channel,
  };
  return { freshChannel: () => channel };
});

// Messages table: the newest page on mount, an older page when the query has
// an `lte` cursor. Every table touched is recorded.
const mockTablesTouched: string[] = [];
const mockPages: { newest: any[]; older: any[]; olderCursor: string | null } = { newest: [], older: [], olderCursor: null };
jest.mock('../../lib/supabase', () => {
  const query = (table: string) => {
    const state: { lte: string | null } = { lte: null };
    const q: any = {
      select: () => q, eq: () => q, order: () => q, limit: () => q, gt: () => q, in: () => q,
      lte: (_c: string, v: string) => { state.lte = v; mockPages.olderCursor = v; return q; },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      update: () => q,
      then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => Promise.resolve({
        data: table === 'messages' ? (state.lte ? mockPages.older : mockPages.newest) : [],
        error: null,
      }).then(res, rej),
    };
    return q;
  };
  return {
    supabase: {
      from: (table: string) => { mockTablesTouched.push(table); return query(table); },
      rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
      removeChannel: jest.fn(),
    },
    callEdgeFunction: jest.fn(() => Promise.resolve({ data: null, error: null })),
  };
});

const mockInsert = jest.fn();
const mockRespond = jest.fn(() => Promise.resolve('c1'));
const mockMute = jest.fn(() => Promise.resolve());
jest.mock('../../lib/chat', () => {
  const actual = jest.requireActual('../../lib/chat');
  return {
    ...actual,
    insertMessage: (...a: unknown[]) => mockInsert(...a),
    respondMessageRequest: (...a: unknown[]) => (mockRespond as (...x: unknown[]) => unknown)(...a),
    muteConversation: (...a: unknown[]) => (mockMute as (...x: unknown[]) => unknown)(...a),
    fetchChatSettings: () => Promise.resolve(actual.DEFAULT_CHAT_SETTINGS),
  };
});

import ChatScreen from '../../app/chat/[id]';
import { MUTE_FOREVER } from '../../lib/chatThread';

jest.setTimeout(20_000);

const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const row = (id: string, sender: string, content: string, minAgo: number, o: Record<string, unknown> = {}) => ({
  id, conversation_id: 'c1', sender_id: sender, content, media_url: null,
  message_type: 'text', is_read: false, created_at: iso(minAgo), ...o,
});
const member = (id: string, name: string, o: Record<string, unknown> = {}) => ({
  id, display_name: name, username: name.toLowerCase(), avatar_url: null, last_seen_at: null,
  role: 'member', status: 'active', joined_at: iso(10_000), muted_until: null, ...o,
});
const directMeta = (o: Record<string, unknown> = {}) => ({
  id: 'c1', type: 'direct', title: null, emoji: null, createdBy: 'me',
  me: member('me', 'Me'), others: [member('ana', 'Ana')], ...o,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  jest.clearAllMocks();
  mockTablesTouched.length = 0;
  mockThread.meta = directMeta();
  mockThread.loading = false;
  mockThread.unavailable = false;
  mockPages.newest = [row('m2', 'me', 'hi Ana', 5), row('m1', 'ana', 'hey you', 6)];
  mockPages.older = [];
  mockPages.olderCursor = null;
  mockRealtime.insert = undefined;
  mockInsert.mockImplementation(async (m: { id: string }) => ({ data: { id: m.id }, error: null }));
});

async function openThread() {
  const view = render(<ChatScreen />);
  await view.findByText('hey you');
  return view;
}

describe('ChatScreen — sending (CHAT-06, CHAT-03)', () => {
  it('sends under a client-minted uuid and shows exactly one delivered bubble', async () => {
    const view = await openThread();
    fireEvent.changeText(view.getByTestId('chat-input'), 'hello world');
    fireEvent.press(view.getByTestId('chat-send'));

    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));
    const sent = mockInsert.mock.calls[0][0];
    expect(sent).toEqual(expect.objectContaining({
      conversationId: 'c1', senderId: 'me', content: 'hello world', type: 'text', replyToId: null,
    }));
    expect(sent.id).toMatch(UUID);
    await waitFor(() => expect(view.getAllByText('hello world')).toHaveLength(1));
    expect(view.queryByTestId('message-retry')).toBeNull();
  });

  it('a failed send keeps one bubble with Retry; Retry re-sends the SAME id and never duplicates', async () => {
    mockInsert
      .mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'network down' } })
      .mockImplementation(async (m: { id: string }) => ({ data: { id: m.id }, error: null }));
    const view = await openThread();
    fireEvent.changeText(view.getByTestId('chat-input'), 'are you there?');
    fireEvent.press(view.getByTestId('chat-send'));

    const retry = await view.findByTestId('message-retry');
    expect(view.getAllByText('are you there?')).toHaveLength(1);
    fireEvent.press(retry);

    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(2));
    expect(mockInsert.mock.calls[1][0].id).toBe(mockInsert.mock.calls[0][0].id);
    await waitFor(() => expect(view.queryByTestId('message-retry')).toBeNull());
    expect(view.getAllByText('are you there?')).toHaveLength(1);
  });

  it("the realtime echo of her own message settles the bubble instead of adding a copy", async () => {
    const view = await openThread();
    let release: (v: unknown) => void = () => {};
    mockInsert.mockImplementationOnce((m: { id: string }) => new Promise((r) => { release = () => r({ data: { id: m.id }, error: null }); }));
    fireEvent.changeText(view.getByTestId('chat-input'), 'echo test');
    fireEvent.press(view.getByTestId('chat-send'));
    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));
    const id = mockInsert.mock.calls[0][0].id;
    act(() => { mockRealtime.insert?.({ new: row(id, 'me', 'echo test', 0) }); });
    await act(async () => { release(undefined); });
    expect(view.getAllByText('echo test')).toHaveLength(1);
  });

  it('never writes the conversations table (CHAT-03)', async () => {
    const view = await openThread();
    fireEvent.changeText(view.getByTestId('chat-input'), 'no side writes');
    fireEvent.press(view.getByTestId('chat-send'));
    await waitFor(() => expect(mockInsert).toHaveBeenCalled());
    await waitFor(() => expect(view.queryByText('no side writes')).toBeTruthy());
    expect(mockTablesTouched).not.toContain('conversations');
  });

  it('a refusal is shown in her words (e.g. the rate limit)', async () => {
    mockInsert.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'rate_limited: messages' } });
    const view = await openThread();
    fireEvent.changeText(view.getByTestId('chat-input'), 'too fast');
    fireEvent.press(view.getByTestId('chat-send'));
    expect(await view.findByText('Slow down a moment — you can send more in a minute.')).toBeTruthy();
  });
});

describe('ChatScreen — message requests (CHAT-02)', () => {
  it('a request she received: the gate replaces the composer; Accept answers the request', async () => {
    mockThread.meta = directMeta({ me: member('me', 'Me', { status: 'request' }) });
    const view = await openThread();
    expect(view.getByTestId('request-gate')).toBeTruthy();
    expect(view.queryByTestId('chat-input')).toBeNull();
    fireEvent.press(view.getByTestId('request-gate-accept'));
    await waitFor(() => expect(mockRespond).toHaveBeenCalledWith('c1', true));
    await waitFor(() => expect(mockReload).toHaveBeenCalled());
  });

  it('Delete declines quietly and leaves the thread', async () => {
    mockThread.meta = directMeta({ me: member('me', 'Me', { status: 'request' }) });
    const view = await openThread();
    fireEvent.press(view.getByTestId('request-gate-delete'));
    await waitFor(() => expect(mockRespond).toHaveBeenCalledWith('c1', false));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('a request she sent: shows how many are left, and at the cap the composer stops', async () => {
    mockThread.meta = directMeta({ others: [member('ana', 'Ana', { status: 'request' })] });
    mockPages.newest = [row('a', 'me', 'one', 9), row('b', 'me', 'two', 8), row('m1', 'me', 'hey you', 7)];
    const view = await openThread();
    expect(view.getByText(/Waiting for Ana to accept/)).toBeTruthy();
    expect(view.getByTestId('chat-input').props.editable).toBe(false);
    expect(view.getByTestId('chat-send').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('a group she left: no composer, a notice instead', async () => {
    mockThread.meta = directMeta({ type: 'group', title: 'Crew', me: member('me', 'Me', { status: 'left' }) });
    const view = await openThread();
    expect(view.getByTestId('thread-notice-gone')).toBeTruthy();
    expect(view.queryByTestId('chat-input')).toBeNull();
  });
});

describe('ChatScreen — reporting (CHAT-11)', () => {
  it('long-press → Report message opens the global sheet once, with the message id', async () => {
    const view = await openThread();
    fireEvent(view.getByTestId('message-m1'), 'longPress');
    fireEvent.press(await view.findByTestId('msg-action-report'));
    expect(mockOpenReport).toHaveBeenCalledTimes(1);
    expect(mockOpenReport).toHaveBeenCalledWith({ userId: 'ana', contentType: 'message', contentId: 'm1' });
  });

  it('header Report points at her latest message, and there is no local report modal', async () => {
    const view = await openThread();
    fireEvent.press(view.getByTestId('chat-menu'));
    fireEvent.press(await view.findByTestId('chat-menu-report'));
    expect(mockOpenReport).toHaveBeenCalledTimes(1);
    expect(mockOpenReport).toHaveBeenCalledWith({ userId: 'ana', contentType: 'message', contentId: 'm1' });
    expect(view.queryByText("What's the issue?")).toBeNull();
  });
});

describe('ChatScreen — history & scrolling (CHAT-16)', () => {
  it('reaching the top loads the older page with a cursor at the oldest loaded row', async () => {
    mockPages.older = [row('old1', 'ana', 'from last week', 60 * 24 * 7)];
    const view = await openThread();
    fireEvent(view.getByTestId('chat-list'), 'endReached');
    expect(await view.findByText('from last week')).toBeTruthy();
    expect(mockPages.olderCursor).toBe(iso(6));
  });

  it('a new message while she reads back shows a pill instead of yanking her down', async () => {
    const view = await openThread();
    fireEvent.scroll(view.getByTestId('chat-list'), {
      nativeEvent: { contentOffset: { y: 800, x: 0 }, contentSize: { height: 3000, width: 400 }, layoutMeasurement: { height: 700, width: 400 } },
    });
    act(() => { mockRealtime.insert?.({ new: row('m9', 'ana', 'you up?', 0) }); });
    const pill = await view.findByTestId('new-messages-pill');
    fireEvent.press(pill);
    await waitFor(() => expect(view.queryByTestId('new-messages-pill')).toBeNull());
  });

  it('at the bottom, a new message needs no pill', async () => {
    const view = await openThread();
    act(() => { mockRealtime.insert?.({ new: row('m9', 'ana', 'you up?', 0) }); });
    await view.findByText('you up?');
    expect(view.queryByTestId('new-messages-pill')).toBeNull();
  });
});

describe('ChatScreen — reply, header, mute', () => {
  it('reply (the swipe action) quotes the message and sends with reply_to_id', async () => {
    const view = await openThread();
    fireEvent(view.getByTestId('message-m1'), 'accessibilityAction', { nativeEvent: { actionName: 'reply' } });
    expect(await view.findByText('Replying to Ana')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('chat-input'), 'yes!');
    fireEvent.press(view.getByTestId('chat-send'));
    await waitFor(() => expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ content: 'yes!', replyToId: 'm1' })));
    await waitFor(() => expect(view.queryByTestId('composer-reply-bar')).toBeNull());
  });

  it('a group header shows emoji + name and opens group info', async () => {
    mockThread.meta = directMeta({
      type: 'group', title: 'Weekend crew', emoji: '🌈',
      others: [member('ana', 'Ana'), member('bea', 'Bea')],
    });
    const view = await openThread();
    expect(view.getByText('Weekend crew')).toBeTruthy();
    expect(view.getByText('🌈')).toBeTruthy();
    expect(view.getByText('3 members')).toBeTruthy();
    fireEvent.press(view.getByTestId('chat-header-title'));
    expect(mockPush).toHaveBeenCalledWith('/chat/c1/info');
  });

  it('mute is the conversation\'s: mute_conversation with no end, then unmute with null', async () => {
    const view = await openThread();
    fireEvent.press(view.getByTestId('chat-menu'));
    fireEvent.press(await view.findByTestId('chat-menu-mute'));
    await waitFor(() => expect(mockMute).toHaveBeenCalledWith('c1', MUTE_FOREVER));

    mockThread.meta = directMeta({ me: member('me', 'Me', { muted_until: MUTE_FOREVER }) });
    view.rerender(<ChatScreen />);
    fireEvent.press(view.getByTestId('chat-menu'));
    fireEvent.press(await view.findByText('Unmute notifications'));
    await waitFor(() => expect(mockMute).toHaveBeenLastCalledWith('c1', null));
  });

  it('marks the thread read on open through the store (server-owned unread)', async () => {
    await openThread();
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('c1'));
  });

  it('an unavailable thread says so instead of spinning', async () => {
    mockThread.meta = null;
    mockThread.unavailable = true;
    const view = render(<ChatScreen />);
    expect(await view.findByTestId('chat-unavailable')).toBeTruthy();
  });

  it('if who-is-in-this-thread fails to load, the composer slot offers a retry (never a dead end)', async () => {
    mockThread.meta = null;
    const view = await openThread();
    expect(view.queryByTestId('chat-input')).toBeNull();
    fireEvent.press(view.getByTestId('chat-meta-retry'));
    expect(mockReload).toHaveBeenCalled();
  });
});
