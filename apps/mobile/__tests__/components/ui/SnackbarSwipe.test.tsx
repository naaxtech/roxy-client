/**
 * The snackbar on the UI thread, swipe to dismiss (motion spec §3.1 row 13,
 * lane C): it springs in on `SPRING.spatial` from reanimated shared values;
 * a horizontal drag follows the finger on the UI thread (RNGH Pan); the
 * release uses the projected position (WWDC18): past 35% of its width, or a
 * fling over 800 dp/s, it flies off and leaves; otherwise it springs home and
 * gets its full time again. Its timer pauses while held. Reduce Motion: no
 * travel (it is there, it goes). Screen readers get a Dismiss action.
 */
import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { getAnimatedStyle, setUpTests } from 'react-native-reanimated';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

setUpTests();

let mockReduced = false;
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));

import { Snackbar, SNACKBAR_DURATION, SNACKBAR_SWIPE_EXIT_MS } from '../../../components/ui/Snackbar';
import { GESTURE } from '../../../lib/motion';
import { useThemeStore } from '../../../store/themeStore';

type Node = Parameters<typeof getAnimatedStyle>[0];
function painted(node: Node): { opacity?: number; transform?: Record<string, number>[] } {
  const base = (StyleSheet.flatten((node as unknown as { props: { style?: unknown } }).props.style as never) ?? {}) as Record<string, unknown>;
  return { ...base, ...(getAnimatedStyle(node) as Record<string, unknown>) } as never;
}
const part = (n: Node, key: string) => painted(n).transform?.find((t) => key in t)?.[key] ?? 0;
const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
const WIDTH = 358;

function show(props: Partial<React.ComponentProps<typeof Snackbar>> = {}) {
  const onDismiss = jest.fn();
  const v = render(
    <Snackbar visible message="Saved." actionLabel="Undo" onAction={() => {}} onDismiss={onDismiss} testID="snack" {...props} />,
  );
  act(() => {
    fireEvent(v.getByTestId('snack'), 'layout', { nativeEvent: { layout: { x: 16, y: 0, width: WIDTH, height: 56 } } });
  });
  return { v, onDismiss };
}
function drag(translationX: number, velocityX = 0) {
  fireGestureHandler(getByGestureTestId('snack-pan'), [
    { state: State.BEGAN, translationX: 0 },
    { state: State.ACTIVE, translationX: 0 },
    { state: State.ACTIVE, translationX, velocityX },
  ]);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
  useThemeStore.setState({ theme: 'light' });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('Snackbar on the UI thread', () => {
  it('springs in from below (shared values: moving after one frame, settled at rest)', () => {
    const { v } = show();
    advance(16);
    const y1 = part(v.getByTestId('snack'), 'translateY');
    expect(y1).toBeGreaterThan(0);
    advance(800);
    expect(part(v.getByTestId('snack'), 'translateY')).toBeCloseTo(0, 1);
    expect(painted(v.getByTestId('snack')).opacity).toBeCloseTo(1, 2);
  });

  it('Reduce Motion: it is simply there', () => {
    mockReduced = true;
    const { v } = show();
    advance(16);
    expect(part(v.getByTestId('snack'), 'translateY')).toBe(0);
    expect(painted(v.getByTestId('snack')).opacity).toBe(1);
  });
});

describe('Snackbar swipe to dismiss', () => {
  it('follows the finger sideways, and a short slow drag springs home without dismissing', () => {
    const { v, onDismiss } = show();
    advance(800);
    drag(60);
    advance(16);
    const x = part(v.getByTestId('snack'), 'translateX');
    expect(x).toBeGreaterThan(60 * 0.85);
    expect(x).toBeLessThanOrEqual(60);
    advance(800);
    expect(part(v.getByTestId('snack'), 'translateX')).toBeCloseTo(0, 1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it(`let go past ${GESTURE.dismissFraction * 100}% of its width: it flies off that way and leaves once it is gone`, () => {
    const { v, onDismiss } = show();
    advance(800);
    drag(-WIDTH * 0.5);
    advance(16);
    expect(part(v.getByTestId('snack'), 'translateX')).toBeLessThan(-WIDTH * 0.5 + 1);
    expect(onDismiss).not.toHaveBeenCalled();
    advance(SNACKBAR_SWIPE_EXIT_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a fling dismisses from a short drag (projected release, not where the finger lifted)', () => {
    const { onDismiss } = show();
    advance(800);
    drag(30, GESTURE.flingDpPerS + 200);
    advance(SNACKBAR_SWIPE_EXIT_MS + 16);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('its timer pauses while held: a snackbar dragged home late still gets its full time', () => {
    const { onDismiss } = show();
    advance(SNACKBAR_DURATION - 1000);
    drag(40);
    advance(SNACKBAR_DURATION - 100);
    expect(onDismiss).not.toHaveBeenCalled();
    advance(200);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Reduce Motion: a dismissing swipe leaves at once, no fly-off', () => {
    mockReduced = true;
    const { onDismiss } = show();
    advance(16);
    drag(WIDTH * 0.6);
    advance(16);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('screen readers can dismiss it without the swipe', () => {
    const { v, onDismiss } = show();
    const bar = v.getByTestId('snack');
    expect(bar.props.accessibilityActions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'dismiss' })]));
    fireEvent(bar, 'accessibilityAction', { nativeEvent: { actionName: 'dismiss' } });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
