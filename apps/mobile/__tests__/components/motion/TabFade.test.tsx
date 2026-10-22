/**
 * TabFade (motion spec §3.1 row 4, budget F4, F12; M3 "top level" pattern):
 * a tab switch paints the new tab's ground in frame 1 and fades only its
 * CONTENT in on `SPRING.effects` (~170 ms, no overshoot). No slide, no scale,
 * nothing that moves layout. Reduce Motion: the content is simply there.
 *
 * "Selected" is this tab being the Tabs navigator's active route, not screen
 * focus: a root screen pushed over the tabs (a community, a chat) blurs the tab
 * without changing tabs, and popping back must reveal the tab as it was, not a
 * blank ground fading in under the leaving screen.
 */
import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';

let mockActiveKey = 'discover-1';
const mockOwnKey = 'discover-1';
jest.mock('@react-navigation/native', () => ({
  useNavigationState: (sel: (s: unknown) => unknown) =>
    sel({ index: 0, routes: [{ key: mockActiveKey, name: 'x' }] }),
  useRoute: () => ({ key: mockOwnKey, name: 'discover' }),
}));

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

import { TabFade } from '../../../components/motion/TabFade';
import { SPRING } from '../../../lib/motion';

const { __calls: calls } = jest.requireMock('react-native-reanimated') as {
  __calls: { kind: string; toValue: unknown; config: unknown }[];
};

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

const tree = () => (
  <TabFade ground="#141113" testID="tab-fade">
    <Text>content</Text>
  </TabFade>
);

beforeEach(() => {
  calls.length = 0;
  mockActiveKey = 'discover-1';
  mockReduced.mockReturnValue(false);
});

describe('TabFade', () => {
  it("paints the tab's ground under content that starts transparent (frame 1 = ground)", () => {
    const { getByTestId } = render(tree());
    expect(flat(getByTestId('tab-fade')).backgroundColor).toBe('#141113');
    expect(flat(getByTestId('tab-fade-content')).opacity).toBe(0);
  });

  it('fades the content in on SPRING.effects (an effects spring: opacity never overshoots)', () => {
    render(tree());
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'spring', toValue: 1, config: expect.objectContaining(SPRING.effects) }),
    ]);
  });

  it('moves nothing: the content layer animates opacity only, the ground nothing', () => {
    const { getByTestId } = render(tree());
    const content = flat(getByTestId('tab-fade-content'));
    expect(content.transform).toBeUndefined();
    expect(Object.keys(content).filter((k) => !['flex', 'opacity'].includes(k))).toEqual([]);
  });

  it('drops to transparent while another tab is selected, so the next visit starts on ground', () => {
    const { getByTestId, rerender } = render(tree());
    mockActiveKey = 'feed-1';
    calls.length = 0;
    rerender(tree());
    rerender(tree());
    expect(flat(getByTestId('tab-fade-content')).opacity).toBe(0);
    // Hidden anyway: no animation is spent on the way out.
    expect(calls).toEqual([]);

    mockActiveKey = 'discover-1';
    rerender(tree());
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'spring', toValue: 1, config: expect.objectContaining(SPRING.effects) }),
    ]);
  });

  it('Reduce Motion: the content is simply there, no fade starts', () => {
    mockReduced.mockReturnValue(true);
    const { getByTestId } = render(tree());
    expect(flat(getByTestId('tab-fade-content')).opacity).toBe(1);
    expect(calls).toEqual([]);
  });
});

/**
 * On the web the fade runs as a compositor animation (WAAPI) with the effects
 * curve: reanimated's main-thread spring stretched to 300-480 ms behind the
 * destination's render at 4x CPU (feel run, 390x844). Same ground, same
 * opacity-only rule; the element's resting opacity is set directly.
 */
describe('TabFade on the web', () => {
  const originalOS = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });
    mockWebSpring.mockClear();
  });
  afterEach(() => Object.defineProperty(Platform, 'OS', { value: originalOS }));

  it('fades the content in on the compositor with the effects curve, at rest opacity 1', () => {
    const { getByTestId } = render(tree());
    expect(mockWebSpring).toHaveBeenCalledTimes(1);
    expect(mockWebSpring).toHaveBeenCalledWith(
      expect.anything(), [{ opacity: 0 }, { opacity: 1 }], SPRING.effects,
    );
    expect(flat(getByTestId('tab-fade-content')).opacity).toBe(1);
    expect(calls).toEqual([]);
  });

  it('waits transparent while another tab is selected, and fades again on return', () => {
    const { getByTestId, rerender } = render(tree());
    mockActiveKey = 'feed-1';
    rerender(tree());
    expect(flat(getByTestId('tab-fade-content')).opacity).toBe(0);
    expect(mockWebSpring).toHaveBeenCalledTimes(1);
    mockActiveKey = 'discover-1';
    rerender(tree());
    expect(mockWebSpring).toHaveBeenCalledTimes(2);
  });

  it('Reduce Motion: no animation, the content is there', () => {
    mockReduced.mockReturnValue(true);
    const { getByTestId } = render(tree());
    expect(mockWebSpring).not.toHaveBeenCalled();
    expect(flat(getByTestId('tab-fade-content')).opacity).toBe(1);
  });
});
