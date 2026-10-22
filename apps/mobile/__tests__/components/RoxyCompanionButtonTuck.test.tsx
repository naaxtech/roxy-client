import React from 'react';
import { Platform } from 'react-native';
import { render, act, configure, fireEvent } from '@testing-library/react-native';
import { setUpTests, getAnimatedStyle } from 'react-native-reanimated';

configure({ defaultIncludeHiddenElements: true });
setUpTests();

// Spy on withSpring (real reanimated underneath) to read the head start.
const mockWithSpring = jest.fn();
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return {
    __esModule: true,
    ...actual,
    withSpring: (...a: unknown[]) => {
      mockWithSpring(...a);
      return actual.withSpring(...a);
    },
  };
});

/**
 * The Roxy AI button's tuck runs on the UI thread (motion spec §3.1 row 17,
 * jank audit #9): the list's scroll lands in a shared value (`fabTuck`), and
 * the button springs from it without a React render or a store write per
 * scroll event. A busy JS thread cannot hold the tuck back once it starts.
 *
 * Real reanimated (jest build) with fake timers: `getAnimatedStyle` reads the
 * style the UI thread would paint, frame by frame.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/discover',
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
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
let mockReduced = false;
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../../lib/supabase', () => ({ callEdgeFunction: jest.fn() }));
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

import { RoxyCompanionButton } from '../../components/ui/RoxyCompanionButton';
import { useRoxyFab, fabTuck } from '../../lib/roxyFab';
import { FAB_MARGIN, FAB_SIZE, FAB_TUCKED } from '../../components/nav/navTokens';
import { PRESS, springAt } from '../../lib/motion';

/** Tucked, the O's inner edge sits on the margin line: only the margin shows. */
const TUCK_TRAVEL = FAB_SIZE / 2 + FAB_TUCKED / 2;
void FAB_MARGIN;
const TUCK_SCALE = FAB_TUCKED / FAB_SIZE;

type Transform = Record<string, number>[];
const transformOf = (node: Parameters<typeof getAnimatedStyle>[0]) =>
  (getAnimatedStyle(node) as { transform?: Transform }).transform ?? [];
