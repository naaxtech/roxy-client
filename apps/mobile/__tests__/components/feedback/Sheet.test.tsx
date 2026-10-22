/**
 * Sheet (Wave 3 lane C0; polish/motion-spec.md §1.3 rules 2/3/5, §3.1 row 6;
 * budgets F5, F12). One bottom sheet for the app: rises from the bottom edge
 * on `SPRING.spatial`, only the scrim fades (`effects`), the drag tracks the
 * finger on the UI thread, release uses the projected position and carries
 * its velocity into the spring, every move is interruptible. Reduce Motion:
 * the sheet is simply there and the scrim fades 120 ms.
 */
// RNGH's own jest setup (mocks its native module); package.json's jest config
// does not load it globally, so every suite that renders a Sheet imports it.
import 'react-native-gesture-handler/jestSetup';
import React, { useState } from 'react';
import { Modal, StyleSheet, Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

const mockReducedMotion = jest.fn(() => false);
jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion(),
}));

const mockWithSpring = jest.fn();
const mockWithTiming = jest.fn();
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return {
    __esModule: true,
    ...actual,
    withSpring: (...a: unknown[]) => {
      mockWithSpring(...a);
      return actual.withSpring(...a);
    },
    withTiming: (...a: unknown[]) => {
      mockWithTiming(...a);
      return actual.withTiming(...a);
    },
  };
});

import { Sheet, SHEET_EXIT_MS, SHEET_SCRIM_ALPHA } from '../../../components/feedback/Sheet';
import { GESTURE, REDUCED, REST, SPRING } from '../../../lib/motion';
import { THEMES } from '../../../lib/theme';
import { useThemeStore } from '../../../store/themeStore';

type Node = Parameters<typeof getAnimatedStyle>[0];
function painted(node: Node): Record<string, unknown> {
  const base = (StyleSheet.flatten((node as unknown as { props: { style?: unknown } }).props.style as never) ?? {}) as Record<string, unknown>;
  return { ...base, ...(getAnimatedStyle(node) as Record<string, unknown>) };
}
function translateY(node: Node): number {
  const t = (painted(node).transform ?? []) as Record<string, unknown>[];
  return t.reduce((acc, x) => (typeof x.translateY === 'number' ? acc + x.translateY : acc), 0);
}
/** The scrim sits beside an accessibilityViewIsModal surface: hidden to VoiceOver, so query it as hidden. */
const HIDDEN = { includeHiddenElements: true } as const;
const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
const SHEET_H = 400;
function layout(v: ReturnType<typeof render>, h = SHEET_H) {
  act(() => {
    fireEvent(v.getByTestId('sheet'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: h } } });
  });
}

