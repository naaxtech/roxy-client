import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
const mockTap = jest.fn();
jest.mock('../../../lib/haptics', () => ({ tapLight: (...a: unknown[]) => mockTap(...a), haptic: (...a: unknown[]) => mockTap(...a) }));

import { DailyPromptCell } from '../../../components/feed/DailyPromptCell';
import { DAILY_PROMPT_KICK, dailyPromptFor } from '../../../lib/dailyPrompt';
import { RAIL_GUTTER, STAGE_HEADER, STAGE_TOP } from '../../../components/feed/feedChromeTokens';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

const PROMPT = dailyPromptFor(new Date(2026, 9, 11, 12));

beforeEach(() => {
  mockPush.mockReset();
  mockTap.mockReset();
});

describe('DailyPromptCell', () => {
  it('shows the question on the text card, labelled as the question of the day', () => {
    const v = render(<DailyPromptCell prompt={PROMPT} width={390} height={800} reducedMotion={false} />);
    expect(v.getByText(PROMPT.question)).toBeTruthy();
    expect(v.getByText(DAILY_PROMPT_KICK)).toBeTruthy();
  });

  // Wave 3 (§3.3, P3): answering the prompt is a plain tap, no haptic (was a light one).
  it('one tap opens the composer on this question, by index, with no haptic', () => {
    const v = render(<DailyPromptCell prompt={PROMPT} width={390} height={800} reducedMotion={false} />);
    fireEvent.press(v.getByTestId('daily-prompt-answer'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/community/create-post',
      params: { prompt: String(PROMPT.index) },
    });
    expect(mockTap).not.toHaveBeenCalled();
  });

  it('is a labelled button a thumb can hit, clear of the rail/FAB gutter', () => {
    const v = render(<DailyPromptCell prompt={PROMPT} width={390} height={800} reducedMotion />);
    const btn = v.getByTestId('daily-prompt-answer');
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toContain(PROMPT.question);
    expect(StyleSheet.flatten(btn.props.style).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);

    const footer = v.getByTestId('daily-prompt-note').parent?.parent;
    expect(StyleSheet.flatten(footer?.props.style).right).toBe(RAIL_GUTTER);
  });

  /**
   * Wave 2 ship shots (cmp-prompt.png, 360x800 and 390x844): the kick and the
   * first line of the question ran under the streak/search/Now row and the
   * For You · Following · Communities tabs, because the card only kept its own
   * 34 dp at the top and the header is an overlay on the page.
   */
  it('starts the question below the feed header, not under it', () => {
    const v = render(<DailyPromptCell prompt={PROMPT} width={360} height={732} reducedMotion={false} />);
    const face = StyleSheet.flatten(v.getByTestId('daily-prompt-gradient').props.style);
    expect(face.paddingTop).toBe(STAGE_TOP);
    expect(STAGE_TOP).toBeGreaterThan(STAGE_HEADER);
  });

  it('adds the status bar on a phone that has one, as the header does', () => {
    const insets = { top: 47, right: 0, bottom: 34, left: 0 };
    const v = render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <DailyPromptCell prompt={PROMPT} width={390} height={844} reducedMotion={false} />
      </SafeAreaInsetsContext.Provider>,
    );
    const face = StyleSheet.flatten(v.getByTestId('daily-prompt-gradient').props.style);
    expect(face.paddingTop).toBe(STAGE_TOP + 47);
  });
});

describe('STAGE_HEADER — what the feed header overlay owns at the top of every page', () => {
  it('is the action row and the tab row, each a touch target, with the layer\'s two 4 dp gaps', () => {
    // app/(tabs)/feed/index.tsx headerLayer: headerRow (48 dp search / Now),
    // railWrap (empty while Now is closed), FeedSegments (48 dp tabs), gap 4.
    expect(STAGE_HEADER).toBe(MIN_TOUCH_TARGET + 4 + 4 + MIN_TOUCH_TARGET);
  });
});
