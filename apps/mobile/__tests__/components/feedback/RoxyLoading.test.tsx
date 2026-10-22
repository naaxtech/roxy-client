/**
 * RoxyLoading (Wave 3 lane C0; polish/motion-spec.md §1.3 rule 7, budget F11,
 * decision P1): the M3 Expressive loading indicator made Roxy's — a faceless
 * pink O that morphs circle → pill → rounded square. Nothing under 200 ms;
 * once shown it stays ≥ 400 ms (no flicker); static under Reduce Motion.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

const mockReducedMotion = jest.fn(() => false);
jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion(),
}));

import { RoxyLoading, LOADING_SIZES } from '../../../components/feedback/RoxyLoading';
import { THEMES } from '../../../lib/theme';
import { WAIT } from '../../../lib/motion';
import { useThemeStore } from '../../../store/themeStore';

type Node = Parameters<typeof getAnimatedStyle>[0];
function painted(node: Node): Record<string, unknown> {
  const base = (StyleSheet.flatten((node as unknown as { props: { style?: unknown } }).props.style as never) ?? {}) as Record<string, unknown>;
  return { ...base, ...(getAnimatedStyle(node) as Record<string, unknown>) };
}
const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

beforeEach(() => {
  jest.useFakeTimers();
  mockReducedMotion.mockReturnValue(false);
  useThemeStore.setState({ theme: 'light' });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('F11 — single waits never flash', () => {
  it('is absent at 199 ms and present at 200 ms', () => {
    const v = render(<RoxyLoading active />);
    advance(WAIT.showAfterMs - 1);
    expect(v.queryByTestId('roxy-loading')).toBeNull();
    advance(1);
    expect(v.getByTestId('roxy-loading')).toBeTruthy();
  });

  it('never shows for a wait shorter than 200 ms', () => {
    const v = render(<RoxyLoading active />);
    advance(150);
    v.rerender(<RoxyLoading active={false} />);
    advance(1000);
    expect(v.queryByTestId('roxy-loading')).toBeNull();
  });

  it('once shown, is not unmounted before 400 ms even if the wait ends at once', () => {
    const v = render(<RoxyLoading active />);
    advance(WAIT.showAfterMs);
    expect(v.getByTestId('roxy-loading')).toBeTruthy();
    v.rerender(<RoxyLoading active={false} />);
    advance(WAIT.minShowMs - 1);
    expect(v.getByTestId('roxy-loading')).toBeTruthy();
    advance(1);
    expect(v.queryByTestId('roxy-loading')).toBeNull();
  });

  it('leaves at once when the wait ends after the 400 ms minimum', () => {
    const v = render(<RoxyLoading active />);
    advance(WAIT.showAfterMs + 900);
    v.rerender(<RoxyLoading active={false} />);
    advance(1);
    expect(v.queryByTestId('roxy-loading')).toBeNull();
  });

  it('a wait that resumes inside the minimum keeps the same indicator (no blink)', () => {
    const v = render(<RoxyLoading active />);
    advance(WAIT.showAfterMs);
    v.rerender(<RoxyLoading active={false} />);
    advance(100);
    v.rerender(<RoxyLoading active />);
    advance(1000);
    expect(v.getByTestId('roxy-loading')).toBeTruthy();
  });
});

describe('the faceless pink O (decision P1)', () => {
  it('is announced as one progressbar with a label', () => {
    const v = render(<RoxyLoading active />);
    advance(WAIT.showAfterMs);
    const n = v.getByTestId('roxy-loading');
    expect(n.props.accessibilityRole).toBe('progressbar');
    expect(n.props.accessibilityLabel).toBe('Loading');
  });

  it('draws a pink ring (no face) at the M3 sizes: 48 dp default with a 38 dp shape', () => {
    const v = render(<RoxyLoading active />);
    advance(WAIT.showAfterMs);
    expect(painted(v.getByTestId('roxy-loading'))).toMatchObject({ width: 48, height: 48 });
    const o = painted(v.getByTestId('roxy-loading-o'));
    expect(o).toMatchObject({ width: 38, height: 38, borderColor: THEMES.light.pink });
    expect(Number(o.borderWidth)).toBeGreaterThan(0);
    expect(v.queryByTestId('roxy-loading-o-open')).toBeNull();
    expect(LOADING_SIZES.default).toEqual({ box: 48, shape: 38 });
  });

  it('has a `busy` size for PrimaryButton', () => {
    const v = render(<RoxyLoading active size="busy" />);
    advance(WAIT.showAfterMs);
    const { box, shape } = LOADING_SIZES.busy;
    expect(painted(v.getByTestId('roxy-loading'))).toMatchObject({ width: box, height: box });
    expect(painted(v.getByTestId('roxy-loading-o'))).toMatchObject({ width: shape, height: shape });
    expect(shape).toBeLessThanOrEqual(24);
  });

  it('`contained` sits the O on a surface circle (over content, pull-to-refresh)', () => {
    const v = render(<RoxyLoading active contained />);
    advance(WAIT.showAfterMs);
    expect(painted(v.getByTestId('roxy-loading'))).toMatchObject({
      backgroundColor: THEMES.light.surface,
      borderRadius: 24,
    });
  });

  it('morphs: the O changes shape over a cycle (radius / squash)', () => {
    const v = render(<RoxyLoading active />);
    advance(WAIT.showAfterMs + 16);
    const a = JSON.stringify(painted(v.getByTestId('roxy-loading-o')));
    advance(300);
    const b = JSON.stringify(painted(v.getByTestId('roxy-loading-o')));
    expect(b).not.toEqual(a);
  });

  it('is a static circle under Reduce Motion (F12)', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<RoxyLoading active />);
    advance(WAIT.showAfterMs + 16);
    const a = painted(v.getByTestId('roxy-loading-o'));
    advance(300);
    const b = painted(v.getByTestId('roxy-loading-o'));
    expect(b).toEqual(a);
    expect(b.borderRadius).toBe(19);
  });

  it('`delay={false}` shows at once (a wait already known to be long, e.g. refresh in progress)', () => {
    const v = render(<RoxyLoading active delay={false} />);
    expect(v.getByTestId('roxy-loading')).toBeTruthy();
  });
});
