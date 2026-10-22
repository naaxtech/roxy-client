import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

/**
 * Swipe-to-reply on gesture-handler worklets (motion spec §3.1 #18, F12).
 *
 * The bubble follows the finger 1:1 up to the threshold, then rubber-bands;
 * crossing the threshold ticks once (`selection`, §3.3); release past it
 * replies; the bubble springs home on `SPRING.spatial` carrying the release
 * velocity. Under Reduce Motion the bubble does not travel, but the swipe
 * still replies and the tick still fires (haptics stay).
 */

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
const mockHaptic = jest.fn();
jest.mock('../../../lib/haptics', () => ({ haptic: (...a: unknown[]) => mockHaptic(...a) }));
let mockReduced = false;
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));

import { MessageRow, SWIPE_REPLY_AT, swipeOffset, releaseSpring } from '../../../components/chat/MessageRow';
import { SPRING } from '../../../lib/motion';

const msg = (over: Record<string, unknown> = {}) => ({
  id: 'm1', conversation_id: 'c', sender_id: 'ana', content: 'hey you', media_url: null,
  message_type: 'text', is_read: false, created_at: '2026-05-01T12:00:00Z',
  isFirstInGroup: true, isLastInGroup: true, showTimestamp: false, showName: false, isSystem: false,
  ...over,
}) as never;

const onReply = jest.fn();
const base = {
  currentUserId: 'me', isGroup: false,
  nameOf: (id: string | null) => (id === 'ana' ? 'Ana' : 'Someone'),
  reactions: [], showReadState: true,
  onLongPress: jest.fn(), onReply, onQuotePress: jest.fn(), onToggleReaction: jest.fn(),
  onRetry: jest.fn(), onUseSuggestion: jest.fn(),
};

const pull = (dx: number, dy = 0, velocityX = 400) => [
  { state: State.BEGAN, translationX: 0, translationY: 0 },
  { state: State.ACTIVE, translationX: 14, translationY: 0 },
  { translationX: dx / 2, translationY: dy / 2 },
  { translationX: dx, translationY: dy },
  { translationX: dx + 4, translationY: dy },
  { state: State.END, translationX: dx + 4, translationY: dy, velocityX },
];

/** runOnJS hops back to the JS thread asynchronously; let it land. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  mockHaptic.mockClear();
  onReply.mockClear();
  mockReduced = false;
});

describe('swipeOffset', () => {
  it('follows the finger 1:1 up to the threshold, then resists, never past +24', () => {
    expect(swipeOffset(30, false)).toBe(30);
    expect(swipeOffset(SWIPE_REPLY_AT, false)).toBe(SWIPE_REPLY_AT);
    const far = swipeOffset(400, false);
    expect(far).toBeGreaterThan(SWIPE_REPLY_AT);
    expect(far).toBeLessThan(SWIPE_REPLY_AT + 24);
    expect(swipeOffset(SWIPE_REPLY_AT + 10, false) - SWIPE_REPLY_AT).toBeLessThan(10);
    expect(swipeOffset(-40, false)).toBe(0);
  });

  it('under Reduce Motion the bubble does not travel', () => {
    expect(swipeOffset(30, true)).toBe(0);
    expect(swipeOffset(400, true)).toBe(0);
  });
});

describe('releaseSpring', () => {
  it('springs home on SPRING.spatial carrying the release velocity', () => {
    expect(releaseSpring(640, false)).toEqual({ ...SPRING.spatial, velocity: 640 });
  });
  it('under Reduce Motion there is no spring (it is already home)', () => {
    expect(releaseSpring(640, true)).toBeNull();
  });
});

describe('MessageRow swipe (RNGH)', () => {
  it('a pull past the threshold replies once and ticks once', async () => {
    render(<MessageRow {...base} message={msg()} />);
    fireGestureHandler(getByGestureTestId('swipe-reply-m1'), pull(SWIPE_REPLY_AT + 20));
    await settle();
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(mockHaptic.mock.calls).toEqual([['select']]);
  });

  it('a short pull neither replies nor ticks', async () => {
    render(<MessageRow {...base} message={msg()} />);
    fireGestureHandler(getByGestureTestId('swipe-reply-m1'), pull(30));
    await settle();
    expect(onReply).not.toHaveBeenCalled();
    expect(mockHaptic).not.toHaveBeenCalled();
  });

  it('a mostly vertical drag is a scroll, not a reply', async () => {
    render(<MessageRow {...base} message={msg()} />);
    fireGestureHandler(getByGestureTestId('swipe-reply-m1'), pull(SWIPE_REPLY_AT + 20, 90));
    await settle();
    expect(onReply).not.toHaveBeenCalled();
  });

  it('under Reduce Motion the swipe still replies and the tick stays', async () => {
    mockReduced = true;
    render(<MessageRow {...base} message={msg()} />);
    fireGestureHandler(getByGestureTestId('swipe-reply-m1'), pull(SWIPE_REPLY_AT + 20));
    await settle();
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(mockHaptic.mock.calls).toEqual([['select']]);
  });

  it('a message still sending cannot be swiped', () => {
    render(<MessageRow {...base} message={msg({ deliveryStatus: 'sending' })} />);
    const gesture = getByGestureTestId('swipe-reply-m1') as unknown as { config: { enabled?: boolean } };
    expect(gesture.config.enabled).toBe(false);
  });

  it('a long-press that opens the menu ticks as a selection (§3.3)', () => {
    const onLongPress = jest.fn();
    const v = render(<MessageRow {...base} onLongPress={onLongPress} message={msg()} />);
    fireEvent(v.getByTestId('message-m1'), 'longPress');
    expect(onLongPress).toHaveBeenCalled();
    expect(mockHaptic.mock.calls).toEqual([['select']]);
  });

  it('toggling a reaction chip is a committed reaction: a light tap (§3.3)', () => {
    const onToggleReaction = jest.fn();
    const reactions = [{ id: 'r1', message_id: 'm1', user_id: 'ana', emoji: '❤️', created_at: '2026-05-01T12:00:00Z' }];
    const v = render(<MessageRow {...base} onToggleReaction={onToggleReaction} reactions={reactions as never} message={msg()} />);
    fireEvent.press(v.getByText(/❤️/));
    expect(onToggleReaction).toHaveBeenCalledWith('m1', '❤️', false);
    expect(mockHaptic.mock.calls).toEqual([['tap']]);
  });
});
