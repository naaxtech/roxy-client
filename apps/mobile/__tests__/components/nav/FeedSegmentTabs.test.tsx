/**
 * The Feed's segment tabs (For You · Following · Communities) with an
 * underline that slides and resizes to the chosen word (motion spec §3.1
 * row 3: `fastSpatial`; Reduce Motion: the underline jumps). The label weight
 * switches at once (text never animates). Layout, colours and copy are the
 * ones `components/feed/FeedSegments.tsx` drew; only the underline moves.
 */
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockReduced = jest.fn(() => false);
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced() }));

const mockWebSpring = jest.fn();
jest.mock('../../../components/motion/webSpring', () => ({
  startWebSpring: (...args: unknown[]) => mockWebSpring(...args),
}));

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

import { FeedSegmentTabs, UNDERLINE_BASE } from '../../../components/nav/FeedSegmentTabs';
import { STAGE } from '../../../components/feed/stageColors';
import { SPRING } from '../../../lib/motion';

const { __calls: calls } = jest.requireMock('react-native-reanimated') as {
  __calls: { kind: string; toValue: unknown; config: unknown }[];
};
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const transformOf = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...((flat(node).transform ?? []) as Record<string, unknown>[]));

/** Tab x/width in the row, and the rule's place inside its tab. */
const TABS = { foryou: { x: 40, w: 70 }, following: { x: 128, w: 82 }, communities: { x: 228, w: 120 } };
function layOut(utils: ReturnType<typeof render>) {
  for (const [key, { x, w }] of Object.entries(TABS)) {
    fireEvent(utils.getByTestId(`feed-segment-${key}`), 'layout', {
      nativeEvent: { layout: { x, y: 0, width: w, height: 48 } },
    });
    fireEvent(utils.getByTestId(`feed-segment-rule-${key}`), 'layout', {
      nativeEvent: { layout: { x: 4, y: 36, width: w - 8, height: 2 } },
    });
  }
}

beforeEach(() => {
  calls.length = 0;
  mockWebSpring.mockClear();
  mockReduced.mockReturnValue(false);
});

describe('FeedSegmentTabs', () => {
  it('draws the three segments as tabs, the chosen one selected and emphasised', () => {
    const { getByTestId, getByText } = render(<FeedSegmentTabs value="following" onChange={jest.fn()} />);
    expect(getByTestId('feed-segments').props.accessibilityRole).toBe('tablist');
    expect(getByTestId('feed-segment-following').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('feed-segment-foryou').props.accessibilityState).toEqual({ selected: false });
    expect(flat(getByText('Following')).fontWeight).toBe('700');
    expect(flat(getByText('Following')).color).toBe(STAGE.textPrimary);
    expect(flat(getByText('For You')).fontWeight).toBe('600');
    expect(flat(getByText('For You')).color).toBe(STAGE.textSecondary);
  });

  it('before it can measure, the chosen tab keeps its own rule (never a frame without one)', () => {
    const { getByTestId } = render(<FeedSegmentTabs value="foryou" onChange={jest.fn()} />);
    expect(flat(getByTestId('feed-segment-rule-foryou')).backgroundColor).toBe(STAGE.primaryInk);
    expect(flat(getByTestId('feed-segment-underline')).opacity).toBe(0);
  });

  it('once measured, one underline sits exactly on the chosen rule', () => {
    const utils = render(<FeedSegmentTabs value="foryou" onChange={jest.fn()} />);
    layOut(utils);
    const line = utils.getByTestId('feed-segment-underline');
    expect(flat(line).opacity).toBe(1);
    expect(flat(line).top).toBe(36);
    expect(flat(line).backgroundColor).toBe(STAGE.primaryInk);
    // Base width scaled to the rule's width, centred on the rule.
    const w = TABS.foryou.w - 8;
    const left = TABS.foryou.x + 4;
    expect(transformOf(line).scaleX).toBeCloseTo(w / UNDERLINE_BASE, 5);
    expect(transformOf(line).translateX).toBeCloseTo(left + w / 2 - UNDERLINE_BASE / 2, 5);
    expect(flat(utils.getByTestId('feed-segment-rule-foryou')).backgroundColor).toBe('transparent');
  });

  it('slides and resizes to the chosen word on fastSpatial', () => {
    const utils = render(<FeedSegmentTabs value="foryou" onChange={jest.fn()} />);
    layOut(utils);
    calls.length = 0;
    utils.rerender(<FeedSegmentTabs value="communities" onChange={jest.fn()} />);
    const left = TABS.communities.x + 4;
    const w = TABS.communities.w - 8;
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'spring', toValue: left, config: expect.objectContaining(SPRING.fastSpatial) }),
      expect.objectContaining({ kind: 'spring', toValue: w, config: expect.objectContaining(SPRING.fastSpatial) }),
    ]));
  });

  it('reports the press; the parent owns the value', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<FeedSegmentTabs value="foryou" onChange={onChange} />);
    fireEvent.press(getByTestId('feed-segment-communities'));
    expect(onChange).toHaveBeenCalledWith('communities');
  });

  it('Reduce Motion: the underline jumps', () => {
    mockReduced.mockReturnValue(true);
    const utils = render(<FeedSegmentTabs value="foryou" onChange={jest.fn()} />);
    layOut(utils);
    calls.length = 0;
    utils.rerender(<FeedSegmentTabs value="following" onChange={jest.fn()} />);
    expect(calls).toEqual([]);
    const line = utils.getByTestId('feed-segment-underline');
    const w = TABS.following.w - 8;
    expect(transformOf(line).scaleX).toBeCloseTo(w / UNDERLINE_BASE, 5);
  });

  describe('on the web', () => {
    const originalOS = Platform.OS;
    beforeEach(() => Object.defineProperty(Platform, 'OS', { value: 'web' }));
    afterEach(() => Object.defineProperty(Platform, 'OS', { value: originalOS }));

    it('slides on the compositor (WAAPI, fastSpatial), not a main-thread spring', () => {
      const utils = render(<FeedSegmentTabs value="foryou" onChange={jest.fn()} />);
      act(() => layOut(utils));
      calls.length = 0;
      utils.rerender(<FeedSegmentTabs value="following" onChange={jest.fn()} />);
      expect(mockWebSpring).toHaveBeenCalledTimes(1);
      const [, keyframes, token] = mockWebSpring.mock.calls[0];
      expect(token).toBe(SPRING.fastSpatial);
      const w = TABS.following.w - 8;
      const left = TABS.following.x + 4;
      expect((keyframes as { transform: string }[])[1].transform).toBe(
        `translateX(${left + w / 2 - UNDERLINE_BASE / 2}px) scaleX(${w / UNDERLINE_BASE})`,
      );
      expect(calls.filter((c) => c.kind === 'spring')).toEqual([]);
    });
  });
});
