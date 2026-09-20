import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BadgeCelebration } from '../../components/gamification/BadgeCelebration';

jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
let mockReduced = false;

const badge = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Badge ${id}`, emoji: '🏅', description: 'Made your first friend', points: 10, ...over,
});

beforeEach(() => { mockReduced = false; });

describe('BadgeCelebration', () => {
  it('names the badge and says why she got it', () => {
    // A celebration that cannot name the badge is a toast. Duolingo's whole
    // lesson is that the moment is about the specific thing you did.
    const v = render(<BadgeCelebration badges={[badge('a')]} onDismiss={jest.fn()} />);
    expect(v.getByText('Badge a')).toBeTruthy();
    expect(v.getByText('Made your first friend')).toBeTruthy();
    expect(v.getByText('+10 points')).toBeTruthy();
  });

  it('shows one badge at a time when several land together', () => {
    // Three at once is a list, and a list is not a celebration.
    const onDismiss = jest.fn();
    const v = render(
      <BadgeCelebration badges={[badge('a'), badge('b')]} onDismiss={onDismiss} />,
    );
    expect(v.getByText('1 of 2')).toBeTruthy();
    expect(v.queryByText('Badge b')).toBeNull();

    fireEvent.press(v.getByTestId('badge-celebration-next'));
    expect(v.getByText('Badge b')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.press(v.getByTestId('badge-celebration-next'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('does not count "1 of 1" at a woman who earned one thing', () => {
    const v = render(<BadgeCelebration badges={[badge('a')]} onDismiss={jest.fn()} />);
    expect(v.queryByText('1 of 1')).toBeNull();
  });

  it('drops the confetti entirely under reduced motion, and still works', () => {
    // A burst is pure decoration, so the right amount for someone who asked for
    // less movement is none — not a slower one.
    mockReduced = true;
    const onDismiss = jest.fn();
    const v = render(<BadgeCelebration badges={[badge('a')]} onDismiss={onDismiss} />);
    expect(v.queryByTestId('confetti')).toBeNull();
    expect(v.getByText('Badge a')).toBeTruthy();
    fireEvent.press(v.getByTestId('badge-celebration-next'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders nothing at all when there is nothing to celebrate', () => {
    const v = render(<BadgeCelebration badges={[]} onDismiss={jest.fn()} />);
    expect(v.queryByTestId('badge-celebration')).toBeNull();
  });

  it('omits the points line for a badge worth none', () => {
    const v = render(<BadgeCelebration badges={[badge('a', { points: 0 })]} onDismiss={jest.fn()} />);
    expect(v.queryByText(/points/)).toBeNull();
  });
});
