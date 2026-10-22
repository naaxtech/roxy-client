import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, act, waitFor, configure } from '@testing-library/react-native';

configure({ defaultIncludeHiddenElements: true });

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-svg', () => ({
  __esModule: true, default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', Path: 'Path', G: 'G',
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
let mockReduced = true;
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../../lib/supabase', () => ({ callEdgeFunction: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ Analytics: { roxyChatOpened: jest.fn() } }));
jest.mock('../../lib/confirm', () => ({ confirmAction: jest.fn(() => Promise.resolve(true)), showAlert: jest.fn() }));
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { user: { id: 'amara' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../store/profileStore', () => ({
  useProfileStore: (sel?: (s: unknown) => unknown) => {
    const state = { profile: { display_name: 'Amara Okafor' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

import RoxyChatScreen from '../../app/roxy-chat';
import { callEdgeFunction } from '../../lib/supabase';
import { useRoxyChatStore } from '../../store/roxyChatStore';
import { useRoxyFailure, FAILED_COPY } from '../../components/roxy/roxyConversation';
import { useRoxyFab } from '../../lib/roxyFab';
import { THEMES } from '../../lib/theme';
import { useThemeStore } from '../../store/themeStore';

const call = callEdgeFunction as jest.Mock;
const { confirmAction } = jest.requireMock('../../lib/confirm');
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const light = THEMES.light;

beforeEach(() => {
  mockReduced = true;
  jest.clearAllMocks();
  call.mockReset();
  call.mockResolvedValue({ data: { response: 'That sounds like a lot. Want to tell me about it?' }, error: null });
  useRoxyChatStore.setState({ messages: [], isTyping: false });
  useRoxyFailure.setState({ failure: null });
  useRoxyFab.setState({ enabled: true, loadedFor: 'amara', tucked: false, anchor: 0 });
  useThemeStore.setState({ theme: 'light', choice: 'light' });
});

async function say(view: ReturnType<typeof render>, text: string) {
  fireEvent.changeText(view.getByPlaceholderText('Message Roxy AI'), text);
  await act(async () => { fireEvent.press(view.getByTestId('roxy-chat-send')); });
}

/**
 * Roxy AI's full chat (design direction v2 › "Roxy AI chat + FAB", board
 * v2-05). Her own chat, not a DM: the O and her name in the header, her
 * bubbles on `surface` with her O beside them, the member's in
 * `pinkContainer`, a writing indicator made of her O (never a spinner),
 * honest copy about being an AI, and a way to clear, report or switch her off.
 */
describe('Roxy AI chat', () => {
  it('her header: the O, her name, who sees it, back and more', () => {
    const v = render(<RoxyChatScreen />);
    expect(v.getByTestId('roxy-chat-header-o')).toBeTruthy();
    expect(v.getByText('Roxy AI')).toBeTruthy();
    expect(v.getByText('Only you see this chat')).toBeTruthy();
    expect(v.getByLabelText('Back')).toBeTruthy();
    expect(v.getByLabelText('More')).toBeTruthy();
  });

  it('an empty chat greets her and offers three ways in', () => {
    const v = render(<RoxyChatScreen />);
    expect(v.getByText('How are you, really?')).toBeTruthy();
    for (const s of ["I'm nervous about an event", 'Help me write my intro', 'I just want to talk']) {
      expect(v.getByText(s)).toBeTruthy();
    }
  });

  it('says what she is, plainly, and never the banned words', () => {
    const v = render(<RoxyChatScreen />);
    expect(v.getByText('Roxy AI can be wrong. Keep passwords and addresses to yourself.')).toBeTruthy();
    const text = JSON.stringify(v.toJSON()).toLowerCase();
    for (const banned of ['assistant', 'chatbot', 'ask me anything', 'always on', 'wingwoman', '✦']) {
      expect(text).not.toContain(banned);
    }
  });

  it('sending shows her words at once and Roxy AI answers', async () => {
    const v = render(<RoxyChatScreen />);
    await say(v, 'Long day.');
    expect(v.getByText('Long day.')).toBeTruthy();
    expect(call).toHaveBeenCalledWith('roxy-chat', { conversation_id: 'roxy-amara', message: 'Long day.' });
    await waitFor(() => expect(v.getByText('That sounds like a lot. Want to tell me about it?')).toBeTruthy());
  });

  it('her bubbles are pinkContainer; Roxy AI’s are surface with her O beside them', async () => {
    const v = render(<RoxyChatScreen />);
    await say(v, 'Long day.');
    await waitFor(() => v.getByText('That sounds like a lot. Want to tell me about it?'));
    expect(flat(v.getByTestId('roxy-bubble-user-0')).backgroundColor).toBe(light.pinkContainer);
    expect(flat(v.getByText('Long day.')).color).toBe(light.onPinkContainer);
    expect(flat(v.getByTestId('roxy-bubble-roxy-1')).backgroundColor).toBe(light.surface);
    expect(v.getByTestId('roxy-bubble-o-1')).toBeTruthy();
  });

  it('while she writes: her O and the words, no spinner', async () => {
    let resolve!: (v: unknown) => void;
    call.mockReturnValue(new Promise((r) => { resolve = r; }));
    const v = render(<RoxyChatScreen />);
    await say(v, 'Hi');
    expect(v.getByText('Roxy AI is writing')).toBeTruthy();
    expect(v.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
    await act(async () => { resolve({ data: { response: 'Hi Amara.' }, error: null }); });
    expect(v.queryByText('Roxy AI is writing')).toBeNull();
  });

  it('a failed send keeps her message, says so in one sentence, and Retry works', async () => {
    call.mockResolvedValueOnce({ data: null, error: 'boom', status: 500 });
    const v = render(<RoxyChatScreen />);
    await say(v, 'Hello?');
    expect(v.getByText('Hello?')).toBeTruthy();
    expect(v.getByText(FAILED_COPY)).toBeTruthy();
    call.mockResolvedValueOnce({ data: { response: 'Sorry, here now.' }, error: null });
    await act(async () => { fireEvent.press(v.getByText('Retry')); });
    expect(v.getByText('Sorry, here now.')).toBeTruthy();
    expect(v.queryByText(FAILED_COPY)).toBeNull();
  });

  it('after her reply, two easy ways to keep going', async () => {
    const v = render(<RoxyChatScreen />);
    await say(v, 'Long day.');
    await waitFor(() => v.getByText('Tell me more'));
    await act(async () => { fireEvent.press(v.getByText('Tell me more')); });
    expect(call).toHaveBeenLastCalledWith('roxy-chat', { conversation_id: 'roxy-amara', message: 'Tell me more' });
  });

  it('send waits for words', () => {
    const v = render(<RoxyChatScreen />);
    expect(v.getByTestId('roxy-chat-send').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('the composer sits on surface with an outline and a pink send', () => {
    const v = render(<RoxyChatScreen />);
    const composer = flat(v.getByTestId('roxy-chat-composer'));
    expect(composer.backgroundColor).toBe(light.surface);
    expect(composer.borderWidth).toBe(1.5);
    fireEvent.changeText(v.getByPlaceholderText('Message Roxy AI'), 'x');
    expect(flat(v.getByTestId('roxy-chat-send')).backgroundColor).toBe(light.pink);
  });

  it('replies arrive by sentence (motion on)', async () => {
    mockReduced = false;
    jest.useFakeTimers();
    try {
      call.mockResolvedValue({ data: { response: 'First thought. Second thought.' }, error: null });
      const v = render(<RoxyChatScreen />);
      fireEvent.changeText(v.getByPlaceholderText('Message Roxy AI'), 'Hi');
      await act(async () => { fireEvent.press(v.getByTestId('roxy-chat-send')); });
      expect(v.getByText('First thought.')).toBeTruthy();
      await act(async () => { jest.advanceTimersByTime(1000); });
      expect(v.getByText('First thought. Second thought.')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  describe('more', () => {
    it('Clear chat asks once, then empties the chat', async () => {
      useRoxyChatStore.getState().addMessage({ role: 'user', content: 'old words' });
      const v = render(<RoxyChatScreen />);
      fireEvent.press(v.getByLabelText('More'));
      await act(async () => { fireEvent.press(v.getByText('Clear chat')); });
      expect(confirmAction).toHaveBeenCalled();
      expect(useRoxyChatStore.getState().messages).toEqual([]);
    });

    it('Report a reply goes to the team through Feedback', () => {
      const v = render(<RoxyChatScreen />);
      fireEvent.press(v.getByLabelText('More'));
      fireEvent.press(v.getByText('Report a reply'));
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: '/(tabs)/you/feedback' }),
      );
    });

    it('Turn off Roxy AI: off at once, one sentence, Undo puts her back', async () => {
      const v = render(<RoxyChatScreen />);
      fireEvent.press(v.getByLabelText('More'));
      await act(async () => { fireEvent.press(v.getByText('Turn off Roxy AI')); });
      expect(useRoxyFab.getState().enabled).toBe(false);
      expect(v.getByText('Roxy AI is off. The round button is gone from your screens.')).toBeTruthy();
      await act(async () => { fireEvent.press(v.getByText('Undo')); });
      expect(useRoxyFab.getState().enabled).toBe(true);
    });
  });

  it('back leaves; with nowhere to go back to, it lands on the Feed', () => {
    const v = render(<RoxyChatScreen />);
    fireEvent.press(v.getByLabelText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
    mockRouter.canGoBack.mockReturnValueOnce(false);
    fireEvent.press(v.getByLabelText('Back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/feed');
  });
});
