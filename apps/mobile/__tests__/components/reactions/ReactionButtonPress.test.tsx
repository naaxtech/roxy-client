/**
 * The rail's reaction button on the UI thread (lane C, F1): the press dip
 * and the "her reaction changed" squish are reanimated shared values. Press
 * dips to PRESS.scale from the responder grant with a one-frame head start
 * and no React render; release springs back. A new reaction squishes
 * 0.85 → 1.12 → 1 on fastSpatial. Reduce Motion: the dip jumps, no squish.
 */
import React, { Profiler } from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { getAnimatedStyle, setUpTests } from 'react-native-reanimated';

setUpTests();

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
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { ReactionButton } from '../../../components/reactions/ReactionButton';
import type { ReactionPickerController } from '../../../components/reactions/useReactionPicker';
import type { PostReaction } from '../../../lib/postReactions';
import { PRESS, springAt } from '../../../lib/motion';

function makePicker(pulse = 0): ReactionPickerController {
  return {
    open: false,
    hovered: null,
    anchor: { x: 0, y: 0, width: 48, height: 48 },
    layoutOf: () => () => {},
    responder: {
      onStartShouldSetResponder: () => true,
      onResponderTerminationRequest: () => false,
      onResponderGrant: jest.fn(),
      onResponderMove: jest.fn(),
      onResponderRelease: jest.fn(),
      onResponderTerminate: jest.fn(),
    },
    tap: jest.fn(),
    openPicker: jest.fn(),
    pick: jest.fn(),
    dismiss: jest.fn(),
    pulse,
  };
}

const scaleOf = (v: ReturnType<typeof render>) => {
  const t = (getAnimatedStyle(v.getByTestId('rail-react-face') as never) as { transform?: Record<string, number>[] }).transform ?? [];
  return t.reduce((acc, x) => (typeof x.scale === 'number' ? acc * x.scale : acc), 1);
};
const frames = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
const ev = { nativeEvent: { pageX: 0, pageY: 0, locationX: 24, locationY: 24, touches: [] } };

function Button({ picker, reaction = null, reduced = false }: { picker: ReactionPickerController; reaction?: PostReaction | null; reduced?: boolean }) {
  return <ReactionButton picker={picker} reaction={reaction} total={3} noun="video" reducedMotion={reduced} />;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockWithSpring.mockClear();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('ReactionButton on the UI thread', () => {
  it('press-in dips from the grant with a head start and no render; release springs back', () => {
    const picker = makePicker();
    const commits = jest.fn();
    const v = render(
      <Profiler id="rb" onRender={commits}>
        <Button picker={picker} />
      </Profiler>,
    );
    frames(16);
    commits.mockClear();
    mockWithSpring.mockClear();
    fireEvent(v.getByTestId('rail-react'), 'responderGrant', ev);
    expect(picker.responder.onResponderGrant).toHaveBeenCalled();
    const h = springAt('fastSpatial', 1000 / 60);
    const call = mockWithSpring.mock.calls.find(([to]) => to === PRESS.scale);
    expect(call?.[1]).toMatchObject({ reduceMotion: 'never' });
    expect(call?.[1].velocity).toBeCloseTo(-(1 - PRESS.scale) * h.v, 6);
    frames(16);
    expect(commits).not.toHaveBeenCalled();
    expect(scaleOf(v)).toBeLessThanOrEqual(1 - (1 - PRESS.scale) * h.x + 1e-6);
    frames(400);
    expect(scaleOf(v)).toBeCloseTo(PRESS.scale, 3);
    fireEvent(v.getByTestId('rail-react'), 'responderRelease', ev);
    frames(600);
    expect(scaleOf(v)).toBeCloseTo(1, 3);
  });

  it('a responder taken away (scroll) springs it back too', () => {
    const picker = makePicker();
    const v = render(<Button picker={picker} />);
    frames(16);
    fireEvent(v.getByTestId('rail-react'), 'responderGrant', ev);
    frames(400);
    fireEvent(v.getByTestId('rail-react'), 'responderTerminate');
    frames(600);
    expect(scaleOf(v)).toBeCloseTo(1, 3);
    expect(picker.responder.onResponderTerminate).toHaveBeenCalled();
  });

  it('a new reaction squishes 0.85 → 1.12 → 1', () => {
    const v = render(<Button picker={makePicker(0)} />);
    frames(16);
    v.rerender(<Button picker={makePicker(1)} reaction="😂" />);
    let peak = 0;
    let low = 2;
    for (let i = 0; i < 60; i += 1) {
      frames(16);
      peak = Math.max(peak, scaleOf(v));
      low = Math.min(low, scaleOf(v));
    }
    expect(low).toBeLessThan(0.9);
    expect(peak).toBeGreaterThan(1.08);
    frames(1000);
    expect(scaleOf(v)).toBeCloseTo(1, 2);
  });

  it('Reduce Motion: the dip jumps, a new reaction does not squish', () => {
    const v = render(<Button picker={makePicker(0)} reduced />);
    frames(16);
    fireEvent(v.getByTestId('rail-react'), 'responderGrant', ev);
    frames(16);
    expect(scaleOf(v)).toBeCloseTo(PRESS.scale, 6);
    fireEvent(v.getByTestId('rail-react'), 'responderRelease', ev);
    frames(16);
    expect(scaleOf(v)).toBeCloseTo(1, 6);
    v.rerender(<Button picker={makePicker(1)} reaction="😂" reduced />);
    for (let i = 0; i < 20; i += 1) {
      frames(16);
      expect(scaleOf(v)).toBeCloseTo(1, 6);
    }
  });
});