const pick = (t: Transform, key: string) => t.find((x) => key in x)?.[key];
/** One UI frame passes: the button is mounted and at rest before a list reports. */
const frame = () => act(() => { jest.advanceTimersByTime(16); });

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
  useRoxyFab.setState({ enabled: true, loadedFor: 'amara', tucked: false, anchor: 0 });
  act(() => { fabTuck.value = 0; });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('RoxyCompanionButton — the tuck on the UI thread', () => {
  it('springs from the shared value alone: moving one frame after it flips, settled at the edge', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    frame();
    // A UI-thread scroll handler writes only the shared value: no store write.
    act(() => { fabTuck.value = 1; });
    act(() => { jest.advanceTimersByTime(16); });
    const first = transformOf(getByTestId('fab-tuck'));
    expect(pick(first, 'translateX')).toBeGreaterThan(0);
    expect(pick(first, 'translateX')).toBeLessThan(TUCK_TRAVEL);

    act(() => { jest.advanceTimersByTime(1000); });
    const settled = transformOf(getByTestId('fab-tuck'));
    expect(pick(settled, 'translateX')).toBeCloseTo(TUCK_TRAVEL, 1);
    expect(pick(settled, 'scale')).toBeCloseTo(TUCK_SCALE, 2);
  });

  it('retargets mid-flight: a flip back before she lands turns her around from where she is', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    frame();
    act(() => { fabTuck.value = 1; });
    act(() => { jest.advanceTimersByTime(48); });
    const mid = pick(transformOf(getByTestId('fab-tuck')), 'translateX') ?? 0;
    expect(mid).toBeGreaterThan(0);
    act(() => { fabTuck.value = 0; });
    act(() => { jest.advanceTimersByTime(16); });
    const next = pick(transformOf(getByTestId('fab-tuck')), 'translateX') ?? 0;
    // No jump to either end: the next frame is still near where she was.
    expect(next).toBeGreaterThan(0);
    expect(Math.abs(next - mid)).toBeLessThan(TUCK_TRAVEL / 2);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(pick(transformOf(getByTestId('fab-tuck')), 'translateX')).toBeCloseTo(0, 1);
  });

  it('on the Feed stage she never tucks, whatever a list reported', () => {
    const { getByTestId } = render(<RoxyCompanionButton onStage />);
    frame();
    act(() => { fabTuck.value = 1; });
    act(() => { jest.advanceTimersByTime(1000); });
    const t = transformOf(getByTestId('fab-tuck'));
    expect(pick(t, 'translateX') ?? 0).toBeCloseTo(0, 3);
    expect(pick(t, 'scale') ?? 1).toBeCloseTo(1, 3);
  });

  it('Reduce Motion: no travel, the tucked state is there in the next frame and fades in over 120 ms', () => {
    mockReduced = true;
    const { getByTestId } = render(<RoxyCompanionButton />);
    frame();
    act(() => { fabTuck.value = 1; });
    act(() => { jest.advanceTimersByTime(16); });
    const t = transformOf(getByTestId('fab-tuck'));
    expect(pick(t, 'translateX')).toBeCloseTo(TUCK_TRAVEL, 3);
    expect(pick(t, 'scale')).toBeCloseTo(TUCK_SCALE, 3);
    const early = (getAnimatedStyle(getByTestId('fab-seat')) as { opacity: number }).opacity;
    expect(early).toBeLessThan(1);
    act(() => { jest.advanceTimersByTime(140); });
    expect((getAnimatedStyle(getByTestId('fab-seat')) as { opacity: number }).opacity).toBeCloseTo(1, 2);
  });

  // F2: every pressable answers on press-in. The tucked hit area is an
  // invisible target over the O, so the O itself dips while it is held.
  // Measured on web (lane C press probe): 130-177 ms to the dip.
  it('the tucked target answers on web with no press delay', () => {
    useRoxyFab.setState({ tucked: true });
    const was = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    try {
      const view = render(<RoxyCompanionButton />);
      expect(view.getByTestId('fab-tucked').props.delayPressIn).toBe(0);
    } finally {
      Object.defineProperty(Platform, 'OS', { value: was, configurable: true });
    }
  });

  it('the tucked O dips on press-in and springs back on release', () => {
    useRoxyFab.setState({ tucked: true });
    const { getByTestId } = render(<RoxyCompanionButton />);
    frame();
    const rest = pick(transformOf(getByTestId('fab-tuck')), 'scale') ?? 0;
    expect(rest).toBeCloseTo(TUCK_SCALE, 3);
    mockWithSpring.mockClear();
    fireEvent(getByTestId('fab-tucked'), 'pressIn');
    // F1 head start: the dip leaves one frame into its spring.
    const h = springAt('fastSpatial', 1000 / 60);
    const call = mockWithSpring.mock.calls.find(([to]) => to === PRESS.scale);
    expect(call?.[1]).toMatchObject({ reduceMotion: 'never' });
    expect(call?.[1].velocity).toBeCloseTo(-(1 - PRESS.scale) * h.v, 6);
    act(() => { jest.advanceTimersByTime(16); });
    expect(pick(transformOf(getByTestId('fab-tuck')), 'scale'))
      .toBeLessThanOrEqual(rest * (1 - (1 - PRESS.scale) * h.x) + 1e-6);
    act(() => { jest.advanceTimersByTime(400); });
    expect(pick(transformOf(getByTestId('fab-tuck')), 'scale')).toBeCloseTo(rest * PRESS.scale, 3);
    fireEvent(getByTestId('fab-tucked'), 'pressOut');
    act(() => { jest.advanceTimersByTime(600); });
    expect(pick(transformOf(getByTestId('fab-tuck')), 'scale')).toBeCloseTo(rest, 3);
  });
});
