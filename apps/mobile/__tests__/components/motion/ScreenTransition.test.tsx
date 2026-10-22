/**
 * ScreenTransition (motion spec §3.1 row 5, budgets F3/F12): the web build's
 * push/pop/modal motion. Native-stack on web only toggled `display`, so every
 * screen change on roxy.expo.app was a jump cut while the app slid.
 *
 * Enter (push): translateX 32 dp → 0 on `calm` + opacity 0 → 1 on `effects`.
 * Modal routes rise 48 dp instead. Exit (pop) is the same move reversed, from
 * wherever the screen is (springs retarget from the current value, so a back
 * press mid-push turns around). RTL mirrors x. Reduce Motion: opacity only,
 * a 120 ms fade, nothing moves.
 */
import React from 'react';
import { I18nManager, StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';

const mockReduced = jest.fn(() => false);
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced() }));

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  const ReactLocal = require('react');
  const calls: { kind: string; toValue: unknown; config: unknown }[] = [];
  const record = (kind: string) => (toValue: unknown, config?: unknown) => {
    calls.push({ kind, toValue, config });
    return toValue;
  };
  return {
    ...actual,
    __esModule: true,
    default: actual.default,
    useSharedValue: (init: unknown) => ReactLocal.useRef({ value: init }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(),
    withSpring: record('spring'),
    withTiming: record('timing'),
    __calls: calls,
  };
});

import { ScreenTransition } from '../../../components/motion/ScreenTransition';
import { SPRING } from '../../../lib/motion';

const { __calls: calls } = jest.requireMock('react-native-reanimated') as {
  __calls: { kind: string; toValue: unknown; config: unknown }[];
};

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const transformOf = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...((flat(node).transform ?? []) as Record<string, unknown>[]));
const spring = (toValue: number, token: keyof typeof SPRING) =>
  expect.objectContaining({ kind: 'spring', toValue, config: expect.objectContaining(SPRING[token]) });

const screen = (props: Partial<React.ComponentProps<typeof ScreenTransition>> = {}) => (
  <ScreenTransition phase="enter" kind="push" animate testID="st" {...props}>
    <Text>screen</Text>
  </ScreenTransition>
);

beforeEach(() => {
  calls.length = 0;
  mockReduced.mockReturnValue(false);
  I18nManager.isRTL = false;
});

describe('ScreenTransition — push', () => {
  it('enters from 32 dp to the end side, transparent, in its first frame', () => {
    const { getByTestId } = render(screen());
    expect(transformOf(getByTestId('st'))).toEqual(expect.objectContaining({ translateX: 32, translateY: 0 }));
    expect(flat(getByTestId('st')).opacity).toBe(0);
  });

  it('springs x home on calm and opacity in on effects', () => {
    render(screen());
    expect(calls).toEqual(expect.arrayContaining([spring(0, 'calm'), spring(1, 'effects')]));
    expect(calls).toHaveLength(2);
  });

  it('mirrors the slide in a right-to-left layout', () => {
    I18nManager.isRTL = true;
    const { getByTestId } = render(screen());
    expect(transformOf(getByTestId('st')).translateX).toBe(-32);
  });

  it('exits as the enter reversed: x back out on calm, opacity on fastEffects, and stops taking touches', () => {
    const { getByTestId, rerender } = render(screen());
    calls.length = 0;
    rerender(screen({ phase: 'exit' }));
    expect(calls).toEqual(expect.arrayContaining([spring(32, 'calm'), spring(0, 'fastEffects')]));
    expect(getByTestId('st').props.pointerEvents).toBe('none');
  });

  it('a screen that is already there (first screen of a stack) does not animate', () => {
    const { getByTestId } = render(screen({ phase: 'idle', animate: false }));
    expect(transformOf(getByTestId('st'))).toEqual(expect.objectContaining({ translateX: 0, translateY: 0 }));
    expect(flat(getByTestId('st')).opacity).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe('ScreenTransition — modal routes', () => {
  it('rise 48 dp from the bottom edge while they fade in', () => {
    const { getByTestId } = render(screen({ kind: 'modal' }));
    expect(transformOf(getByTestId('st'))).toEqual(expect.objectContaining({ translateX: 0, translateY: 48 }));
    expect(calls).toEqual(expect.arrayContaining([spring(0, 'calm'), spring(1, 'effects')]));
  });
});

describe('ScreenTransition — Reduce Motion', () => {
  it('enters with a 120 ms fade and no movement', () => {
    mockReduced.mockReturnValue(true);
    const { getByTestId } = render(screen());
    expect(transformOf(getByTestId('st'))).toEqual(expect.objectContaining({ translateX: 0, translateY: 0 }));
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'timing', toValue: 1, config: expect.objectContaining({ duration: 120 }) }),
    ]);
  });

  it('exits with a 120 ms fade and no movement', () => {
    mockReduced.mockReturnValue(true);
    const { rerender } = render(screen());
    calls.length = 0;
    rerender(screen({ phase: 'exit' }));
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'timing', toValue: 0, config: expect.objectContaining({ duration: 120 }) }),
    ]);
  });
});
