/**
 * Double-tap = ❤️ (direction v2 › Reactions): the heart pops where the thumb
 * was, a white ring and six identity-colour dots go out, and the rail takes
 * the heart. A second double tap replays a smaller burst and adds nothing.
 * Reduce Motion: no burst at all, the reaction still lands.
 */
import React, { createRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { act, render } from '@testing-library/react-native';
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
jest.mock('../../../lib/haptics', () => ({ tapLight: (...a: unknown[]) => mockTap(...a), haptic: jest.fn() }));

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
    expect(view.queryByTestId('reaction-burst-heart')).toBeNull();
  });

  it('pops an 80 dp heart centred where the thumb was, with a ring and six dots', () => {
    const ref = createRef<ReactionBurstHandle>();
    const view = render(<ReactionBurst ref={ref} reducedMotion={false} />);

    act(() => ref.current?.play({ x: 120, y: 300 }));

    const heart = StyleSheet.flatten(view.getByTestId('reaction-burst-heart').props.style);
    expect(heart.left).toBe(120 - BURST.heart / 2);
    expect(heart.top).toBe(300 - BURST.heart / 2);
    expect(heart.width).toBe(80);
    // Hidden from screen readers: the rail announces her reaction, not the decoration.
    expect(view.getByTestId('reaction-burst-emoji', { includeHiddenElements: true }).props.children).toBe('❤️');
    expect(StyleSheet.flatten(view.getByTestId('reaction-burst-ring').props.style).borderWidth).toBe(3);
    const dots = [0, 1, 2, 3, 4, 5].map(
      (i) => StyleSheet.flatten(view.getByTestId(`reaction-burst-dot-${i}`).props.style).backgroundColor,
    );
    expect(dots).toEqual([...IDENTITY]);
  });

  it('plays a smaller burst when asked', () => {
    const ref = createRef<ReactionBurstHandle>();
    const view = render(<ReactionBurst ref={ref} reducedMotion={false} />);

    act(() => ref.current?.play({ x: 120, y: 300 }, { small: true }));

    expect(StyleSheet.flatten(view.getByTestId('reaction-burst-heart').props.style).width)
      .toBeLessThan(BURST.heart);
  });

  it('stays still under Reduce Motion', () => {
    const ref = createRef<ReactionBurstHandle>();
    const view = render(<ReactionBurst ref={ref} reducedMotion />);

    act(() => ref.current?.play({ x: 120, y: 300 }));

    expect(view.queryByTestId('reaction-burst-heart')).toBeNull();
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

    doubleTap(view);

    expect(onReact).toHaveBeenCalledWith('❤️');
    expect(mockTap).toHaveBeenCalledWith(false);
    expect(view.queryByTestId('reaction-burst-heart')).not.toBeNull();
  });

  it('adds nothing when she has already reacted, and the burst is smaller', () => {
    const onReact = jest.fn();
    const view = render(<Cell reaction="😂" onReact={onReact} />);

    doubleTap(view);

    expect(onReact).not.toHaveBeenCalled();
    expect(StyleSheet.flatten(view.getByTestId('reaction-burst-heart').props.style).width)
      .toBeLessThan(BURST.heart);
  });

  it('keeps the haptic under Reduce Motion, drops the burst', () => {
    const onReact = jest.fn();
    const view = render(<Cell reaction={null} onReact={onReact} reducedMotion />);

    doubleTap(view);

    expect(onReact).toHaveBeenCalledWith('❤️');
    expect(mockTap).toHaveBeenCalled();
    expect(view.queryByTestId('reaction-burst-heart')).toBeNull();
  });
});
