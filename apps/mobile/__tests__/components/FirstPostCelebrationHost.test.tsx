/**
 * The root host: the composer `replace`s itself with her profile as soon as
 * the write lands, so the moment renders from the store at the root and
 * clears through the store when she closes it.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    withTiming: (value: number) => value,
    withSpring: (value: number) => value,
    withDelay: (_delay: number, value: number) => value,
    withSequence: (...values: number[]) => values[values.length - 1],
  };
});
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
// Reduced motion keeps Confetti (RN Animated) out of this suite.
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../lib/firstPost', () => ({ claimFirstPostCelebration: jest.fn() }));
jest.mock('../../lib/badges', () => ({ fetchJustEarned: jest.fn(() => Promise.resolve([])) }));

import { FirstPostCelebrationHost } from '../../components/feed/FirstPostCelebration';
import { useCelebrationStore } from '../../store/celebrationStore';

beforeEach(() => {
  useCelebrationStore.setState({ firstPost: null, pending: [] });
});

describe('FirstPostCelebrationHost', () => {
  it('renders nothing until a first post is queued', () => {
    const v = render(<FirstPostCelebrationHost />);
    expect(v.queryByTestId('first-post-celebration')).toBeNull();
  });

  it('shows the queued moment, names where a text card went, and clears it on close', () => {
    const v = render(<FirstPostCelebrationHost />);
    act(() => { useCelebrationStore.setState({ firstPost: { postType: 'standard' } }); });

    expect(v.getByTestId('first-post-celebration')).toBeTruthy();
    expect(v.getByTestId('first-post-body').props.children).toMatch(/Thoughts/);

    fireEvent.press(v.getByTestId('first-post-dismiss'));
    expect(useCelebrationStore.getState().firstPost).toBeNull();
    expect(v.queryByTestId('first-post-celebration')).toBeNull();
  });
});
