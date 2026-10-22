import React from 'react';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import CommunityChannelsScreen from '../../app/(tabs)/discover/community/channels/[communityId]';
import type { Channel, ChannelMessage } from '../../lib/channels';

/**
 * Switching channels.
 *
 * Review found three ways a message could appear under the wrong channel's
 * name, and every one of them lives in the window WHILE a fetch is in flight.
 * A browser test cannot pin that window open reliably — it waits, the fetch
 * resolves, and the assertion judges the settled state, which is correct
 * either way. The first version of the e2e passed against the bug for exactly
 * that reason.
 *
 * Here the fetch is a promise this file resolves by hand, so "during the
 * fetch" is a state the test simply sits in.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ communityId: 'com1' }),
}));

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
// Reactions and typing (CHAT-17) have their own suites; here they are inert so
// channel switching is tested on its own.
jest.mock('../../hooks/useReactions', () => ({
  useReactions: () => ({ reactionsMap: {}, addReaction: jest.fn(), removeReaction: jest.fn() }),
}));
jest.mock('../../hooks/useTyping', () => ({
  useTyping: () => ({ partnerIsTyping: false, typingNames: [], sendTyping: jest.fn(), stopTyping: jest.fn() }),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), hashUserId: (s: string) => s }));

jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: object) => unknown) => {
    const state = { user: { id: 'me' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

const mockOpenReport = jest.fn();
const mockBlock = jest.fn();
jest.mock('../../store/safetyStore', () => ({
  useSafetyStore: (sel?: (s: object) => unknown) => {
    const state = { openReportModal: mockOpenReport, blockUser: mockBlock };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: 'Queer Gamers' } }) }) }),
    }),
    channel: () => {
      // Chainable like the real client: the screen subscribes to INSERT and
      // UPDATE on one channel (CHAT-16).
      const ch: { on: () => unknown; subscribe: () => unknown } = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: jest.fn(),
    // markChannelRead (migration 124) posts a read cursor on channel open.
    rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

const general: Channel = {
  id: 'c-general', community_id: 'com1', slug: 'general', topic: null, position: 0, is_default: true,
};
const rants: Channel = {
  id: 'c-rants', community_id: 'com1', slug: 'rants', topic: null, position: 1, is_default: false,
};

const msg = (id: string, channelId: string, body: string): ChannelMessage => ({
  id, channel_id: channelId, sender_id: 'her', body,
  created_at: '2026-09-05T10:00:00Z', edited_at: null, deleted_at: null,
  author: { id: 'her', username: 'maya', display_name: 'Maya', avatar_url: null },
});

/** Message fetches, held open until the test releases them. */
type Pending = { channelId: string; resolve: (rows: ChannelMessage[]) => void };
/**
 * A FRESH queue per test, never one shared array. A test that times out keeps
 * running in the background, and with one module-level array its orphaned
 * `release()` spliced the next test's queue — so one slow test failed the next
 * one too, for a reason that had nothing to do with it.
 */
const queue = (): Pending[] => (globalThis as unknown as { __pending: Pending[] }).__pending;

/**
 * How long a fetch may take to be ISSUED after render. The first render in a
 * file pays the cold cost of the whole screen tree (~350ms idle) and under a
 * parallel `jest --ci` on a busy machine that was measured at up to 2s —
 * double RNTL's default 1s `waitFor`. The wait is event-driven (it returns the
 * moment the request exists), so this is a ceiling, not a sleep.
 */
const ISSUE_TIMEOUT_MS = 8_000;
// Must exceed ISSUE_TIMEOUT_MS, or the test is killed before waitFor can
// report WHICH request never came.
jest.setTimeout(20_000);
const mockSend = jest.fn();
const mockDelete = jest.fn();

jest.mock('../../lib/channels', () => {
  const actual = jest.requireActual('../../lib/channels');
  return {
    ...actual,
    fetchChannels: jest.fn(() => Promise.resolve([
      { id: 'c-general', community_id: 'com1', slug: 'general', topic: null, position: 0, is_default: true },
      { id: 'c-rants', community_id: 'com1', slug: 'rants', topic: null, position: 1, is_default: false },
    ])),
    fetchMyChannelRole: jest.fn(() => Promise.resolve({ isModerator: false })),
    fetchLiveStage: jest.fn(() => Promise.resolve(null)),
    fetchChannelMessages: jest.fn(
      (channelId: string) => new Promise((resolve) => {
        (globalThis as unknown as { __pending: { channelId: string; resolve: unknown }[] }).__pending.push({ channelId, resolve });
      }),
    ),
    sendChannelMessage: (...a: unknown[]) => mockSend(...a),
    deleteChannelMessage: (...a: unknown[]) => mockDelete(...a),
    setChannelNotifications: jest.fn(() => Promise.resolve()),
    fetchChannelNotifications: jest.fn(() => Promise.resolve(false)),
  };
});

