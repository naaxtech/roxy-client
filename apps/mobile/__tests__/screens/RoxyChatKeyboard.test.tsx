/**
 * Roxy AI's composer rides the keyboard (motion spec §3.1 row 15, budget F14;
 * lane C owns app/roxy-chat.tsx). Wave 2 wrapped the screen in a
 * KeyboardAvoidingView, which on Android (`softwareKeyboardLayoutMode:
 * resize`) jumps once at the end and on iOS pads on the JS thread.
 *
 * Now the keyboard's height is a UI-thread shared value (reanimated's
 * `useAnimatedKeyboard` on native, mounted only on this screen; the visual
 * viewport on web). A spacer under the composer takes `keyboard - bottom
 * inset` every frame, and while the list was at its end it scrolls with the
 * keyboard so the last message stays in view.
 *
 * Real reanimated (jest build) except the two native-only calls, which jest
 * cannot run: `useAnimatedKeyboard` (driven by the test) and `scrollTo`
 * (recorded).
 */
import React from 'react';
import { KeyboardAvoidingView } from 'react-native';
import { render, act, fireEvent, configure } from '@testing-library/react-native';

configure({ defaultIncludeHiddenElements: true });

const mockScrollTo = jest.fn();
const mockKeyboardCalls = jest.fn();
let mockKeyboard: { height: { value: number }; state: { value: number } };
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  mockKeyboard = { height: actual.makeMutable(0), state: actual.makeMutable(0) };
  return {
    ...actual,
    __esModule: true,
    useAnimatedKeyboard: (...a: unknown[]) => { mockKeyboardCalls(...a); return mockKeyboard; },
    scrollTo: (...a: unknown[]) => mockScrollTo(...a),
  };
});

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
const INSET_BOTTOM = 34;
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
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
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
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

import { getAnimatedStyle, makeMutable, setUpTests } from 'react-native-reanimated';
import RoxyChatScreen from '../../app/roxy-chat';
import { useRoxyChatStore } from '../../store/roxyChatStore';
import { useRoxyFailure } from '../../components/roxy/roxyConversation';
import { useRoxyFab } from '../../lib/roxyFab';
import { SPACE } from '../../lib/theme';

setUpTests();

const frame = (ms = 16) => act(() => { jest.advanceTimersByTime(ms); });
const keyboardTo = (h: number) => { act(() => { mockKeyboard.height.value = h; }); frame(); };
const spacerHeight = (view: ReturnType<typeof render>) =>
  (getAnimatedStyle(view.getByTestId('roxy-chat-keyboard-spacer') as never) as { height: number }).height;
const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });
const scrolled = (y: number) => ({
  nativeEvent: {
    contentOffset: { x: 0, y },
    contentSize: { width: 390, height: 0 },
    layoutMeasurement: { width: 390, height: 0 },
  },
});

/** A long conversation: 40 messages overflow a 600 dp list. */
function longChat() {
  useRoxyChatStore.setState({
    messages: Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 ? 'roxy' : 'user',
      content: `Message ${i}`,
      timestamp: new Date(2026, 9, 23, 10, i).toISOString(),
    })) as never,
    isTyping: false,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  // A fresh keyboard per test: an unmounted screen from the test before keeps
  // its own and cannot react to this one's.
  mockKeyboard = { height: makeMutable(0), state: makeMutable(0) };
  mockScrollTo.mockReset();
  mockKeyboardCalls.mockReset();
  useRoxyChatStore.setState({ messages: [], isTyping: false });
  useRoxyFailure.setState({ failure: null });
  useRoxyFab.setState({ enabled: true, loadedFor: 'amara', tucked: false, anchor: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Roxy AI chat — the composer rides the keyboard', () => {
  it('reads the keyboard frame by frame from reanimated, with no KeyboardAvoidingView', () => {
    const view = render(<RoxyChatScreen />);
    expect(mockKeyboardCalls).toHaveBeenCalled();
    expect(view.UNSAFE_queryAllByType(KeyboardAvoidingView)).toHaveLength(0);
  });

  it('the space under the composer is the keyboard minus the bottom inset, every frame', () => {
    const view = render(<RoxyChatScreen />);
    frame();
    expect(spacerHeight(view)).toBe(0);
    keyboardTo(120); // mid-animation
    expect(spacerHeight(view)).toBe(120 - INSET_BOTTOM);
    keyboardTo(300);
    expect(spacerHeight(view)).toBe(300 - INSET_BOTTOM);
    // The inset sits under the keyboard: no gap opens while it is small.
    keyboardTo(20);
    expect(spacerHeight(view)).toBe(0);
    keyboardTo(0);
    expect(spacerHeight(view)).toBe(0);
  });

  it('at the end of a long chat, the list follows the keyboard so her last message stays in view', () => {
    longChat();
    const view = render(<RoxyChatScreen />);
    // The list is 600 dp tall; its messages measure 2000 dp; she is at the end.
    fireEvent(view.getByTestId('roxy-chat-list'), 'layout', layout(600));
    fireEvent(view.getByTestId('roxy-chat-messages'), 'layout', layout(2000));
    frame();
    const end = 2000 + 2 * SPACE[3] - 600; // content + list padding − viewport
    fireEvent.scroll(view.getByTestId('roxy-chat-list'), scrolled(end));
    frame();
    mockScrollTo.mockReset();

    keyboardTo(150);
    keyboardTo(300);
    const ys = mockScrollTo.mock.calls.map((c) => c[2] as number);
    expect(ys.length).toBeGreaterThanOrEqual(2);
    // Each frame scrolls to the new end: the viewport lost exactly the lift.
    expect(ys[ys.length - 1]).toBe(end + (300 - INSET_BOTTOM));
    expect(mockScrollTo.mock.calls.every((c) => c[3] === false)).toBe(true);
  });

  it('a short chat that still fits is left where it is', () => {
    const view = render(<RoxyChatScreen />);
    fireEvent(view.getByTestId('roxy-chat-list'), 'layout', layout(600));
    fireEvent(view.getByTestId('roxy-chat-messages'), 'layout', layout(200));
    frame();
    mockScrollTo.mockReset();
    keyboardTo(300);
    // 200 + padding fits in 600 − 266: nothing to scroll.
    expect(mockScrollTo.mock.calls.every((c) => c[2] === 0)).toBe(true);
  });

  it('reading older messages: the keyboard does not yank her to the end', () => {
    longChat();
    const view = render(<RoxyChatScreen />);
    fireEvent(view.getByTestId('roxy-chat-list'), 'layout', layout(600));
    fireEvent(view.getByTestId('roxy-chat-messages'), 'layout', layout(2000));
    frame();
    fireEvent.scroll(view.getByTestId('roxy-chat-list'), scrolled(300));
    frame();
    mockScrollTo.mockReset();
    keyboardTo(300);
    expect(mockScrollTo).not.toHaveBeenCalled();
  });
});
