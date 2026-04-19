import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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

  it('shows spinner and hides Wingwoman label when loading', () => {
    const { queryByText } = render(
      <ActionTray {...defaultProps} wingwomanLoading={true} />
    );
    expect(queryByText('Wingwoman')).toBeNull(); // replaced by spinner
  });

  it('shows spinner and hides Nudge label when loading', () => {
    const { queryByText } = render(
      <ActionTray {...defaultProps} nudgeLoading={true} />
    );
    expect(queryByText('Nudge')).toBeNull(); // replaced by spinner
  });
});