/**
 * Resolve the fetch for one channel.
 *
 * Waits for the request to have been ISSUED first. Resolving a promise that
 * does not exist yet is a silent no-op, and the test then fails on a missing
 * message rather than on the thing it is about.
 */
const release = async (channelId: string, rows: ChannelMessage[]) => {
  // Bound to THIS test's queue at call time, so a release() left running by a
  // timed-out test can only ever touch its own, already-abandoned queue.
  const pending = queue();
  await waitFor(
    () => expect(pending.some((p) => p.channelId === channelId)).toBe(true),
    { timeout: ISSUE_TIMEOUT_MS },
  );
  const hit = pending.filter((p) => p.channelId === channelId);
  const keep = pending.filter((p) => p.channelId !== channelId);
  // Spliced in place, and only THIS channel's requests are taken. The mock
  // pushes into this array via globalThis, so reassigning it would leave the
  // mock pushing into the old one — and clearing it wholesale would throw away
  // the still-in-flight request the out-of-order test is about.
  pending.length = 0;
  pending.push(...keep);
  await act(async () => { hit.forEach((p) => p.resolve(rows)); });
};

/**
 * Pay the one-off cold cost of the screen tree before any test's clock starts.
 * The first render in the file measured ~350ms idle and up to 2s under a
 * loaded parallel run, and it was always charged to whichever test ran first.
 */
beforeAll(async () => {
  (globalThis as unknown as { __pending: Pending[] }).__pending = [];
  const warm = render(<CommunityChannelsScreen />);
  await release(general.id, []);
  warm.unmount();
});

beforeEach(() => {
  (globalThis as unknown as { __pending: Pending[] }).__pending = [];
  mockPush.mockClear();
  mockSend.mockReset();
  mockDelete.mockReset();
  mockOpenReport.mockClear();
  mockBlock.mockClear();
});

describe('switching channels', () => {
  it('never shows the previous channel’s messages under the new channel’s name', async () => {
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, [msg('m1', general.id, 'something said in general')]);
    await waitFor(() => expect(v.getByText('something said in general')).toBeTruthy());

    // Tap #rants. Its fetch is deliberately NOT released: this is the state
    // she is actually in for the length of the round trip, and the message
    // from #general used to sit here under the name "# rants".
    await act(async () => { fireEvent.press(v.getByTestId('channel-bar-rants')); });
    expect(v.queryByText('something said in general')).toBeNull();

    await release(rants.id, [msg('m2', rants.id, 'something said in rants')]);
    await waitFor(() => expect(v.getByText('something said in rants')).toBeTruthy());
  });

  it('ignores a slow fetch for a channel she has already left', async () => {
    // Tap #rants (fetch A), tap back to #general (fetch B). B returns first.
    // A then resolves — and used to paint #rants' rows under #general.
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, []);

    await act(async () => { fireEvent.press(v.getByTestId('channel-bar-rants')); });
    await act(async () => { fireEvent.press(v.getByTestId('channel-bar-general')); });

    await release(general.id, [msg('m1', general.id, 'general again')]);
    await release(rants.id, [msg('m2', rants.id, 'late rants message')]);

    expect(v.queryByText('late rants message')).toBeNull();
    expect(v.getByText('general again')).toBeTruthy();
  });

  it('does not drop a message she sent into the channel she switched to', async () => {
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, []);

    let settle: ((m: ChannelMessage) => void) | undefined;
    mockSend.mockImplementation(() => new Promise((r) => { settle = r; }));

    fireEvent.changeText(v.getByTestId('channel-composer-input'), 'sent in general');
    await act(async () => { fireEvent.press(v.getByTestId('channel-composer-send')); });

    // She switches before the insert comes back.
    await act(async () => { fireEvent.press(v.getByTestId('channel-bar-rants')); });
    await release(rants.id, []);

    await act(async () => { settle?.(msg('m9', general.id, 'sent in general')); });

    // Her #general message must not be drawn into #rants, where she would read
    // it as posted there until the next refetch quietly removed it.
    expect(v.queryByText('sent in general')).toBeNull();
  });

  it('clears the composer between channels, draft and all', async () => {
    // A private thought typed in #general could otherwise be sent into
    // #support by a woman who believed the box was empty.
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, []);

    fireEvent.changeText(v.getByTestId('channel-composer-input'), 'does anyone else feel like this');
    await act(async () => { fireEvent.press(v.getByTestId('channel-bar-rants')); });
    await release(rants.id, []);

    expect(v.getByTestId('channel-composer-input').props.value).toBe('');
  });
});

describe('keyboard (F14)', () => {
  it('the channel and its composer sit in the keyboard tracker', async () => {
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, []);
    expect(within(v.getByTestId('channel-keyboard')).getByTestId('channel-composer-input')).toBeTruthy();
  });
});