function Harness({ initial = true, dismissible = true, dragFrom }: { initial?: boolean; dismissible?: boolean; dragFrom?: 'handle' | 'sheet' }) {
  const [open, setOpen] = useState(initial);
  return (
    <>
      <Text testID="toggle" onPress={() => setOpen((o) => !o)}>toggle</Text>
      <Sheet
        visible={open}
        onClose={() => { mockOnClose(); setOpen(false); }}
        accessibilityLabel="Create"
        dismissible={dismissible}
        dragFrom={dragFrom}
      >
        <Text>Inside</Text>
      </Sheet>
    </>
  );
}
const mockOnClose = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  mockReducedMotion.mockReturnValue(false);
  mockWithSpring.mockClear();
  mockWithTiming.mockClear();
  mockOnClose.mockClear();
  useThemeStore.setState({ theme: 'light' });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('open / close', () => {
  it('renders nothing while closed', () => {
    const v = render(<Harness initial={false} />);
    expect(v.queryByTestId('sheet')).toBeNull();
    expect(v.UNSAFE_queryByType(Modal)).toBeNull();
  });

  it('rises from the bottom edge on SPRING.spatial (px rest threshold) and only the scrim fades', () => {
    const v = render(<Harness />);
    layout(v);
    const rise = mockWithSpring.mock.calls.find(([to, cfg]) => to === 0 && cfg?.stiffness === SPRING.spatial.stiffness);
    expect(rise?.[1]).toMatchObject({ ...SPRING.spatial, restDisplacementThreshold: REST.px });
    const scrimIn = mockWithSpring.mock.calls.find(([to, cfg]) => to === 1 && cfg?.stiffness === SPRING.effects.stiffness);
    expect(scrimIn).toBeDefined();
    advance(600);
    expect(translateY(v.getByTestId('sheet'))).toBeCloseTo(0, 0);
    expect(Number(painted(v.getByTestId('sheet-scrim', HIDDEN)).opacity)).toBeCloseTo(1, 2);
    // The sheet surface itself is never translucent.
    expect(painted(v.getByTestId('sheet')).opacity ?? 1).toBe(1);
    expect(painted(v.getByTestId('sheet')).backgroundColor).toBe(THEMES.light.surface);
    expect(SHEET_SCRIM_ALPHA).toBeGreaterThan(0);
  });

  it('is 95% of the way in by 250 ms (F5)', () => {
    const v = render(<Harness />);
    layout(v);
    advance(250);
    expect(translateY(v.getByTestId('sheet'))).toBeLessThan(SHEET_H * 0.05 + 1);
  });

  it('leaves downward and unmounts once off screen, without waiting on a completion callback', () => {
    const v = render(<Harness />);
    layout(v);
    advance(600);
    fireEvent.press(v.getByTestId('toggle'));
    advance(100);
    expect(translateY(v.getByTestId('sheet'))).toBeGreaterThan(0);
    advance(SHEET_EXIT_MS);
    expect(v.queryByTestId('sheet')).toBeNull();
  });

  it('is interruptible: reopening mid-exit turns around from where it is (no jump)', () => {
    const v = render(<Harness />);
    layout(v);
    advance(600);
    fireEvent.press(v.getByTestId('toggle'));
    advance(80);
    const mid = translateY(v.getByTestId('sheet'));
    expect(mid).toBeGreaterThan(5);
    fireEvent.press(v.getByTestId('toggle'));
    advance(16);
    const next = translateY(v.getByTestId('sheet'));
    expect(Math.abs(next - mid)).toBeLessThan(SHEET_H / 3);
    advance(SHEET_EXIT_MS + 200);
    expect(v.getByTestId('sheet')).toBeTruthy();
    expect(translateY(v.getByTestId('sheet'))).toBeCloseTo(0, 0);
  });
});

