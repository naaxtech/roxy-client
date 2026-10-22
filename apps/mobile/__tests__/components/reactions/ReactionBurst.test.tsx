/**
 * Double-tap = ❤️ (direction v2 › Reactions): the heart pops where the thumb
 * was, a white ring and six identity-colour dots go out, and the rail takes
 * the heart. A second double tap replays a smaller burst and adds nothing.
 * Reduce Motion: no burst at all, the reaction still lands.
 *
 * Wave 3 (motion spec §3.1 row 11): the burst runs on reanimated. Its layer is
 * mounted once and `play()` only writes shared values, so a double tap starts
 * it without a React render (a busy JS thread cannot hold it back), and every
 * frame after that runs on the UI thread. Real reanimated (jest build) with
 * fake timers: `getAnimatedStyle` reads what the UI thread would paint.
 */
import React, { createRef, Profiler } from 'react';
import { StyleSheet, View } from 'react-native';
import { act, configure, render } from '@testing-library/react-native';
import { getAnimatedStyle, setUpTests } from 'react-native-reanimated';
import { ReactionBurst, type ReactionBurstHandle, BURST } from '../../../components/reactions/ReactionBurst';
import { DoubleTapReact, useDoubleTapReact } from '../../../components/reactions/DoubleTapReact';
import { IDENTITY } from '../../../lib/theme';

jest.mock('../../../components/reactions/reactionTaps', () => ({
  reactionTaps: (onDoubleTap: unknown, onSingleTap: unknown) => ({ onDoubleTap, onSingleTap }),
}));
jest.mock('react-native-gesture-handler', () => {
  const ReactLocal = require('react');
  return {
    GestureDetector: ({ gesture, children }: { gesture: unknown; children: React.ReactElement }) =>
      ReactLocal.cloneElement(children, { gesture }),
  };
});
const mockTap = jest.fn();
jest.mock('../../../lib/haptics', () => ({ tapLight: jest.fn(), haptic: (...a: unknown[]) => mockTap(...a) }));

configure({ defaultIncludeHiddenElements: true });
setUpTests();

type Painted = { opacity?: number; transform?: Record<string, number | string>[] };
const painted = (view: ReturnType<typeof render>, id: string) =>
  getAnimatedStyle(view.getByTestId(id) as never) as Painted;
const part = (style: Painted, key: string) => style.transform?.find((t) => key in t)?.[key] as number | undefined;
const frames = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

