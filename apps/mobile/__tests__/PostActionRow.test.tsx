import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PostActionRow } from '../components/feed/PostActionRow';

const base = {
  likeCount: 12, saveCount: 5, commentCount: 3,
  isLiked: false, isSaved: false,
  onLike: jest.fn(), onSave: jest.fn(),
  onComment: jest.fn(), onShare: jest.fn(),
};

describe('PostActionRow', () => {
  it('renders like count', () => {
    const { getByText } = render(<PostActionRow {...base} />);
    expect(getByText('12')).toBeTruthy();
  });

  it('renders save count', () => {
    const { getByText } = render(<PostActionRow {...base} />);
    expect(getByText('5')).toBeTruthy();
  });

  it('renders comment count', () => {
    const { getByText } = render(<PostActionRow {...base} />);
    expect(getByText('3')).toBeTruthy();
  });

  it('calls onLike when heart pressed', () => {
    const onLike = jest.fn();
    const { getByTestId } = render(<PostActionRow {...base} onLike={onLike} />);
    fireEvent.press(getByTestId('action-like'));
    expect(onLike).toHaveBeenCalledTimes(1);
  });

  it('calls onSave when save pressed', () => {
    const onSave = jest.fn();
    const { getByTestId } = render(<PostActionRow {...base} onSave={onSave} />);
    fireEvent.press(getByTestId('action-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('calls onComment when 💬 pressed', () => {
    const onComment = jest.fn();
    const { getByTestId } = render(<PostActionRow {...base} onComment={onComment} />);
    fireEvent.press(getByTestId('action-comment'));
    expect(onComment).toHaveBeenCalledTimes(1);
  });

  it('heart is marked selected when isLiked=true', () => {
    const { getByTestId } = render(<PostActionRow {...base} isLiked={true} />);
    expect(getByTestId('action-like').props.accessibilityState?.selected).toBe(true);
  });
});
