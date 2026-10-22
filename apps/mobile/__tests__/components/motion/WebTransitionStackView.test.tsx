/**
 * The web stack view behind TransitionStack (motion spec §3.1 row 5, F3).
 *
 * React Navigation's web native-stack keeps every screen mounted and shows
 * only the top one (`display: none` for the rest), so a push or pop was a jump
 * cut. This view renders the same screens, but:
 *  - a pushed screen ENTERS (ScreenTransition) over the screen it covers,
 *    which stays visible underneath until the enter has settled;
 *  - a popped screen is kept for its EXIT, above the screen it reveals, and
 *    is dropped afterwards; it takes no touches while it leaves;
 *  - a back press mid-push turns the entering screen around (it becomes the
 *    exiting one, from wherever it is), and nothing is left half-faded;
 *  - the first screen and a `replace` are simply there.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, render, within } from '@testing-library/react-native';

jest.mock('@react-navigation/elements', () => {
  const { View } = require('react-native');
  return {
    Screen: ({ children, style }: { children: React.ReactNode; style?: unknown }) => (
      <View style={style}>{children}</View>
    ),
    SafeAreaProviderCompat: ({ children }: { children: React.ReactNode }) => children,
  };
});

const mockPhases: { key: string; phase: string; kind: string; animate: boolean }[] = [];
jest.mock('../../../components/motion/ScreenTransition', () => {
  const { View } = require('react-native');
  return {
    ScreenTransition: (p: {
      phase: string; kind: string; animate: boolean; children: React.ReactNode;
      style?: unknown; testID?: string; nativeID?: string;
    }) => {
      mockPhases.push({ key: String(p.nativeID).replace('screen-', ''), phase: p.phase, kind: p.kind, animate: p.animate });
      return (
        <View testID={p.testID} style={p.style} pointerEvents={p.phase === 'exit' ? 'none' : 'auto'}>
          {p.children}
        </View>
      );
    },
  };
});

import {
  WebTransitionStackView, ENTER_HOLD_MS, EXIT_HOLD_MS,
} from '../../../components/motion/WebTransitionStackView';

type Route = { key: string; name: string };
const R: Record<string, Route> = {
  a: { key: 'a', name: 'index' },
  b: { key: 'b', name: 'post' },
  c: { key: 'c', name: 'settings' },
  m: { key: 'm', name: 'note' },
};
const descriptorFor = (route: Route, options: Record<string, unknown> = {}) => ({
  route,
  navigation: {},
  options,
  render: () => <Text>{`screen ${route.key}`}</Text>,
});
const DESCRIPTORS = {
  a: descriptorFor(R.a),
  b: descriptorFor(R.b),
  c: descriptorFor(R.c),
  m: descriptorFor(R.m, { presentation: 'modal' }),
};
const stateOf = (keys: string[]) => ({
  key: 'stack-1',
  index: keys.length - 1,
  routes: keys.map((k) => R[k]),
  routeNames: ['index', 'post', 'settings', 'note'],
  type: 'stack' as const,
  stale: false as const,
});

function view(keys: string[]) {
  return (
    <WebTransitionStackView
      state={stateOf(keys) as never}
      descriptors={DESCRIPTORS as never}
      navigation={{} as never}
    />
  );
}

/** Each rendered layer: its route key, display, and whether it takes touches. */
function layers(utils: ReturnType<typeof render>) {
  return utils.queryAllByTestId('screen-transition', { includeHiddenElements: true }).map((node) => {
    const key = ['a', 'b', 'c', 'm'].find((k) => within(node).queryByText(`screen ${k}`, { includeHiddenElements: true })) ?? '?';
    const style = StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
    return { key, display: style.display ?? 'flex', touches: node.props.pointerEvents !== 'none' };
  });
}

const lastPhase = (key: string) => [...mockPhases].reverse().find((p) => p.key === key);

beforeEach(() => {
  jest.useFakeTimers();
  mockPhases.length = 0;
});
afterEach(() => jest.useRealTimers());

