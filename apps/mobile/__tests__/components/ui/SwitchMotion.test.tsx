/**
 * The M3 switch moves on the UI thread (motion spec §3.1 row 2; lane C):
 * the thumb travels on `SPRING.fastSpatial`, the track and thumb colours
 * cross-fade on `SPRING.fastEffects` (never a snap), and the thumb grows to
 * 24 dp while pressed, from press-in, with no React render. Reduce Motion:
 * the thumb jumps, the colour becomes a 120 ms fade, the haptic stays.
 *
 * Real reanimated (jest build) with fake timers: `getAnimatedStyle` reads
 * what the UI thread would paint.
 */
import React, { Profiler } from 'react';
import { I18nManager, processColor } from 'react-native';
import { render, fireEvent, act, configure } from '@testing-library/react-native';
import { getAnimatedStyle, setUpTests } from 'react-native-reanimated';

configure({ defaultIncludeHiddenElements: true });
setUpTests();

const mockTap = jest.fn();
jest.mock('../../../lib/haptics', () => ({ tapLight: (...a: unknown[]) => mockTap(...a), haptic: jest.fn() }));
let mockReduced = false;
jest.mock('../../../hooks/useReducedMotion', () => ({
  ...jest.requireActual('../../../hooks/useReducedMotion'),
  useReducedMotion: () => mockReduced,
}));

import { Switch, SWITCH } from '../../../components/ui/Switch';
import { THEMES, BRAND_INK_INVERSE } from '../../../lib/theme';
import { useThemeStore } from '../../../store/themeStore';

const light = THEMES.light;
type Painted = { backgroundColor?: string; borderColor?: string; transform?: Record<string, number>[] };
const painted = (view: ReturnType<typeof render>, id: string) =>
  getAnimatedStyle(view.getByTestId(id) as never) as Painted;
const part = (p: Painted, key: string) => p.transform?.find((t) => key in t)?.[key];
const frames = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
/** Colours compare as the native colour int, whatever string form they are in. */
const same = (a: string | undefined, b: string) => processColor(a ?? '') === processColor(b);

