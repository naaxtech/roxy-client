/**
 * PressableScale v3 (Wave 3 lane C0, polish/motion-spec.md §4.2 + budget F1).
 *
 * Press-in drives reanimated shared values straight from the press handler:
 * no React state, no re-render, the state layer is always mounted at
 * opacity 0. RN `Pressable` keeps the semantics (TalkBack/VoiceOver
 * activation, web Enter/Space + focus, scroll cancels the press). On web the
 * 50 ms RN-web press delay is off (jank-audit #2).
 *
 * Runs on reanimated's own jest implementation: `getAnimatedStyle` reads what
 * the UI would paint, fake timers drive the springs.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

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

import {
  PressableScale,
  TouchableOpacity,
  stateLayerFor,
  PILL_RADIUS_MIN,
} from '../../../components/ui/PressableScale';
import { PRESS, REDUCED, SPRING } from '../../../lib/motion';
import { THEMES } from '../../../lib/theme';
import { useThemeStore } from '../../../store/themeStore';

type Node = Parameters<typeof getAnimatedStyle>[0];

/** What the host paints now: its static style overlaid with the animated one. */
function painted(node: Node): Record<string, unknown> {
  const base = StyleSheet.flatten((node as unknown as { props: { style?: unknown } }).props.style as never) ?? {};
  return { ...(base as Record<string, unknown>), ...(getAnimatedStyle(node) as Record<string, unknown>) };
}

function scaleOf(node: Node): number {
  const transform = (painted(node).transform ?? []) as Record<string, unknown>[];
  return transform.reduce((acc, t) => (typeof t.scale === 'number' ? acc * t.scale : acc), 1);
}

function layerOpacity(v: ReturnType<typeof render>): number {
  return Number(painted(v.getByTestId('press-state-layer')).opacity ?? 0);
}

const press = (node: Node) => act(() => { fireEvent(node, 'pressIn', { nativeEvent: {} }); });
const release = (node: Node) => act(() => { fireEvent(node, 'pressOut', { nativeEvent: {} }); });
const settle = (ms = 1000) => act(() => { jest.advanceTimersByTime(ms); });
/** One 60 Hz frame: what F1/F12 allow a press-in or a Reduce Motion jump. */
const frame = () => settle(16);

const originalOS = Platform.OS;

beforeEach(() => {
  jest.useFakeTimers();
  mockReducedMotion.mockReturnValue(false);
  mockWithSpring.mockClear();
  mockWithTiming.mockClear();
  useThemeStore.setState({ theme: 'light' });
});

afterEach(() => {
  jest.useRealTimers();
  Platform.OS = originalOS;
});

