import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

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

const mockNotify = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: (...args: unknown[]) => mockNotify(...(args as [])),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

let mockReduced = false;
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));

import { FirstPostCelebration } from '../../components/feed/FirstPostCelebration';

beforeEach(() => {
  mockReduced = false;
  mockNotify.mockClear();
});

describe('FirstPostCelebration', () => {
  it('tells her the post is live and where it went', () => {
    const v = render(<FirstPostCelebration postType="photo" onDismiss={jest.fn()} />);

    expect(v.getByText('Your first post is live')).toBeTruthy();
    expect(v.getByTestId('first-post-body').props.children).toMatch(/profile/i);
  });

  // Wave 3 (§3.3, P3): `success` fires only on "You're in"; her first post gets
  // the overlay and the announcement, no haptic (it used to celebrate).
  it('plays no haptic (success is for "You\'re in" only)', () => {
    render(<FirstPostCelebration postType="standard" onDismiss={jest.fn()} />);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('says it out loud for a screen reader', () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    render(<FirstPostCelebration postType="video" onDismiss={jest.fn()} />);
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/first post is live/i));
    spy.mockRestore();
  });

  // Wave 3 (§3.3, P3): no haptic at all here now, with or without Reduce Motion.
  it('with Reduce Motion: no confetti, no haptic, and still dismissible', () => {
    mockReduced = true;
    const onDismiss = jest.fn();
    const v = render(<FirstPostCelebration postType="photo" onDismiss={onDismiss} />);

    expect(v.queryByTestId('confetti')).toBeNull();
    expect(mockNotify).not.toHaveBeenCalled();
    fireEvent.press(v.getByTestId('first-post-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('closes on the button and on the scrim', () => {
    const onDismiss = jest.fn();
    const v = render(<FirstPostCelebration postType="photo" onDismiss={onDismiss} />);

    fireEvent.press(v.getByTestId('first-post-dismiss'));
    fireEvent.press(v.getByTestId('first-post-scrim'));
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(v.getByTestId('first-post-dismiss').props.accessibilityRole).toBe('button');
  });
});
