import React from 'react';
import { render, act, configure } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

// The O is decorative (hidden from assistive tech) unless named; its parts
// are still what these tests inspect.
configure({ defaultIncludeHiddenElements: true });

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Ellipse: 'Ellipse',
  Path: 'Path',
  G: 'G',
}));

let mockReduced = false;
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));

import { RoxyO, BLINK_MIN_MS, BLINK_MAX_MS, BLINK_HOLD_MS, nextBlinkDelay } from '../../../components/roxy/RoxyO';
import { RoxyWriting } from '../../../components/roxy/RoxyWriting';
import { THEMES } from '../../../lib/theme';
import { useThemeStore } from '../../../store/themeStore';

/**
 * The Roxy O (design direction v2 › The Roxy AI button): the O of the wordmark
 * with a face in its counter. A `pink` ring (`brandPink` on the dark stage), a
 * #FFFDFD face disc at 64% of the diameter, eyes glancing toward the content,
 * a lopsided smile. Four moods; she blinks every 4-7 s at rest, and never
 * under Reduce Motion.
 */

beforeEach(() => {
  mockReduced = false;
  useThemeStore.setState({ theme: 'light', choice: 'light' });
});

describe('RoxyO', () => {
  it.each(['open', 'happy', 'rest', 'think'] as const)('draws the %s mood', (mood) => {
    const { getByTestId, queryByTestId } = render(<RoxyO testID="o" mood={mood} />);
    expect(getByTestId(`o-${mood}`)).toBeTruthy();
    for (const other of ['open', 'happy', 'rest', 'think'].filter((m) => m !== mood)) {
      expect(queryByTestId(`o-${other}`)).toBeNull();
    }
  });

  it('is a pink ring with a face disc at 64% of its diameter', () => {
    const { getByTestId } = render(<RoxyO testID="o" size={56} />);
    const ring = getByTestId('o-ring');
    const face = getByTestId('o-face');
    expect(ring.props.fill).toBe(THEMES.light.pink);
    expect(face.props.fill).toBe(THEMES.light.surface);
    expect(Number(face.props.r) * 2 / 56).toBeCloseTo(0.64, 1);
  });

  it('takes another ring colour (the stage, or off in Settings)', () => {
    const { getByTestId } = render(<RoxyO testID="o" ring={THEMES.light.brandPink} />);
    expect(getByTestId('o-ring').props.fill).toBe(THEMES.light.brandPink);
  });

  it('keeps the same face in dark: the face is not a theme surface', () => {
    useThemeStore.setState({ theme: 'dark', choice: 'dark' });
    const { getByTestId } = render(<RoxyO testID="o" />);
    expect(getByTestId('o-face').props.fill).toBe(THEMES.light.surface);
    expect(getByTestId('o-ring').props.fill).toBe(THEMES.dark.pink);
  });

  it('is decorative unless it is given a name', () => {
    const quiet = render(<RoxyO testID="o" />);
    expect(quiet.getByTestId('o').props.accessibilityElementsHidden).toBe(true);
    const named = render(<RoxyO testID="n" accessibilityLabel="Roxy AI" />);
    expect(named.getByTestId('n').props.accessibilityLabel).toBe('Roxy AI');
  });

  describe('blinking', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('waits 4 to 7 seconds between blinks', () => {
      expect(BLINK_MIN_MS).toBe(4000);
      expect(BLINK_MAX_MS).toBe(7000);
      expect(nextBlinkDelay(() => 0)).toBe(4000);
      expect(nextBlinkDelay(() => 0.999999)).toBeLessThanOrEqual(7000);
    });

    it('closes her eyes briefly at rest, then opens them', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      const { getByTestId, queryByTestId } = render(<RoxyO testID="o" mood="open" blink />);
      expect(getByTestId('o-open')).toBeTruthy();
      act(() => { jest.advanceTimersByTime(BLINK_MIN_MS); });
      expect(getByTestId('o-rest')).toBeTruthy();
      act(() => { jest.advanceTimersByTime(BLINK_HOLD_MS); });
      expect(getByTestId('o-open')).toBeTruthy();
      expect(queryByTestId('o-rest')).toBeNull();
    });

    it('never blinks under Reduce Motion', () => {
      mockReduced = true;
      jest.spyOn(Math, 'random').mockReturnValue(0);
      const { getByTestId } = render(<RoxyO testID="o" mood="open" blink />);
      act(() => { jest.advanceTimersByTime(BLINK_MAX_MS * 3); });
      expect(getByTestId('o-open')).toBeTruthy();
    });

    it('does not blink unless asked (her avatar in a list stays still)', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      const { getByTestId } = render(<RoxyO testID="o" mood="open" />);
      act(() => { jest.advanceTimersByTime(BLINK_MAX_MS * 2); });
      expect(getByTestId('o-open')).toBeTruthy();
    });
  });
});

describe('RoxyWriting (her writing indicator)', () => {
  it('is the O in think mood with the words, never a spinner', () => {
    const { getByTestId, getByText } = render(<RoxyWriting testID="w" />);
    expect(getByTestId('w-o-think')).toBeTruthy();
    expect(getByText('Roxy AI is writing')).toBeTruthy();
    expect(getByTestId('w').props.accessibilityLiveRegion).toBe('polite');
  });

  it('holds still under Reduce Motion', () => {
    mockReduced = true;
    const { getByTestId } = render(<RoxyWriting testID="w" />);
    // Wave 3: the squash is a reanimated style (frame-by-frame loop in RoxyWritingLoop.test).
    const style = getAnimatedStyle(getByTestId('w-squash') as never) as { transform?: unknown };
    expect(style.transform).toEqual([{ scaleX: 1 }, { scaleY: 1 }]);
  });
});