describe('PressableScale v3 — press-in on shared values', () => {
  it('renders its children and fires onPress', () => {
    const onPress = jest.fn();
    const v = render(
      <PressableScale testID="p" onPress={onPress} accessibilityRole="button">
        <Text>Go</Text>
      </PressableScale>,
    );
    fireEvent.press(v.getByTestId('p'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(v.getByText('Go')).toBeTruthy();
  });

  it('springs to 0.96 on fastSpatial from the press-in handler (UI-thread value, physics token)', () => {
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    press(v.getByTestId('p'));
    const spatial = mockWithSpring.mock.calls.find(([, cfg]) => cfg?.stiffness === SPRING.fastSpatial.stiffness);
    expect(spatial).toBeDefined();
    expect(spatial?.[1]).toMatchObject({ ...SPRING.fastSpatial, reduceMotion: 'never' });
    settle();
    expect(scaleOf(v.getByTestId('p'))).toBeCloseTo(PRESS.scale, 3);
  });

  it('does NOT re-render on press-in or release (no React state on the press path)', () => {
    const getState = jest.spyOn(useThemeStore, 'getState');
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    const rendersAtRest = getState.mock.calls.length;
    press(v.getByTestId('p'));
    release(v.getByTestId('p'));
    settle();
    expect(getState.mock.calls.length).toBe(rendersAtRest);
    getState.mockRestore();
  });

  it('springs back to rest on release', () => {
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    press(v.getByTestId('p'));
    settle();
    release(v.getByTestId('p'));
    settle();
    expect(scaleOf(v.getByTestId('p'))).toBeCloseTo(1, 3);
    expect(layerOpacity(v)).toBeCloseTo(0, 3);
  });

  it('a cancelled press (scroll took the touch) returns to rest without firing onPress', () => {
    const onPress = jest.fn();
    const v = render(<PressableScale testID="p" onPress={onPress} />);
    press(v.getByTestId('p'));
    release(v.getByTestId('p'));
    settle();
    expect(onPress).not.toHaveBeenCalled();
    expect(scaleOf(v.getByTestId('p'))).toBeCloseTo(1, 3);
  });

  // Regression (web export): a quick click fires pressIn and pressOut before
  // React re-renders; the release must still land.
  it('releases even when pressIn and pressOut land in the same tick', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    const pressable = v.UNSAFE_getByType(Pressable);
    act(() => {
      pressable.props.onPressIn({ nativeEvent: {} });
      pressable.props.onPressOut({ nativeEvent: {} });
    });
    settle();
    expect(scaleOf(v.getByTestId('p'))).toBe(1);
    expect(layerOpacity(v)).toBeCloseTo(0, 5);
  });
});

describe('state layer (ink, M3 pressed 10% — decisions P5)', () => {
  it('is always mounted, invisible at rest, and never takes a touch', () => {
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    const layer = v.getByTestId('press-state-layer');
    expect(layerOpacity(v)).toBe(0);
    expect(layer.props.pointerEvents).toBe('none');
  });

  it('lays ink at 10% in light while pressed, on fastEffects', () => {
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    press(v.getByTestId('p'));
    expect(mockWithSpring.mock.calls.some(([, cfg]) => cfg?.stiffness === SPRING.fastEffects.stiffness)).toBe(true);
    settle();
    expect(painted(v.getByTestId('press-state-layer')).backgroundColor).toBe(THEMES.light.ink);
    expect(layerOpacity(v)).toBeCloseTo(0.1, 3);
  });

  it('uses 10% in dark', () => {
    useThemeStore.setState({ theme: 'dark' });
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    press(v.getByTestId('p'));
    settle();
    expect(painted(v.getByTestId('press-state-layer')).backgroundColor).toBe(THEMES.dark.ink);
    expect(layerOpacity(v)).toBeCloseTo(0.1, 3);
    expect(stateLayerFor('dark')).toEqual({ color: THEMES.dark.ink, alpha: 0.1 });
    expect(stateLayerFor('light')).toEqual({ color: THEMES.light.ink, alpha: 0.1 });
  });

  it('feedback="none" mounts no layer and never moves', () => {
    const v = render(<PressableScale testID="p" feedback="none" onPress={() => {}} />);
    expect(v.queryByTestId('press-state-layer')).toBeNull();
    press(v.getByTestId('p'));
    settle();
    expect(scaleOf(v.getByTestId('p'))).toBe(1);
  });
});

describe('Reduce Motion (F12)', () => {
  it('jumps to 0.96 with no spatial spring, and the layer fades in 120 ms', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    press(v.getByTestId('p'));
    frame();
    expect(scaleOf(v.getByTestId('p'))).toBe(PRESS.scale);
    expect(mockWithSpring).not.toHaveBeenCalled();
    const fade = mockWithTiming.mock.calls.find(([to]) => to === 1);
    expect(fade?.[1]).toMatchObject({ duration: REDUCED.fadeMs, reduceMotion: 'never' });
    settle(REDUCED.fadeMs + 20);
    expect(layerOpacity(v)).toBeCloseTo(0.1, 3);
    release(v.getByTestId('p'));
    frame();
    expect(scaleOf(v.getByTestId('p'))).toBe(1);
  });
});