const INNER_W = SWITCH.width - 2 * SWITCH.outline;
const INNER_H = SWITCH.height - 2 * SWITCH.outline;
/** Thumb centre at each end, inside the outline. */
const CENTRE_OFF = INNER_H / 2;
const CENTRE_ON = INNER_W - INNER_H / 2;
/** The thumb is one 24 dp box, scaled: its left edge sits at centre − 12. */
const leftFor = (centre: number) => centre - SWITCH.thumbPressed / 2;

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
  mockTap.mockReset();
  useThemeStore.setState({ theme: 'light', choice: 'light' });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('Switch on the UI thread', () => {
  it('rests where its value says: off at the start end, small control thumb; on at the end, 20 dp white', () => {
    const off = render(<Switch testID="sw" value={false} />);
    frames(16);
    expect(part(painted(off, 'sw-thumb'), 'translateX')).toBeCloseTo(leftFor(CENTRE_OFF), 3);
    expect(part(painted(off, 'sw-thumb'), 'scale')).toBeCloseTo(SWITCH.thumbOff / SWITCH.thumbPressed, 3);
    expect(same(painted(off, 'sw-track').backgroundColor, light.raised)).toBe(true);
    expect(same(painted(off, 'sw-track').borderColor, light.control)).toBe(true);
    expect(same(painted(off, 'sw-thumb').backgroundColor, light.control)).toBe(true);
    off.unmount();

    const on = render(<Switch testID="sw" value />);
    frames(16);
    expect(part(painted(on, 'sw-thumb'), 'translateX')).toBeCloseTo(leftFor(CENTRE_ON), 3);
    expect(part(painted(on, 'sw-thumb'), 'scale')).toBeCloseTo(SWITCH.thumbOn / SWITCH.thumbPressed, 3);
    expect(same(painted(on, 'sw-track').backgroundColor, light.pink)).toBe(true);
    expect(same(painted(on, 'sw-thumb').backgroundColor, BRAND_INK_INVERSE)).toBe(true);
  });

  it('the thumb travels (no jump) and the track colour cross-fades (no snap) when the value flips', () => {
    const view = render(<Switch testID="sw" value={false} />);
    frames(16);
    view.rerender(<Switch testID="sw" value />);
    frames(16);
    const x1 = part(painted(view, 'sw-thumb'), 'translateX') ?? 0;
    expect(x1).toBeGreaterThan(leftFor(CENTRE_OFF));
    expect(x1).toBeLessThan(leftFor(CENTRE_ON));
    const mid = painted(view, 'sw-track').backgroundColor;
    expect(same(mid, light.raised)).toBe(false);
    expect(same(mid, light.pink)).toBe(false);

    frames(600);
    expect(part(painted(view, 'sw-thumb'), 'translateX')).toBeCloseTo(leftFor(CENTRE_ON), 1);
    expect(same(painted(view, 'sw-track').backgroundColor, light.pink)).toBe(true);
  });

  it('press-in grows the thumb to 24 dp without a React render, release brings it back', () => {
    const commits = jest.fn();
    const view = render(
      <Profiler id="sw" onRender={commits}>
        <Switch testID="sw" value />
      </Profiler>,
    );
    frames(16);
    commits.mockClear();
    fireEvent(view.getByTestId('sw'), 'pressIn');
    frames(16);
    expect(commits).not.toHaveBeenCalled();
    expect(part(painted(view, 'sw-thumb'), 'scale')).toBeGreaterThan(SWITCH.thumbOn / SWITCH.thumbPressed);
    frames(400);
    expect(part(painted(view, 'sw-thumb'), 'scale')).toBeCloseTo(1, 2);
    fireEvent(view.getByTestId('sw'), 'pressOut');
    frames(400);
    expect(part(painted(view, 'sw-thumb'), 'scale')).toBeCloseTo(SWITCH.thumbOn / SWITCH.thumbPressed, 2);
  });

  it('a disabled switch does not grow on press-in', () => {
    const view = render(<Switch testID="sw" value disabled />);
    frames(16);
    fireEvent(view.getByTestId('sw'), 'pressIn');
    frames(400);
    expect(part(painted(view, 'sw-thumb'), 'scale')).toBeCloseTo(SWITCH.thumbOn / SWITCH.thumbPressed, 3);
  });

  it('Reduce Motion: the thumb jumps, the colour is a 120 ms fade, the haptic still lands', () => {
    mockReduced = true;
    const onValueChange = jest.fn();
    const view = render(<Switch testID="sw" value={false} onValueChange={onValueChange} />);
    frames(16);
    fireEvent.press(view.getByTestId('sw'));
    expect(mockTap).toHaveBeenCalled();
    expect(onValueChange).toHaveBeenCalledWith(true);
    view.rerender(<Switch testID="sw" value onValueChange={onValueChange} />);
    frames(16);
    expect(part(painted(view, 'sw-thumb'), 'translateX')).toBeCloseTo(leftFor(CENTRE_ON), 3);
    const early = painted(view, 'sw-track').backgroundColor;
    expect(same(early, light.pink)).toBe(false);
    frames(130);
    expect(same(painted(view, 'sw-track').backgroundColor, light.pink)).toBe(true);
  });

  it('right to left: the thumb mirrors (on sits at the start end of the screen, i.e. the left)', () => {
    const was = I18nManager.isRTL;
    Object.defineProperty(I18nManager, 'isRTL', { value: true, configurable: true });
    try {
      const view = render(<Switch testID="sw" value />);
      frames(16);
      expect(part(painted(view, 'sw-thumb'), 'translateX')).toBeCloseTo(leftFor(INNER_W - CENTRE_ON), 3);
    } finally {
      Object.defineProperty(I18nManager, 'isRTL', { value: was, configurable: true });
    }
  });
});
