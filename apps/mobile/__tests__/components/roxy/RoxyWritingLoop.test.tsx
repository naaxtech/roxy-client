/**
 * Roxy AI's writing indicator loops on the UI thread (lane C; jank audit #7:
 * its legacy Animated loop ran on the JS thread on web): the O squashes
 * circle → squashed → stretched → circle every LOADING_CYCLE_MS from a
 * reanimated shared value, with no React render per frame. Reduce Motion:
 * she holds still.
 */
import React, { Profiler } from 'react';
import { render, act, configure } from '@testing-library/react-native';
import { getAnimatedStyle, setUpTests } from 'react-native-reanimated';

configure({ defaultIncludeHiddenElements: true });
setUpTests();

jest.mock('react-native-svg', () => ({
  __esModule: true, default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', Path: 'Path', G: 'G',
}));
let mockReduced = false;
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));

import { RoxyWriting } from '../../../components/roxy/RoxyWriting';
import { LOADING_CYCLE_MS } from '../../../components/feedback/RoxyLoading';

const frames = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
const sx = (v: ReturnType<typeof render>) => {
  const t = (getAnimatedStyle(v.getByTestId('w-squash') as never) as { transform?: Record<string, number>[] }).transform ?? [];
  return { x: t.find((p) => 'scaleX' in p)?.scaleX ?? 1, y: t.find((p) => 'scaleY' in p)?.scaleY ?? 1 };
};

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('RoxyWriting on the UI thread', () => {
  it('squashes and stretches through each cycle, again and again, with no React render', () => {
    const commits = jest.fn();
    const v = render(
      <Profiler id="w" onRender={commits}>
        <RoxyWriting testID="w" />
      </Profiler>,
    );
    frames(16);
    commits.mockClear();
    for (const cycle of [0, 1]) {
      let maxX = 0;
      let minX = 2;
      for (let t = 0; t < LOADING_CYCLE_MS; t += 16) {
        frames(16);
        maxX = Math.max(maxX, sx(v).x);
        minX = Math.min(minX, sx(v).x);
      }
      expect({ cycle, wide: maxX > 1.12 }).toEqual({ cycle, wide: true });
      expect({ cycle, narrow: minX < 0.95 }).toEqual({ cycle, narrow: true });
    }
    expect(commits).not.toHaveBeenCalled();
  });

  it('Reduce Motion: she holds still', () => {
    mockReduced = true;
    const v = render(<RoxyWriting testID="w" />);
    for (let i = 0; i < 40; i += 1) {
      frames(16);
      expect(sx(v)).toEqual({ x: 1, y: 1 });
    }
  });
});
