/**
 * Skeleton (Wave 3 lane C0, polish/motion-spec.md §3.1 row 9, budgets F8/F12).
 *
 * Final-geometry placeholders on theme tokens; ONE shared pulse clock for
 * every block (opacity 1 ↔ 0.55, 700 ms each way, UI thread); static under
 * Reduce Motion. Content replaces it through `FadeIn` (fastEffects, ≥ 2
 * frames and ≤ 150 ms; Reduce Motion 120 ms fade; `instant` when cached).
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

const mockReducedMotion = jest.fn(() => false);
jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion(),
}));

import { FadeIn, Skeleton, SkeletonGroup } from '../../../components/feedback/Skeleton';
import { RADII, THEMES } from '../../../lib/theme';
import { SKELETON } from '../../../lib/motion';
import { useThemeStore } from '../../../store/themeStore';

type Node = Parameters<typeof getAnimatedStyle>[0];
function painted(node: Node): Record<string, unknown> {
  const base = (StyleSheet.flatten((node as unknown as { props: { style?: unknown } }).props.style as never) ?? {}) as Record<string, unknown>;
  return { ...base, ...(getAnimatedStyle(node) as Record<string, unknown>) };
}
/** Blocks are hidden from assistive tech, so queries must include hidden elements. */
const HIDDEN = { includeHiddenElements: true } as const;
const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

beforeEach(() => {
  jest.useFakeTimers();
  mockReducedMotion.mockReturnValue(false);
  useThemeStore.setState({ theme: 'light' });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('Skeleton block', () => {
  it('paints the final geometry in `raised` (the skeleton token), radius sm by default', () => {
    const v = render(<Skeleton testID="b" width={120} height={14} />);
    expect(painted(v.getByTestId('b', HIDDEN))).toMatchObject({
      width: 120,
      height: 14,
      borderRadius: RADII.sm,
      backgroundColor: THEMES.light.raised,
    });
  });

  it('`circle` draws an avatar placeholder of that diameter', () => {
    const v = render(<Skeleton testID="b" circle={40} />);
    expect(painted(v.getByTestId('b', HIDDEN))).toMatchObject({ width: 40, height: 40, borderRadius: 20 });
  });

  it('is hidden from screen readers (the group announces the wait)', () => {
    const v = render(<Skeleton testID="b" width={10} height={10} />);
    const b = v.getByTestId('b', HIDDEN);
    expect(b.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(b.props.accessibilityElementsHidden).toBe(true);
  });

  it('pulses 1 → 0.55 → 1 on one 700 ms half-cycle clock shared by every block', () => {
    const v = render(
      <>
        <Skeleton testID="a" width={10} height={10} />
        <Skeleton testID="b" width={10} height={10} />
      </>,
    );
    advance(16);
    expect(Number(painted(v.getByTestId('a', HIDDEN)).opacity)).toBeGreaterThan(0.95);
    advance(SKELETON.halfMs);
    const low = Number(painted(v.getByTestId('a', HIDDEN)).opacity);
    expect(low).toBeCloseTo(SKELETON.low, 1);
    expect(Number(painted(v.getByTestId('b', HIDDEN)).opacity)).toBe(low);
    advance(SKELETON.halfMs);
    expect(Number(painted(v.getByTestId('a', HIDDEN)).opacity)).toBeGreaterThan(0.95);
  });

  it('is static under Reduce Motion (F12: loops stop)', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<Skeleton testID="a" width={10} height={10} />);
    advance(SKELETON.halfMs);
    expect(Number(painted(v.getByTestId('a', HIDDEN)).opacity ?? 1)).toBe(1);
    advance(SKELETON.halfMs / 2);
    expect(Number(painted(v.getByTestId('a', HIDDEN)).opacity ?? 1)).toBe(1);
  });
});

describe('SkeletonGroup', () => {
  it('announces one wait (progressbar + label) and carries the screen\'s loading testID', () => {
    const v = render(
      <SkeletonGroup testID="inbox-loading">
        <Skeleton width={10} height={10} />
      </SkeletonGroup>,
    );
    const g = v.getByTestId('inbox-loading');
    expect(g.props.accessibilityRole).toBe('progressbar');
    expect(g.props.accessibilityLabel).toBe('Loading');
    expect(g.props.accessibilityState).toEqual({ busy: true });
  });
});

describe('FadeIn (content over the skeleton)', () => {
  it('fades content in on fastEffects: under 2 frames it is still rising, by 150 ms it is in', () => {
    const v = render(<FadeIn testID="c"><Text>Hi</Text></FadeIn>);
    advance(16);
    const early = Number(painted(v.getByTestId('c')).opacity);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1);
    advance(134);
    expect(Number(painted(v.getByTestId('c')).opacity)).toBeGreaterThan(0.98);
  });

  it('never moves content (opacity only: no translate, no scale, no stagger)', () => {
    const v = render(<FadeIn testID="c"><Text>Hi</Text></FadeIn>);
    advance(40);
    expect(painted(v.getByTestId('c')).transform).toBeUndefined();
  });

  it('`instant` shows cached content with no fade', () => {
    const v = render(<FadeIn testID="c" instant><Text>Hi</Text></FadeIn>);
    expect(Number(painted(v.getByTestId('c')).opacity)).toBe(1);
  });

  it('Reduce Motion: a 120 ms fade', () => {
    mockReducedMotion.mockReturnValue(true);
    const v = render(<FadeIn testID="c"><Text>Hi</Text></FadeIn>);
    advance(60);
    const mid = Number(painted(v.getByTestId('c')).opacity);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    advance(80);
    expect(Number(painted(v.getByTestId('c')).opacity)).toBe(1);
  });
});
