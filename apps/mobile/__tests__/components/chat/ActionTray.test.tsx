import React from 'react';
import { act, render, fireEvent } from '@testing-library/react-native';
import { ActionTray } from '../../../components/chat/ActionTray';

const defaultProps = {
  onEmojiPress: jest.fn(),
  onGifPress: jest.fn(),
  onWingwomanPress: jest.fn(),
  onNudgePress: jest.fn(),
  wingwomanLoading: false,
  nudgeLoading: false,
};

describe('ActionTray', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders Emoji, GIF, Wingwoman, and Nudge chips', () => {
    const { getByText } = render(<ActionTray {...defaultProps} />);
    expect(getByText('Emoji')).toBeTruthy();
    expect(getByText('GIF')).toBeTruthy();
    expect(getByText('Wingwoman')).toBeTruthy();
    expect(getByText('Nudge')).toBeTruthy();
  });

  it('calls onEmojiPress when Emoji chip tapped', () => {
    const onEmojiPress = jest.fn();
    const { getByText } = render(<ActionTray {...defaultProps} onEmojiPress={onEmojiPress} />);
    fireEvent.press(getByText('Emoji'));
    expect(onEmojiPress).toHaveBeenCalled();
  });

  it('calls onGifPress when GIF chip tapped', () => {
    const onGifPress = jest.fn();
    const { getByText } = render(<ActionTray {...defaultProps} onGifPress={onGifPress} />);
    fireEvent.press(getByText('GIF'));
    expect(onGifPress).toHaveBeenCalled();
  });

  it('calls onWingwomanPress when Wingwoman chip tapped', () => {
    const onWingwomanPress = jest.fn();
    const { getByText } = render(<ActionTray {...defaultProps} onWingwomanPress={onWingwomanPress} />);
    fireEvent.press(getByText('Wingwoman'));
    expect(onWingwomanPress).toHaveBeenCalled();
  });

  it('calls onNudgePress when Nudge chip tapped', () => {
    const onNudgePress = jest.fn();
    const { getByText } = render(<ActionTray {...defaultProps} onNudgePress={onNudgePress} />);
    fireEvent.press(getByText('Nudge'));
    expect(onNudgePress).toHaveBeenCalled();
  });

  // F11: no spinner; a wait over 200 ms swaps the label for the faceless O.
  it('a slow Wingwoman wait swaps its label for the loading O after 200 ms (never a spinner)', () => {
    jest.useFakeTimers();
    const v = render(<ActionTray {...defaultProps} wingwomanLoading={true} />);
    expect(v.getByText('Wingwoman')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(200); });
    expect(v.queryByText('Wingwoman')).toBeNull();
    expect(v.getByLabelText('Roxy is thinking')).toBeTruthy();
    expect(v.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
    jest.useRealTimers();
  });

  it('a slow Nudge wait swaps its label for the loading O after 200 ms (never a spinner)', () => {
    jest.useFakeTimers();
    const v = render(<ActionTray {...defaultProps} nudgeLoading={true} />);
    expect(v.getByText('Nudge')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(200); });
    expect(v.queryByText('Nudge')).toBeNull();
    expect(v.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
    jest.useRealTimers();
  });
});
