/**
 * RoxyRefresh (Wave 3 lane C0; polish/motion-spec.md §1.3 rule 7, §3.1 row 7;
 * decision P1, P3). Pull-to-refresh that works on the installed app AND on
 * roxy.expo.app (react-native-web's RefreshControl renders an empty View).
 *
 * Native: the system RefreshControl tinted with theme tokens (the snap pager
 * keeps it too). Web: a touch pull that tracks 1:1 to the 72 dp threshold and
 * rubber-bands past it, with the faceless O; the threshold calls
 * `onThreshold` once per pull (Lane E wires the `selection` tick there);
 * releasing past it refreshes; reversing below it before release cancels; the
 * O stays until `refreshing` goes false (≥ 400 ms, no flicker).
 */
import React from 'react';
import { Platform, RefreshControl, StyleSheet, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));

import { RoxyRefresh, createPullController, pullDistance } from '../../../components/feedback/RoxyRefresh';
import { GESTURE, WAIT } from '../../../lib/motion';
import { THEMES } from '../../../lib/theme';
import { useThemeStore } from '../../../store/themeStore';

const T = GESTURE.refreshThresholdDp;
const originalOS = Platform.OS;
type Node = Parameters<typeof getAnimatedStyle>[0];
function painted(node: Node): Record<string, unknown> {
  const base = (StyleSheet.flatten((node as unknown as { props: { style?: unknown } }).props.style as never) ?? {}) as Record<string, unknown>;
  return { ...base, ...(getAnimatedStyle(node) as Record<string, unknown>) };
}
const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

beforeEach(() => {
  jest.useFakeTimers();
  useThemeStore.setState({ theme: 'light' });
});
afterEach(() => {
  jest.useRealTimers();
  Platform.OS = originalOS;
});

describe('native: the system control, tinted', () => {
  it('hands the list a RefreshControl in pink; a refresh ticks the threshold hook then refreshes', () => {
    Platform.OS = 'android';
    const onRefresh = jest.fn();
    const onThreshold = jest.fn();
    let control: React.ReactElement | undefined;
    render(
      <RoxyRefresh refreshing={false} onRefresh={onRefresh} onThreshold={onThreshold}>
        {(rc) => {
          control = rc;
          return <Text>list</Text>;
        }}
      </RoxyRefresh>,
    );
    expect(control?.type).toBe(RefreshControl);
    expect(control?.props.colors).toEqual([THEMES.light.pink]);
    expect(control?.props.tintColor).toBe(THEMES.light.pink);
    expect(control?.props.progressBackgroundColor).toBe(THEMES.light.surface);
    act(() => { control?.props.onRefresh(); });
    expect(onThreshold).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onThreshold.mock.invocationCallOrder[0]).toBeLessThan(onRefresh.mock.invocationCallOrder[0]);
  });
});

describe('pullDistance: 1:1 to the threshold, rubber band past it', () => {
  it('tracks the finger exactly up to 72 dp', () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(40)).toBe(40);
    expect(pullDistance(T)).toBe(T);
  });
  it('resists past it and never runs away', () => {
    expect(pullDistance(T + 60)).toBeGreaterThan(T);
    expect(pullDistance(T + 60)).toBeLessThan(T + 60);
    expect(pullDistance(T + 10000)).toBeLessThanOrEqual(2 * T);
  });
});