describe('WebTransitionStackView', () => {
  it('shows the first screen as simply there', () => {
    const utils = render(view(['a']));
    expect(layers(utils)).toEqual([{ key: 'a', display: 'flex', touches: true }]);
    expect(lastPhase('a')).toEqual(expect.objectContaining({ animate: false }));
  });

  it('a push enters over the covered screen, which stays visible until the enter settles', () => {
    const utils = render(view(['a']));
    utils.rerender(view(['a', 'b']));
    expect(lastPhase('b')).toEqual({ key: 'b', phase: 'enter', kind: 'push', animate: true });
    expect(layers(utils)).toEqual([
      { key: 'a', display: 'flex', touches: true },
      { key: 'b', display: 'flex', touches: true },
    ]);

    act(() => { jest.advanceTimersByTime(ENTER_HOLD_MS); });
    expect(layers(utils)).toEqual([
      { key: 'a', display: 'none', touches: true },
      { key: 'b', display: 'flex', touches: true },
    ]);
  });

  it('a modal route enters as a modal', () => {
    const utils = render(view(['a']));
    utils.rerender(view(['a', 'm']));
    expect(lastPhase('m')).toEqual(expect.objectContaining({ phase: 'enter', kind: 'modal', animate: true }));
  });

  it('a pop keeps the leaving screen for its exit, above the revealed one, then drops it', () => {
    const utils = render(view(['a', 'b']));
    act(() => { jest.advanceTimersByTime(ENTER_HOLD_MS); });
    utils.rerender(view(['a']));
    expect(lastPhase('b')).toEqual(expect.objectContaining({ phase: 'exit' }));
    expect(layers(utils)).toEqual([
      { key: 'a', display: 'flex', touches: true },
      { key: 'b', display: 'flex', touches: false },
    ]);

    act(() => { jest.advanceTimersByTime(EXIT_HOLD_MS); });
    expect(layers(utils)).toEqual([{ key: 'a', display: 'flex', touches: true }]);
  });

  it('a back press mid-push turns the entering screen around and leaves nothing half-faded', () => {
    const utils = render(view(['a']));
    utils.rerender(view(['a', 'b']));
    act(() => { jest.advanceTimersByTime(100); });
    utils.rerender(view(['a']));
    expect(lastPhase('b')).toEqual(expect.objectContaining({ phase: 'exit' }));
    expect(layers(utils)).toEqual([
      { key: 'a', display: 'flex', touches: true },
      { key: 'b', display: 'flex', touches: false },
    ]);

    act(() => { jest.advanceTimersByTime(Math.max(ENTER_HOLD_MS, EXIT_HOLD_MS)); });
    expect(layers(utils)).toEqual([{ key: 'a', display: 'flex', touches: true }]);
    // The revealed screen was never asked to animate: it is simply there.
    expect(mockPhases.filter((p) => p.key === 'a').every((p) => p.phase !== 'exit')).toBe(true);
  });

  it('pushing again before an exit finishes keeps both moves independent', () => {
    const utils = render(view(['a', 'b']));
    act(() => { jest.advanceTimersByTime(ENTER_HOLD_MS); });
    utils.rerender(view(['a']));
    utils.rerender(view(['a', 'c']));
    expect(lastPhase('b')).toEqual(expect.objectContaining({ phase: 'exit' }));
    expect(lastPhase('c')).toEqual(expect.objectContaining({ phase: 'enter', animate: true }));
    act(() => { jest.advanceTimersByTime(Math.max(ENTER_HOLD_MS, EXIT_HOLD_MS)); });
    expect(layers(utils)).toEqual([
      { key: 'a', display: 'none', touches: true },
      { key: 'c', display: 'flex', touches: true },
    ]);
  });

  it('a replace (redirect) is simply there: no enter, no exit', () => {
    const utils = render(view(['a']));
    utils.rerender(view(['c']));
    expect(lastPhase('c')).toEqual(expect.objectContaining({ animate: false }));
    expect(layers(utils)).toEqual([{ key: 'c', display: 'flex', touches: true }]);
  });
});
