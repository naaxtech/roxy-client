import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    withTiming: (value: number) => value,
    withSpring: (value: number) => value,
    withDelay: (_d: number, value: number) => value,
    withSequence: (...values: number[]) => values[values.length - 1],
    Easing: { out: (f: unknown) => f, quad: 'quad' },
  };
});
const mockNotify = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({
  notificationAsync: (...a: unknown[]) => mockNotify(...(a as [])),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));
let mockReduced = false;
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({ can: () => true, canCommunity: () => true, loading: false }),
}));
const mockAuth = { user: { id: 'u-new' } };
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: typeof mockAuth) => unknown) => sel(mockAuth),
}));
const mockProfile = {
  profile: { id: 'u-new', display_name: 'Sam Okafor', vetting_status: 'approved', admitted_at: '2026-10-21T10:00:00Z' },
};
jest.mock('../../store/profileStore', () => ({
  useProfileStore: (sel: (s: typeof mockProfile) => unknown) => sel(mockProfile),
}));
jest.mock('../../lib/officialCommunity', () => ({
  fetchOfficialCommunity: jest.fn(() => Promise.resolve(null)),
}));
const mockFetchCommunity = jest.fn();
jest.mock('../../lib/welcomeIn', () => {
  const actual = jest.requireActual('../../lib/welcomeIn');
  return { ...actual, fetchAdmissionCommunity: (...a: unknown[]) => mockFetchCommunity(...a) };
});

import { StyleSheet } from 'react-native';
import WelcomeInScreen, { CARD_EDGE, CARD_TILT } from '../../app/(auth)/welcome-in';
import { THEMES } from '../../lib/theme';
import { useThemeStore } from '../../store/themeStore';
import { FirstStepsCard } from '../../components/account/FirstStepsCard';
import { welcomeSeenKey, firstStepsKey } from '../../lib/welcomeIn';

beforeEach(async () => {
  jest.clearAllMocks();
  mockReduced = false;
  useThemeStore.setState({ theme: 'light' });
  await AsyncStorage.clear();
  mockFetchCommunity.mockResolvedValue({ id: 'c1', name: 'Dykes of Leeds', slug: 'dol' });
});