describe('dismissal paths', () => {
  it('a scrim tap asks to close', () => {
    const v = render(<Harness />);
    fireEvent.press(v.getByTestId('sheet-scrim-press', HIDDEN));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('Android back / web Escape (Modal onRequestClose) asks to close', () => {
    const v = render(<Harness />);
    act(() => { v.UNSAFE_getByType(Modal).props.onRequestClose(); });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('a VoiceOver escape (two-finger Z) asks to close', () => {
    const v = render(<Harness />);
    act(() => { v.getByTestId('sheet').props.onAccessibilityEscape(); });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('dismissible={false} ignores the scrim, back and Escape', () => {
    const v = render(<Harness dismissible={false} />);
    fireEvent.press(v.getByTestId('sheet-scrim-press', HIDDEN));
    act(() => { v.UNSAFE_getByType(Modal).props.onRequestClose(); });
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});

describe('drag (UI thread, projected release)', () => {
  it('tracks the finger 1:1 downward (released, it springs back from where the finger was)', () => {
    const v = render(<Harness />);
    layout(v);
    advance(600);
    const before = translateY(v.getByTestId('sheet'));
    fireGestureHandler(getByGestureTestId('sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY: 60 },
    ]);
    advance(16);
    // fireGestureHandler ends the gesture (velocity 0), so the sheet springs back from
    // exactly where the finger let go: one frame later it is still ~60 px down.
    const after = translateY(v.getByTestId('sheet')) - before;
    expect(after).toBeLessThanOrEqual(60);
    expect(after).toBeGreaterThan(60 * 0.9);
  });

  it('rubber-bands upward (resists, never 1:1)', () => {
    const v = render(<Harness />);
    layout(v);
    advance(600);
    fireGestureHandler(getByGestureTestId('sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY: -100 },
    ]);
    advance(16);
    const y = translateY(v.getByTestId('sheet'));
    expect(y).toBeLessThan(0);
    expect(y).toBeGreaterThan(-100);
  });

  it('a slow short drag springs back carrying its velocity, and stays open', () => {
    const v = render(<Harness />);
    layout(v);
    advance(600);
    mockWithSpring.mockClear();
    fireGestureHandler(getByGestureTestId('sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY: 50, velocityY: 120 },
      { state: State.END, translationY: 50, velocityY: 120 },
    ]);
    const back = mockWithSpring.mock.calls.find(([to, cfg]) => to === 0 && cfg?.stiffness === SPRING.spatial.stiffness);
    expect(back?.[1]).toMatchObject({ velocity: 120 });
    advance(600);
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(translateY(v.getByTestId('sheet'))).toBeCloseTo(0, 0);
  });

  it('a short drag with a fast flick dismisses (projected past 35%, or > 800 dp/s)', () => {
    const v = render(<Harness />);
    layout(v);
    advance(600);
    fireGestureHandler(getByGestureTestId('sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY: 40, velocityY: GESTURE.flingDpPerS + 400 },
      { state: State.END, translationY: 40, velocityY: GESTURE.flingDpPerS + 400 },
    ]);
    advance(16);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    advance(SHEET_EXIT_MS + 50);
    expect(v.queryByTestId('sheet')).toBeNull();
  });

  it('a fling keeps its velocity all the way out (the exit is not restarted from rest)', () => {
    const v = render(<Harness />);
    layout(v);
    advance(600);
    mockWithSpring.mockClear();
    const fling = GESTURE.flingDpPerS + 700;
    fireGestureHandler(getByGestureTestId('sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY: 30, velocityY: fling },
      { state: State.END, translationY: 30, velocityY: fling },
    ]);
    advance(16);
    const exits = mockWithSpring.mock.calls.filter(([to, cfg]) => to > 0 && cfg?.stiffness === SPRING.spatial.stiffness);
    expect(exits.length).toBeGreaterThan(0);
    for (const [, cfg] of exits) expect(cfg.velocity).toBe(fling);
  });

  it('a long slow drag past 35% dismisses', () => {
    const v = render(<Harness />);
    layout(v);
    advance(600);
    fireGestureHandler(getByGestureTestId('sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY: SHEET_H * 0.4, velocityY: 0 },
      { state: State.END, translationY: SHEET_H * 0.4, velocityY: 0 },
    ]);
    advance(16);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('cannot be dragged away when not dismissible', () => {
    const v = render(<Harness dismissible={false} />);
    layout(v);
    advance(600);
    fireGestureHandler(getByGestureTestId('sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY: SHEET_H, velocityY: 2000 },
      { state: State.END, translationY: SHEET_H, velocityY: 2000 },
    ]);
    advance(600);
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});

describe('Reduce Motion (F12)', () => {
  it('the sheet is simply there (no spatial spring), the scrim fades 120 ms', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<Harness />);
    layout(v);
    advance(16);
    expect(translateY(v.getByTestId('sheet'))).toBe(0);
    expect(mockWithSpring.mock.calls.some(([, cfg]) => cfg?.stiffness === SPRING.spatial.stiffness)).toBe(false);
    expect(mockWithTiming.mock.calls.find(([to]) => to === 1)?.[1]).toMatchObject({ duration: REDUCED.fadeMs });
    advance(REDUCED.fadeMs);
    expect(Number(painted(v.getByTestId('sheet-scrim', HIDDEN)).opacity)).toBeCloseTo(1, 2);
  });

  it('closes without sliding and unmounts after the 120 ms scrim fade', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<Harness />);
    layout(v);
    advance(200);
    fireEvent.press(v.getByTestId('toggle'));
    advance(REDUCED.fadeMs + 20);
    expect(v.queryByTestId('sheet')).toBeNull();
  });
});

describe('accessibility', () => {
  it('is a modal with a name; the scrim is a Close button; the handle is decorative', () => {
    const v = render(<Harness />);
    const sheet = v.getByTestId('sheet');
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    expect(sheet.props.accessibilityLabel).toBe('Create');
    const scrim = v.getByTestId('sheet-scrim-press', HIDDEN);
    expect(scrim.props.accessibilityRole).toBe('button');
    expect(scrim.props.accessibilityLabel).toBe('Close');
    // VoiceOver keeps to the modal surface (escape gesture closes); TalkBack reaches the scrim.
    expect(v.queryByTestId('sheet-scrim-press')).toBeNull();
    expect(v.getByText('Inside')).toBeTruthy();
  });
});
