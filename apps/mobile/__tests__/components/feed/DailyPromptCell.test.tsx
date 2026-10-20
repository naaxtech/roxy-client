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
jest.mock('../../../lib/haptics', () => ({ tapLight: (...a: unknown[]) => mockTap(...a) }));

import { DailyPromptCell } from '../../../components/feed/DailyPromptCell';
import { DAILY_PROMPT_KICK, dailyPromptFor } from '../../../lib/dailyPrompt';
import { RAIL_GUTTER } from '../../../components/feed/feedChromeTokens';
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

  it('one tap opens the composer on this question, by index, with a light haptic', () => {
    const v = render(<DailyPromptCell prompt={PROMPT} width={390} height={800} reducedMotion={false} />);
    fireEvent.press(v.getByTestId('daily-prompt-answer'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/community/create-post',
      params: { prompt: String(PROMPT.index) },
    });
    expect(mockTap).toHaveBeenCalledWith(false);
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
});