describe('sending is optimistic (F10)', () => {
  it('her message is in the channel the moment she sends it, before the insert answers', async () => {
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, []);
    mockSend.mockImplementation(() => new Promise(() => undefined));

    fireEvent.changeText(v.getByTestId('channel-composer-input'), 'on my way');
    act(() => { fireEvent.press(v.getByTestId('channel-composer-send')); });

    expect(v.getByText('on my way')).toBeTruthy();
    expect(v.getByTestId('channel-composer-input').props.value).toBe('');
    expect(mockSend).toHaveBeenCalledWith(general.id, 'me', 'on my way');
  });

  it('the saved row replaces the provisional one: one copy, the server id', async () => {
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, []);
    let settle: ((m: ChannelMessage) => void) | undefined;
    mockSend.mockImplementation(() => new Promise((r) => { settle = r; }));

    fireEvent.changeText(v.getByTestId('channel-composer-input'), 'on my way');
    act(() => { fireEvent.press(v.getByTestId('channel-composer-send')); });
    await act(async () => { settle?.({ ...msg('m-saved', general.id, 'on my way'), sender_id: 'me' }); });

    expect(v.getAllByText('on my way')).toHaveLength(1);
    expect(v.getByTestId('channel-message-m-saved')).toBeTruthy();
  });

  it('a refused send takes the message back and offers Retry in a snackbar', async () => {
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, []);
    mockSend.mockRejectedValueOnce(Object.assign(new Error('policy text'), { code: '42501' }));

    fireEvent.changeText(v.getByTestId('channel-composer-input'), 'on my way');
    await act(async () => { fireEvent.press(v.getByTestId('channel-composer-send')); });

    expect(v.queryByText('on my way')).toBeNull();
    expect(v.getByTestId('channel-send-snackbar')).toBeTruthy();
    expect(v.getByText('You do not have permission to do that here.')).toBeTruthy();
    expect(v.queryByText(/policy text/)).toBeNull();
    // Her words are back in the box.
    expect(v.getByTestId('channel-composer-input').props.value).toBe('on my way');

    mockSend.mockImplementation(() => new Promise(() => undefined));
    act(() => { fireEvent.press(v.getByTestId('channel-send-snackbar-action')); });
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(v.getByText('on my way')).toBeTruthy();
  });

  it('a provisional message offers no safety menu until it exists', async () => {
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, []);
    mockSend.mockImplementation(() => new Promise(() => undefined));
    fireEvent.changeText(v.getByTestId('channel-composer-input'), 'on my way');
    act(() => { fireEvent.press(v.getByTestId('channel-composer-send')); });
    const pending = v.getAllByTestId(/^channel-message-pending:/)[0];
    fireEvent(pending, 'longPress');
    expect(v.queryByText('Delete my message')).toBeNull();
  });
});

describe('the safety menu', () => {
  const hers = { ...msg('m1', general.id, 'her words'), sender_id: 'someone-else' };

  it('offers report and block on someone else’s message', async () => {
    // A group message surface without these is one a woman cannot get out of.
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, [hers]);
    await waitFor(() => expect(v.getByText('her words')).toBeTruthy());

    await act(async () => { fireEvent(v.getByTestId('channel-message-m1'), 'longPress'); });
    expect(v.getByTestId('channel-actions-report')).toBeTruthy();
    expect(v.getByTestId('channel-actions-block')).toBeTruthy();
  });

  it('reports the MESSAGE, not just the woman who sent it', async () => {
    // Without contentId a moderator gets a report she cannot act on: she is
    // told who, and never which message.
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, [hers]);
    await waitFor(() => expect(v.getByText('her words')).toBeTruthy());

    await act(async () => { fireEvent(v.getByTestId('channel-message-m1'), 'longPress'); });
    await act(async () => { fireEvent.press(v.getByTestId('channel-actions-report')); });
    expect(mockOpenReport).toHaveBeenCalledWith({
      userId: 'someone-else', contentType: 'message', contentId: 'm1',
    });
  });

  it('does not offer to block or report her own message', async () => {
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, [{ ...msg('m1', general.id, 'mine'), sender_id: 'me' }]);
    await waitFor(() => expect(v.getByText('mine')).toBeTruthy());

    await act(async () => { fireEvent(v.getByTestId('channel-message-m1'), 'longPress'); });
    expect(v.queryByTestId('channel-actions-block')).toBeNull();
    expect(v.queryByTestId('channel-actions-report')).toBeNull();
    // She can still take her own words back.
    expect(v.getByTestId('channel-actions-remove')).toBeTruthy();
  });

  it('offers no Remove to a plain member on someone else’s message', async () => {
    // The gate is the policy; this only decides what to draw. Offering a
    // button the database will refuse teaches her the app is broken.
    const v = render(<CommunityChannelsScreen />);
    await release(general.id, [hers]);
    await waitFor(() => expect(v.getByText('her words')).toBeTruthy());

    await act(async () => { fireEvent(v.getByTestId('channel-message-m1'), 'longPress'); });
    expect(v.queryByTestId('channel-actions-remove')).toBeNull();
  });
});
