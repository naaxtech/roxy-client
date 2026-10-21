import React from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockReducedMotion = jest.fn(() => false);
jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion(),
}));

import {
  PressableScale,
  TouchableOpacity,
  stateLayerFor,
  PILL_RADIUS_MIN,
} from '../../../components/ui/PressableScale';
import { PRESS, SPRING } from '../../../lib/motion';
import { THEMES } from '../../../lib/theme';
import { useThemeStore } from '../../../store/themeStore';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

/** The scale the host view is painted at, read through Animated. */
function scaleOf(node: { props: { style?: unknown } }): number {
  const transform = (flat(node).transform ?? []) as Record<string, unknown>[];
  return transform.reduce((acc, t) => (typeof t.scale === 'number' ? acc * t.scale : acc), 1);
}

let springSpy: jest.SpyInstance;

beforeEach(() => {
  mockReducedMotion.mockReturnValue(false);
  useThemeStore.setState({ theme: 'light' });
  springSpy = jest.spyOn(Animated, 'spring');
});

afterEach(() => {
  springSpy.mockRestore();
});

describe('PressableScale — v2 press states', () => {
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

  it('answers on press-IN: springs to 0.96 on fastSpatial', () => {
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} });
    const call = springSpy.mock.calls.find(([, cfg]) => cfg.toValue === PRESS.scale);
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      stiffness: SPRING.fastSpatial.stiffness,
      damping: SPRING.fastSpatial.damping,
      mass: 1,
    });
  });

  it('springs back to 1 on release', () => {
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} });
    fireEvent(v.getByTestId('p'), 'pressOut', { nativeEvent: {} });
    const back = springSpy.mock.calls.filter(([, cfg]) => cfg.toValue === 1);
    expect(back.length).toBeGreaterThan(0);
  });

  it('jumps to 0.96 under Reduce Motion instead of springing', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    expect(scaleOf(v.getByTestId('p'))).toBe(1);
    fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} });
    expect(scaleOf(v.getByTestId('p'))).toBeCloseTo(PRESS.scale, 5);
    expect(springSpy.mock.calls.find(([, cfg]) => cfg.toValue === PRESS.scale)).toBeUndefined();
    fireEvent(v.getByTestId('p'), 'pressOut', { nativeEvent: {} });
    expect(scaleOf(v.getByTestId('p'))).toBe(1);
  });

  it('lays an ink state layer only while pressed: 8% in light', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    expect(v.queryByTestId('press-state-layer')).toBeNull();
    fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} });
    const layer = v.getByTestId('press-state-layer');
    expect(flat(layer).backgroundColor).toBe(THEMES.light.ink);
    expect(flat(layer).opacity).toBeCloseTo(0.08, 5);
    expect(layer.props.pointerEvents).toBe('none');
    fireEvent(v.getByTestId('p'), 'pressOut', { nativeEvent: {} });
    expect(v.queryByTestId('press-state-layer')).toBeNull();
  });

  it('uses 10% in dark', () => {
    mockReducedMotion.mockReturnValue(true);
    useThemeStore.setState({ theme: 'dark' });
    const v = render(<PressableScale testID="p" onPress={() => {}} />);
    fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} });
    expect(flat(v.getByTestId('press-state-layer')).backgroundColor).toBe(THEMES.dark.ink);
    expect(flat(v.getByTestId('press-state-layer')).opacity).toBeCloseTo(0.1, 5);
    expect(stateLayerFor('dark')).toEqual({ color: THEMES.dark.ink, alpha: 0.1 });
  });

  it('morphs a pill to radius 12 while pressed, and back on release', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(
      <PressableScale testID="p" onPress={() => {}} style={{ borderRadius: 999, height: 40 }} />,
    );
    act(() => {
      fireEvent(v.getByTestId('p'), 'layout', { nativeEvent: { layout: { height: 40, width: 120, x: 0, y: 0 } } });
    });
    expect(PILL_RADIUS_MIN).toBeLessThanOrEqual(999);
    expect(flat(v.getByTestId('p')).borderRadius).toBe(999);
    fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} });
    expect(flat(v.getByTestId('p')).borderRadius).toBe(PRESS.radius);
    fireEvent(v.getByTestId('p'), 'pressOut', { nativeEvent: {} });
    expect(flat(v.getByTestId('p')).borderRadius).toBe(999);
  });

  it('does not morph a card (radius below the pill threshold)', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<PressableScale testID="p" onPress={() => {}} style={{ borderRadius: 20 }} />);
    fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} });
    expect(flat(v.getByTestId('p')).borderRadius).toBe(20);
  });

  it('feedback="layer" keeps the state layer but never scales (big surfaces)', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<PressableScale testID="p" feedback="layer" onPress={() => {}} />);
    fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} });
    expect(scaleOf(v.getByTestId('p'))).toBe(1);
    expect(v.getByTestId('press-state-layer')).toBeTruthy();
  });

  it('gives no feedback when disabled, and does not fire onPress', () => {
    mockReducedMotion.mockReturnValue(true);
    const onPress = jest.fn();
    const v = render(<PressableScale testID="p" disabled onPress={onPress} />);
    fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} });
    expect(v.queryByTestId('press-state-layer')).toBeNull();
    fireEvent.press(v.getByTestId('p'));
    expect(onPress).not.toHaveBeenCalled();
    expect(v.getByTestId('p').props.accessibilityState).toEqual({ disabled: true });
  });

  it('keeps a caller transform and composes the press scale onto it', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(
      <PressableScale testID="p" onPress={() => {}} style={{ transform: [{ rotate: '45deg' }] }} />,
    );
    fireEvent(v.getByTestId('p'), 'pressIn', { nativeEvent: {} });
    const transform = flat(v.getByTestId('p')).transform as Record<string, unknown>[];
    expect(transform[0]).toEqual({ rotate: '45deg' });
    expect(scaleOf(v.getByTestId('p'))).toBeCloseTo(PRESS.scale, 5);
  });

  it('accepts a style function, like Pressable', () => {
    const v = render(
      <PressableScale testID="p" onPress={() => {}} style={({ pressed }) => ({ width: pressed ? 2 : 1 })} />,
    );
    expect(flat(v.getByTestId('p')).width).toBe(1);
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

  it('gets the v2 press feedback by default', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<TouchableOpacity testID="t" onPress={() => {}} activeOpacity={0.8} />);
    fireEvent(v.getByTestId('t'), 'pressIn', { nativeEvent: {} });
    expect(scaleOf(v.getByTestId('t'))).toBeCloseTo(PRESS.scale, 5);
    expect(v.getByTestId('press-state-layer')).toBeTruthy();
  });

  it('keeps activeOpacity={1} meaning "no feedback" (backdrops, full-screen taps)', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<TouchableOpacity testID="t" onPress={() => {}} activeOpacity={1} />);
    fireEvent(v.getByTestId('t'), 'pressIn', { nativeEvent: {} });
    expect(scaleOf(v.getByTestId('t'))).toBe(1);
    expect(v.queryByTestId('press-state-layer')).toBeNull();
  });
});