describe('pill morph (M3 button group)', () => {
  it('morphs a pill to radius 12 while pressed, and back on release', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(
      <PressableScale testID="p" onPress={() => {}} style={{ borderRadius: 999, height: 40 }} />,
    );
    act(() => {
      fireEvent(v.getByTestId('p'), 'layout', { nativeEvent: { layout: { height: 40, width: 120, x: 0, y: 0 } } });
    });
    expect(PILL_RADIUS_MIN).toBeLessThanOrEqual(999);
    expect(painted(v.getByTestId('p')).borderRadius).toBe(999);
    press(v.getByTestId('p'));
    frame();
    expect(painted(v.getByTestId('p')).borderRadius).toBe(PRESS.radius);
    release(v.getByTestId('p'));
    frame();
    expect(painted(v.getByTestId('p')).borderRadius).toBe(999);
  });

  it('springs the corner from the VISIBLE radius (half the height), not from 999', () => {
    const v = render(
      <PressableScale testID="p" onPress={() => {}} style={{ borderRadius: 999, height: 40 }} />,
    );
    act(() => {
      fireEvent(v.getByTestId('p'), 'layout', { nativeEvent: { layout: { height: 40, width: 120, x: 0, y: 0 } } });
    });
    press(v.getByTestId('p'));
    act(() => { jest.advanceTimersByTime(16); });
    const r = Number(painted(v.getByTestId('p')).borderRadius);
    expect(r).toBeLessThanOrEqual(20);
    expect(r).toBeGreaterThan(PRESS.radius - 1);
  });

  it('does not morph a card (radius below the pill threshold)', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<PressableScale testID="p" onPress={() => {}} style={{ borderRadius: 20 }} />);
    press(v.getByTestId('p'));
    expect(painted(v.getByTestId('p')).borderRadius).toBe(20);
  });
});

describe('props API kept for the 147 importers', () => {
  it('feedback="layer" keeps the state layer but never scales (big surfaces)', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<PressableScale testID="p" feedback="layer" onPress={() => {}} />);
    press(v.getByTestId('p'));
    settle();
    expect(scaleOf(v.getByTestId('p'))).toBe(1);
    expect(layerOpacity(v)).toBeCloseTo(0.1, 3);
  });

  it('gives no feedback when disabled, and does not fire onPress', () => {
    mockReducedMotion.mockReturnValue(true);
    const onPress = jest.fn();
    const v = render(<PressableScale testID="p" disabled onPress={onPress} />);
    press(v.getByTestId('p'));
    settle();
    expect(layerOpacity(v)).toBe(0);
    expect(scaleOf(v.getByTestId('p'))).toBe(1);
    fireEvent.press(v.getByTestId('p'));
    expect(onPress).not.toHaveBeenCalled();
    expect(v.getByTestId('p').props.accessibilityState).toEqual({ disabled: true });
  });

  it('keeps a caller transform and composes the press scale onto it', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(
      <PressableScale testID="p" onPress={() => {}} style={{ transform: [{ rotate: '45deg' }] }} />,
    );
    press(v.getByTestId('p'));
    frame();
    const transform = painted(v.getByTestId('p')).transform as Record<string, unknown>[];
    expect(transform[0]).toEqual({ rotate: '45deg' });
    expect(scaleOf(v.getByTestId('p'))).toBeCloseTo(PRESS.scale, 5);
  });

  it('keeps the caller style (layout, colour) on the pressable host', () => {
    const v = render(
      <PressableScale testID="p" onPress={() => {}} style={[{ marginTop: 7 }, { backgroundColor: '#123456' }]} />,
    );
    expect(painted(v.getByTestId('p'))).toMatchObject({ marginTop: 7, backgroundColor: '#123456' });
  });

  it('a style function still sees `pressed` (RoxyChip fills while pressed)', () => {
    const v = render(
      <PressableScale testID="p" onPress={() => {}} style={({ pressed }) => ({ width: pressed ? 2 : 1 })} />,
    );
    expect(painted(v.getByTestId('p')).width).toBe(1);
    press(v.getByTestId('p'));
    expect(painted(v.getByTestId('p')).width).toBe(2);
    release(v.getByTestId('p'));
    expect(painted(v.getByTestId('p')).width).toBe(1);
  });

  it('a children function still sees `pressed`', () => {
    const v = render(
      <PressableScale testID="p" onPress={() => {}}>
        {({ pressed }) => <Text>{pressed ? 'down' : 'up'}</Text>}
      </PressableScale>,
    );
    expect(v.getByText('up')).toBeTruthy();
    press(v.getByTestId('p'));
    expect(v.getByText('down')).toBeTruthy();
  });

  it('keeps accessibility semantics on the pressable (role, label, state, actions)', () => {
    const onPress = jest.fn();
    const v = render(
      <PressableScale
        testID="p"
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Join"
        accessibilityState={{ selected: true }}
      />,
    );
    const node = v.getByTestId('p');
    expect(node.props.accessibilityRole).toBe('button');
    expect(node.props.accessibilityLabel).toBe('Join');
    expect(node.props.accessibilityState).toEqual({ selected: true });
    // TalkBack / VoiceOver "activate" reaches onPress through RN Pressable.
    expect(v.UNSAFE_getByType(Pressable).props.onPress).toBe(onPress);
  });
});

