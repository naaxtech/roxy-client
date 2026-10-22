/**
 * "Hello, Roxy" on the UI thread (lane C): the rise, the scrim, the O's
 * flight and the greeting lines are reanimated shared values; the drag is an
 * RNGH Pan (UI thread) with a projected release. Her face turns happy and the
 * lines start when the sheet LOOKS landed, not when the spring reports
 * "finished" (spec §3.2: never gate on a completion callback).
 */
import 'react-native-gesture-handler/jestSetup';
import React, { Profiler } from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, act, configure } from '@testing-library/react-native';
import { getAnimatedStyle, setUpTests } from 'react-native-reanimated';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

configure({ defaultIncludeHiddenElements: true });
setUpTests();

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
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
let mockReduced = false;
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../../../lib/supabase', () => ({ callEdgeFunction: jest.fn() }));

import { HelloRoxySheet } from '../../../components/roxy/HelloRoxySheet';

const SHEET_H = 520;
const frames = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
type Node = Parameters<typeof getAnimatedStyle>[0];
const ty = (n: Node) => ((getAnimatedStyle(n) as { transform?: Record<string, number>[] }).transform ?? [])
  .reduce((acc, t) => (typeof t.translateY === 'number' ? acc + t.translateY : acc), 0);
const opacity = (n: Node) => Number((getAnimatedStyle(n) as { opacity?: number }).opacity ?? 1);

function open() {
  const onClose = jest.fn();
  const onOpenChat = jest.fn();
  const v = render(
    <HelloRoxySheet visible userId="amara" firstName="Amara" now={new Date(2026, 9, 21, 21, 14)}
      origin={{ x: 340, y: 700, size: 40 }} onClose={onClose} onOpenChat={onOpenChat} />,
  );
  act(() => {
    fireEvent(v.getByTestId('hello-roxy-sheet'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: SHEET_H } } });
  });
  return { v, onClose, onOpenChat };
}
function drag(translationY: number, velocityY = 0) {
  fireGestureHandler(getByGestureTestId('hello-roxy-pan'), [
    { state: State.BEGAN, translationY: 0 },
    { state: State.ACTIVE, translationY: 0 },
    { state: State.ACTIVE, translationY, velocityY },
  ]);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('HelloRoxySheet on the UI thread', () => {
  it('rises from below on shared values: moving after a frame, home by ~500 ms, with no React commit', () => {
    const commits = jest.fn();
    const onClose = jest.fn();
    const v = render(
      <Profiler id="hello" onRender={commits}>
        <HelloRoxySheet visible userId="amara" firstName="Amara" now={new Date(2026, 9, 21, 21, 14)}
          origin={{ x: 340, y: 700, size: 40 }} onClose={onClose} onOpenChat={jest.fn()} />
      </Profiler>,
    );
    act(() => {
      fireEvent(v.getByTestId('hello-roxy-sheet'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: SHEET_H } } });
    });
    commits.mockClear();
    frames(32);
    const y1 = ty(v.getByTestId('hello-roxy-sheet'));
    expect(y1).toBeGreaterThan(0);
    expect(y1).toBeLessThan(SHEET_H);
    frames(500);
    expect(ty(v.getByTestId('hello-roxy-sheet'))).toBeLessThan(SHEET_H * 0.02);
    frames(800);
    expect(commits).not.toHaveBeenCalled();
  });

  it('her face turns happy as the sheet lands (not ~900 ms later when the spring reports done), then the lines arrive', () => {
    const { v } = open();
    frames(48);
    expect(opacity(v.getByTestId('hello-roxy-face-happy'))).toBe(0);
    expect(opacity(v.getByTestId('hello-roxy-face-open'))).toBe(1);
    expect(opacity(v.getByTestId('hello-roxy-line-2'))).toBe(0);
    frames(500);
    expect(opacity(v.getByTestId('hello-roxy-face-happy'))).toBe(1);
    expect(opacity(v.getByTestId('hello-roxy-face-open'))).toBe(0);
    frames(800);
    expect(opacity(v.getByTestId('hello-roxy-line-2'))).toBeCloseTo(1, 1);
    expect(opacity(v.getByTestId('hello-roxy-line-3'))).toBeCloseTo(1, 1);
  });

  it('drag up past the line (projected) opens the full chat', () => {
    const { onOpenChat, onClose } = open();
    frames(600);
    drag(-60);
    frames(16);
    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('drag down past the line closes; a fling down closes from a short drag', () => {
    const a = open();
    frames(600);
    drag(120);
    frames(16);
    expect(a.onClose).toHaveBeenCalledTimes(1);
    a.v.unmount();

    const b = open();
    frames(600);
    drag(30, 1200);
    frames(16);
    expect(b.onClose).toHaveBeenCalledTimes(1);
  });

  it('a short slow drag follows the finger, then springs home', () => {
    const { v, onClose, onOpenChat } = open();
    frames(600);
    drag(30);
    frames(16);
    expect(ty(v.getByTestId('hello-roxy-sheet'))).toBeGreaterThan(20);
    frames(700);
    expect(ty(v.getByTestId('hello-roxy-sheet'))).toBeLessThan(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it('Reduce Motion: it is simply there, happy, every line shown', () => {
    mockReduced = true;
    const { v } = open();
    frames(16);
    expect(ty(v.getByTestId('hello-roxy-sheet'))).toBe(0);
    expect(opacity(v.getByTestId('hello-roxy-face-happy'))).toBe(1);
    expect(opacity(v.getByTestId('hello-roxy-line-2'))).toBe(1);
    expect(StyleSheet.flatten(v.getByTestId('hello-roxy-sheet').props.style)).toBeTruthy();
  });
});