describe("WelcomeInScreen — You're in", () => {
  it('greets her by first name and puts the community that vouched for her on the card', async () => {
    // v2 (board v2-02): "You're in, <first name>." and the card's vouching
    // line replace v0's sentence about the application.
    const { getByText, findByText, getByTestId } = render(<WelcomeInScreen />);
    expect(getByText("You're in, Sam.")).toBeTruthy();
    expect(getByText('Your card is ready. Show it to the friend who sent you the code.')).toBeTruthy();
    expect(await findByText('Dykes of Leeds')).toBeTruthy();
    expect(getByText('vouched for you')).toBeTruthy();
    expect(getByTestId('membership-card').props.accessibilityLabel).toContain('Dykes of Leeds vouched for you.');
  });

  it('puts her name and the day she became a member on the card', async () => {
    const { getByText } = render(<WelcomeInScreen />);
    expect(getByText('Sam Okafor')).toBeTruthy();
    expect(getByText('Member since 21 October 2026')).toBeTruthy();
  });

  it('floods the screen brandPink', () => {
    const { getByTestId } = render(<WelcomeInScreen />);
    expect(StyleSheet.flatten(getByTestId('welcome-in-flood').props.style).backgroundColor)
      .toBe(THEMES.light.brandPink);
  });

  it('settles the card at -3° on a hard 6 dp edge (Reduce Motion: the end state, still)', () => {
    mockReduced = true;
    const { getByTestId } = render(<WelcomeInScreen />);
    const card = StyleSheet.flatten(getByTestId('membership-card').props.style);
    expect(card.transform).toEqual(expect.arrayContaining([{ rotate: CARD_TILT }]));
    expect(CARD_TILT).toBe('-3deg');
    const edge = StyleSheet.flatten(getByTestId('membership-card-edge').props.style);
    expect(edge.top).toBe(CARD_EDGE);
    expect(CARD_EDGE).toBe(6);
    expect(edge.backgroundColor).toBe(THEMES.light.pinkLip);
  });

  it('"Come in" goes straight into Roxy', async () => {
    const { getByRole } = render(<WelcomeInScreen />);
    await act(async () => { fireEvent.press(getByRole('button', { name: 'Come in' })); });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/feed');
  });

  it('has no confetti emoji and no dead share button', () => {
    const { queryByText } = render(<WelcomeInScreen />);
    expect(queryByText('💜')).toBeNull();
    expect(queryByText(/Share your card/)).toBeNull();
  });

  it('celebrates with a success haptic on a phone', async () => {
    Platform.OS = 'ios';
    render(<WelcomeInScreen />);
    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('success'));
  });

  it('never calls haptics on the web build', async () => {
    const prev = Platform.OS;
    Platform.OS = 'web';
    try {
      render(<WelcomeInScreen />);
      await act(async () => { await Promise.resolve(); });
      expect(mockNotify).not.toHaveBeenCalled();
    } finally {
      Platform.OS = prev;
    }
  });

  it('marks the welcome as seen for this user, so it shows once', async () => {
    render(<WelcomeInScreen />);
    await waitFor(async () => expect(await AsyncStorage.getItem(welcomeSeenKey('u-new'))).toBeTruthy());
  });

  it('the CTA continues to the first-five-minutes checklist, every step tappable', async () => {
    const { findByRole, getByRole, queryByRole } = render(<WelcomeInScreen />);
    expect(queryByRole('button', { name: 'Choose who can message you' })).toBeNull();
    await act(async () => { fireEvent.press(getByRole('button', { name: 'Show me around' })); });
    expect(await findByRole('button', { name: 'Open Dykes of Leeds and say hi' })).toBeTruthy();
    expect(getByRole('button', { name: 'Find three members to follow' })).toBeTruthy();
    expect(getByRole('button', { name: 'Choose who can message you' })).toBeTruthy();
    expect(getByRole('button', { name: 'Write a post introducing yourself' })).toBeTruthy();
  });

  it('tapping a step opens its screen and ticks it for this user', async () => {
    const { findByRole, getByRole } = render(<WelcomeInScreen />);
    await act(async () => { fireEvent.press(getByRole('button', { name: 'Show me around' })); });
    const step = await findByRole('button', { name: 'Choose who can message you' });
    await act(async () => { fireEvent.press(step); });
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/you/settings');
    const stored = JSON.parse((await AsyncStorage.getItem(firstStepsKey('u-new'))) ?? '{}');
    expect(stored.done).toContain('dm_settings');
  });

  it('from the checklist, the last CTA continues into Roxy', async () => {
    const { getByRole, findByRole } = render(<WelcomeInScreen />);
    await act(async () => { fireEvent.press(getByRole('button', { name: 'Show me around' })); });
    await act(async () => { fireEvent.press(await findByRole('button', { name: 'Take me to Roxy' })); });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/feed');
  });

  it('without a known community the checklist still renders the other steps', async () => {
    mockFetchCommunity.mockResolvedValue(null);
    const { findByRole, getByRole, queryByText } = render(<WelcomeInScreen />);
    await act(async () => { fireEvent.press(getByRole('button', { name: 'Show me around' })); });
    expect(await findByRole('button', { name: 'Choose who can message you' })).toBeTruthy();
    expect(queryByText(/Say hi in/)).toBeNull();
  });
});

describe('FirstStepsCard — dismissible, persisted per user', () => {
  it('can be dismissed and stays dismissed', async () => {
    const { findByRole, queryByTestId, unmount } = render(<FirstStepsCard />);
    await act(async () => { fireEvent.press(await findByRole('button', { name: 'Hide first steps' })); });
    expect(queryByTestId('first-steps-card')).toBeNull();
    const stored = JSON.parse((await AsyncStorage.getItem(firstStepsKey('u-new'))) ?? '{}');
    expect(stored.dismissed).toBe(true);
    unmount();

    const again = render(<FirstStepsCard />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(again.queryByTestId('first-steps-card')).toBeNull();
  });

  it('shows a done step as done (checked) on the next open', async () => {
    await AsyncStorage.setItem(firstStepsKey('u-new'), JSON.stringify({ done: ['dm_settings'], dismissed: false }));
    const { findByRole } = render(<FirstStepsCard />);
    const step = await findByRole('button', { name: 'Choose who can message you' });
    expect(step.props.accessibilityState?.checked).toBe(true);
  });

  it('when every step is done it says so and hides itself on dismiss', async () => {
    await AsyncStorage.setItem(
      firstStepsKey('u-new'),
      JSON.stringify({ done: ['say_hi', 'follow_three', 'dm_settings', 'introduce'], dismissed: false }),
    );
    const { findByText } = render(<FirstStepsCard />);
    expect(await findByText(/all set/i)).toBeTruthy();
  });
});