describe('web pull controller', () => {
  function make() {
    const onPull = jest.fn();
    const onThreshold = jest.fn();
    const onRelease = jest.fn();
    const c = createPullController({ onPull, onThreshold, onRelease });
    return { c, onPull, onThreshold, onRelease };
  }

  it('does nothing unless the list is at the top', () => {
    const { c, onPull, onRelease } = make();
    c.start(100, false);
    expect(c.move(200, false)).toBe(false);
    c.end();
    expect(onPull).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('a pull down at the top is consumed (no browser overscroll / reload) and tracked 1:1', () => {
    const { c, onPull } = make();
    c.start(100, true);
    expect(c.move(130, true)).toBe(true);
    expect(onPull).toHaveBeenLastCalledWith(30);
  });

  it('scrolling up from the top is left to the list', () => {
    const { c, onPull } = make();
    c.start(100, true);
    expect(c.move(60, true)).toBe(false);
    expect(onPull).not.toHaveBeenCalled();
  });

  it('crossing the threshold calls onThreshold ONCE per pull, even when crossed again', () => {
    const { c, onThreshold } = make();
    c.start(0, true);
    c.move(T - 1, true);
    expect(onThreshold).not.toHaveBeenCalled();
    c.move(T + 5, true);
    c.move(T - 10, true);
    c.move(T + 20, true);
    expect(onThreshold).toHaveBeenCalledTimes(1);
  });

  it('releasing past the threshold refreshes', () => {
    const { c, onRelease } = make();
    c.start(0, true);
    c.move(T + 30, true);
    c.end();
    expect(onRelease).toHaveBeenCalledWith(true);
  });

  it('reversing below the threshold before release cancels', () => {
    const { c, onRelease } = make();
    c.start(0, true);
    c.move(T + 30, true);
    c.move(T - 20, true);
    c.end();
    expect(onRelease).toHaveBeenCalledWith(false);
  });

  it('a new pull ticks again', () => {
    const { c, onThreshold } = make();
    c.start(0, true);
    c.move(T + 1, true);
    c.end();
    c.start(0, true);
    c.move(T + 1, true);
    expect(onThreshold).toHaveBeenCalledTimes(2);
  });
});

describe('web: the faceless O', () => {
  it('wraps the list, gives it no RefreshControl, and keeps the O hidden at rest', () => {
    Platform.OS = 'web';
    let control: unknown = 'unset';
    const v = render(
      <RoxyRefresh refreshing={false} onRefresh={() => {}} testID="inbox-refresh">
        {(rc) => {
          control = rc;
          return <Text>list</Text>;
        }}
      </RoxyRefresh>,
    );
    expect(control).toBeUndefined();
    expect(v.getByTestId('inbox-refresh')).toBeTruthy();
    expect(Number(painted(v.getByTestId('inbox-refresh-indicator', { includeHiddenElements: true })).opacity)).toBe(0);
  });

  // Lane D request (Wave 3 merge): the idle O stays mounted (opacity 0) so a
  // pull can grow it without a render, but an idle progressbar must not be
  // announced, or counted as a loader on every visit of a list that adopts it.
  it('hides the idle O from accessibility, and exposes it while refreshing', () => {
    Platform.OS = 'web';
    const v = render(
      <RoxyRefresh refreshing={false} onRefresh={() => {}} testID="r">
        {() => <Text>list</Text>}
      </RoxyRefresh>,
    );
    expect(v.queryByTestId('r-indicator')).toBeNull();
    expect(v.queryByRole('progressbar')).toBeNull();
    expect(v.getByTestId('r-indicator', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
    v.rerender(
      <RoxyRefresh refreshing onRefresh={() => {}} testID="r">
        {() => <Text>list</Text>}
      </RoxyRefresh>,
    );
    advance(16);
    expect(v.getByTestId('r-indicator')).toBeTruthy();
    expect(v.getByTestId('r-indicator').props['aria-hidden']).toBe(false);
  });

  it('shows the O while refreshing and keeps it ≥ 400 ms even if the refresh ends at once', () => {
    Platform.OS = 'web';
    const v = render(
      <RoxyRefresh refreshing onRefresh={() => {}} testID="r">
        {() => <Text>list</Text>}
      </RoxyRefresh>,
    );
    // Once it pops out it is hidden from accessibility again (still mounted).
    const ind = () => v.getByTestId('r-indicator', { includeHiddenElements: true });
    advance(300);
    expect(Number(painted(ind()).opacity)).toBe(1);
    expect(v.getByTestId('r-indicator-o')).toBeTruthy();
    v.rerender(
      <RoxyRefresh refreshing={false} onRefresh={() => {}} testID="r">
        {() => <Text>list</Text>}
      </RoxyRefresh>,
    );
    advance(WAIT.minShowMs - 320);
    expect(Number(painted(ind()).opacity)).toBe(1);
    // Pops out once, never bounces back into view on the way.
    let back = false;
    let last = 1;
    for (let i = 0; i < 50; i += 1) {
      advance(16);
      const o = Number(painted(ind()).opacity);
      if (o > last + 0.01) back = true;
      last = o;
    }
    expect(back).toBe(false);
    expect(last).toBeLessThan(0.02);
    advance(400);
    expect(Number(painted(ind()).opacity)).toBe(0);
  });
});