describe('web press delay (jank-audit #2)', () => {
  it('turns RN-web\'s 50 ms press delay off on web', () => {
    Platform.OS = 'web';
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    expect(v.UNSAFE_getByType(Pressable).props.delayPressIn).toBe(0);
  });

  it('passes nothing extra on native (RN Pressable has no delay by default)', () => {
    Platform.OS = 'android';
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    expect(v.UNSAFE_getByType(Pressable).props.delayPressIn).toBeUndefined();
  });

  it('TouchableOpacity keeps an explicit delayPressIn: RN-web key on web, unstable_pressDelay on native', () => {
    Platform.OS = 'web';
    const web = render(<TouchableOpacity testID="t" onPress={() => {}} delayPressIn={120} />);
    expect(web.UNSAFE_getByType(Pressable).props.delayPressIn).toBe(120);
    web.unmount();
    Platform.OS = 'ios';
    const ios = render(<TouchableOpacity testID="t" onPress={() => {}} delayPressIn={120} />);
    expect(ios.UNSAFE_getByType(Pressable).props.unstable_pressDelay).toBe(120);
  });
});

describe('TouchableOpacity drop-in', () => {
  it('is a PressableScale with the same props: testID, a11y, onPress', () => {
    const onPress = jest.fn();
    const v = render(
      <TouchableOpacity
        testID="t"
        onPress={onPress}
        accessibilityRole="tab"
        accessibilityState={{ selected: true }}
        accessibilityLabel="Feed"
      >
        <Text>Feed</Text>
      </TouchableOpacity>,
    );
    const node = v.getByTestId('t');
    expect(node.props.accessibilityState).toEqual({ selected: true });
    expect(node.props.accessibilityRole).toBe('tab');
    expect(node.props.accessibilityLabel).toBe('Feed');
    fireEvent.press(node);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('gets the press feedback by default', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<TouchableOpacity testID="t" onPress={() => {}} activeOpacity={0.8} />);
    press(v.getByTestId('t'));
    settle();
    expect(scaleOf(v.getByTestId('t'))).toBeCloseTo(PRESS.scale, 5);
    expect(layerOpacity(v)).toBeCloseTo(0.1, 3);
  });

  it('keeps activeOpacity={1} meaning "no feedback" (backdrops, full-screen taps)', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<TouchableOpacity testID="t" onPress={() => {}} activeOpacity={1} />);
    press(v.getByTestId('t'));
    expect(scaleOf(v.getByTestId('t'))).toBe(1);
    expect(v.queryByTestId('press-state-layer')).toBeNull();
  });
});