beforeEach(() => {
  jest.useFakeTimers();
  mockTap.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('ReactionBurst', () => {
  it('draws nothing until it plays', () => {
    const view = render(<ReactionBurst reducedMotion={false} />);
    frames(16);
    expect(painted(view, 'reaction-burst-heart').opacity).toBe(0);
    expect(painted(view, 'reaction-burst-ring').opacity).toBe(0);
    expect(painted(view, 'reaction-burst-dot-0').opacity).toBe(0);
  });

  it('pops an 80 dp heart centred where the thumb was, with a ring and six dots', () => {
    const ref = createRef<ReactionBurstHandle>();
    const view = render(<ReactionBurst ref={ref} reducedMotion={false} />);
    frames(16);

    act(() => ref.current?.play({ x: 120, y: 300 }));
    frames(16);

    const heart = painted(view, 'reaction-burst-heart');
    expect(StyleSheet.flatten(view.getByTestId('reaction-burst-heart').props.style).width).toBe(BURST.heart);
    expect(part(heart, 'translateX')).toBe(120 - BURST.heart / 2);
    expect(part(heart, 'translateY')).toBeCloseTo(300 - BURST.heart / 2, 0);
    expect(heart.opacity).toBe(1);
    // Moving, not jumped: one frame in, the heart is growing from 0.
    expect(part(heart, 'scale')).toBeGreaterThan(0);
    expect(part(heart, 'scale')).toBeLessThan(1);
    // Hidden from screen readers: the rail announces her reaction, not the decoration.
    expect(view.getByTestId('reaction-burst-emoji').props.children).toBe('❤️');
    expect(StyleSheet.flatten(view.getByTestId('reaction-burst-ring').props.style).borderWidth).toBe(3);
    expect(painted(view, 'reaction-burst-ring').opacity).toBeGreaterThan(0);
    const dots = [0, 1, 2, 3, 4, 5].map(
      (i) => StyleSheet.flatten(view.getByTestId(`reaction-burst-dot-${i}`).props.style).backgroundColor,
    );
    expect(dots).toEqual([...IDENTITY]);
  });

  it('is gone within its life: dots and ring out by 480 ms, the heart lifted and faded soon after', () => {
    const ref = createRef<ReactionBurstHandle>();
    const view = render(<ReactionBurst ref={ref} reducedMotion={false} />);
    frames(16);
    act(() => ref.current?.play({ x: 120, y: 300 }));
    frames(BURST.lifeMs + 16);
    expect(painted(view, 'reaction-burst-dot-0').opacity).toBeCloseTo(0, 2);
    expect(painted(view, 'reaction-burst-ring').opacity).toBeLessThan(0.05);
    frames(400);
    expect(painted(view, 'reaction-burst-heart').opacity).toBeLessThan(0.02);
  });

  it('starts on the UI thread: play() commits no React render', () => {
    const ref = createRef<ReactionBurstHandle>();
    const commits = jest.fn();
    const view = render(
      <Profiler id="burst" onRender={commits}>
        <ReactionBurst ref={ref} reducedMotion={false} />
      </Profiler>,
    );
    frames(16);
    commits.mockClear();
    act(() => ref.current?.play({ x: 120, y: 300 }));
    frames(16);
    expect(commits).not.toHaveBeenCalled();
    expect(painted(view, 'reaction-burst-heart').opacity).toBe(1);
  });

  it('plays a smaller burst when asked', () => {
    const ref = createRef<ReactionBurstHandle>();
    const view = render(<ReactionBurst ref={ref} reducedMotion={false} />);
    frames(16);

    act(() => ref.current?.play({ x: 120, y: 300 }, { small: true }));
    frames(250);

    expect(part(painted(view, 'reaction-burst-heart'), 'scale'))
      .toBeCloseTo(BURST.smallHeart / BURST.heart, 1);
  });

  it('stays still under Reduce Motion', () => {
    const ref = createRef<ReactionBurstHandle>();
    const view = render(<ReactionBurst ref={ref} reducedMotion />);
    frames(16);

    act(() => ref.current?.play({ x: 120, y: 300 }));
    frames(16);

    expect(painted(view, 'reaction-burst-heart').opacity).toBe(0);
  });

  it('never takes a touch', () => {
    const view = render(<ReactionBurst reducedMotion={false} />);
    expect(view.getByTestId('reaction-burst').props.pointerEvents).toBe('none');
  });
});

function Cell({
  reaction, onReact, reducedMotion = false,
}: { reaction: '❤️' | '😂' | null; onReact: jest.Mock; reducedMotion?: boolean }) {
  const { burstRef, onDoubleTap } = useDoubleTapReact({ reaction, onReact, reducedMotion });
  return (
    <View>
      <DoubleTapReact onDoubleTap={onDoubleTap} />
      <ReactionBurst ref={burstRef} reducedMotion={reducedMotion} />
    </View>
  );
}

type Taps = { onDoubleTap: (p: { x: number; y: number }) => void };
function doubleTap(view: ReturnType<typeof render>, x = 150, y = 320) {
  const gesture = view.getByTestId('feed-media-taps').props.gesture as Taps;
  act(() => gesture.onDoubleTap({ x, y }));
}

describe('useDoubleTapReact', () => {
  it('gives a heart when she has no reaction, with the burst and a light haptic', () => {
    const onReact = jest.fn();
    const view = render(<Cell reaction={null} onReact={onReact} />);

    frames(16);
    doubleTap(view);
    frames(16);

    expect(onReact).toHaveBeenCalledWith('❤️');
    expect(mockTap.mock.calls).toEqual([['light']]);
    expect(painted(view, 'reaction-burst-heart').opacity).toBe(1);
  });

  it('adds nothing when she has already reacted, and the burst is smaller', () => {
    const onReact = jest.fn();
    const view = render(<Cell reaction="😂" onReact={onReact} />);

    frames(16);
    doubleTap(view);
    frames(250);

    expect(onReact).not.toHaveBeenCalled();
    expect(part(painted(view, 'reaction-burst-heart'), 'scale')).toBeLessThan(0.8);
  });

  it('keeps the haptic under Reduce Motion, drops the burst', () => {
    const onReact = jest.fn();
    const view = render(<Cell reaction={null} onReact={onReact} reducedMotion />);

    frames(16);
    doubleTap(view);
    frames(16);

    expect(onReact).toHaveBeenCalledWith('❤️');
    expect(mockTap).toHaveBeenCalledWith('light');
    expect(painted(view, 'reaction-burst-heart').opacity).toBe(0);
  });
});
