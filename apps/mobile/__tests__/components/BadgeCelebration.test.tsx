import React from 'react';
import { Modal } from 'react-native';
import { act, render, fireEvent } from '@testing-library/react-native';
import { BadgeCelebration } from '../../components/gamification/BadgeCelebration';

/**
 * Decision P6 (2026-10-23): the badge celebration overlay becomes a quiet
 * snackbar. It still names what she earned (a reward nobody renders is not a
 * reward), but it never takes the screen: no Modal, no scrim, no confetti, no
 * pop, no haptic. "View" opens her badges; it leaves on its own.
 */
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
const mockHaptic = jest.fn();
jest.mock('../../lib/haptics', () => ({
  haptic: (...a: unknown[]) => mockHaptic(...a),
  celebrate: (...a: unknown[]) => mockHaptic('celebrate', ...a),
  tapLight: (...a: unknown[]) => mockHaptic('tapLight', ...a),
}));

const badge = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Badge ${id}`, emoji: '🏅', description: 'Made your first friend', points: 10, ...over,
});

beforeEach(() => { mockPush.mockClear(); mockHaptic.mockClear(); });

describe('BadgeCelebration (P6: a quiet snackbar)', () => {
  it('names the badge she earned in one line, with a View action', () => {
    const v = render(<BadgeCelebration badges={[badge('a')]} onDismiss={jest.fn()} />);
    expect(v.getByTestId('badge-celebration')).toBeTruthy();
    expect(v.getByText('You earned Badge a 🏅')).toBeTruthy();
    expect(v.getByText('View')).toBeTruthy();
  });

  it('several at once: one line that counts them', () => {
    const v = render(<BadgeCelebration badges={[badge('a'), badge('b'), badge('c')]} onDismiss={jest.fn()} />);
    expect(v.getByText('You earned 3 badges')).toBeTruthy();
  });

  it('never takes the screen: no Modal, no scrim, no confetti, no haptic', () => {
    const v = render(<BadgeCelebration badges={[badge('a')]} onDismiss={jest.fn()} />);
    expect(v.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
    expect(v.queryByTestId('confetti')).toBeNull();
    expect(mockHaptic).not.toHaveBeenCalled();
  });

  it('View opens her badges and clears the celebration', () => {
    const onDismiss = jest.fn();
    const v = render(<BadgeCelebration badges={[badge('a')]} onDismiss={onDismiss} />);
    fireEvent.press(v.getByText('View'));
    expect(mockPush).toHaveBeenCalledWith('/badges');
    expect(onDismiss).toHaveBeenCalled();
  });

  it('leaves on its own after the snackbar time', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(<BadgeCelebration badges={[badge('a')]} onDismiss={onDismiss} />);
    act(() => { jest.advanceTimersByTime(7000); });
    expect(onDismiss).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('renders nothing at all when there is nothing to celebrate', () => {
    const v = render(<BadgeCelebration badges={[]} onDismiss={jest.fn()} />);
    expect(v.queryByTestId('badge-celebration')).toBeNull();
  });
});
