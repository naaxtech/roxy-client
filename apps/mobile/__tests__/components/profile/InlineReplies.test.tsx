import React from 'react';
import { ActivityIndicator } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { InlineReplies } from '../../../components/profile/InlineReplies';

/**
 * F10 for thought replies (M099): the reply is in the thread in the same frame
 * as the tap; a refused reply comes back out, her words go back in the box and
 * a snackbar offers Retry. `submitComment` is a promise this file holds open or
 * answers, so nothing is written anywhere.
 */

const mockSubmit = jest.fn();
const mockLoad = jest.fn();
jest.mock('../../../lib/comments', () => ({
  ...jest.requireActual('../../../lib/comments'),
  loadPostComments: (...a: unknown[]) => mockLoad(...a),
  submitComment: (...a: unknown[]) => mockSubmit(...a),
}));
jest.mock('../../../lib/analytics', () => ({ Analytics: { thoughtReplySent: jest.fn() } }));
jest.mock('../../../components/chat/GifPicker', () => ({ GifPicker: () => null }));
jest.mock('../../../store/profileStore', () => ({
  useProfileStore: (sel: (s: unknown) => unknown) => sel({ profile: { display_name: 'Jo', avatar_url: null } }),
}));

const saved = (id: string, content: string) => ({
  id, post_id: 'p1', author_id: 'me', parent_id: null, content, media_url: null, gif_url: null,
  like_count: 0, deleted_at: null, created_at: '2026-10-23T10:00:00Z', profiles: { display_name: 'Jo', avatar_url: null },
});

beforeEach(() => {
  mockSubmit.mockReset();
  mockLoad.mockReset().mockResolvedValue({ comments: [], error: null });
});

const ready = async () => {
  const onCountChange = jest.fn();
  const v = render(<InlineReplies postId="p1" currentUserId="me" onCountChange={onCountChange} />);
  await waitFor(() => expect(v.getByTestId('inline-replies-empty')).toBeTruthy());
  return { v, onCountChange };
};

describe('InlineReplies is optimistic (F10)', () => {
  it('her reply shows in the thread in the same frame, before the write answers', async () => {
    mockSubmit.mockImplementation(() => new Promise(() => undefined));
    const { v } = await ready();
    fireEvent.changeText(v.getByTestId('inline-replies-input'), 'so true');
    act(() => { fireEvent.press(v.getByTestId('inline-replies-send')); });
    expect(v.getByText('so true')).toBeTruthy();
    expect(v.getByTestId('inline-replies-input').props.value).toBe('');
    expect(v.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    expect(mockSubmit).toHaveBeenCalledWith({ postId: 'p1', authorId: 'me', content: 'so true' });
  });

  it('the saved reply replaces the provisional one and the tally counts it once', async () => {
    let answer: (v: unknown) => void = () => undefined;
    mockSubmit.mockImplementation(() => new Promise((r) => { answer = r; }));
    const { v, onCountChange } = await ready();
    fireEvent.changeText(v.getByTestId('inline-replies-input'), 'so true');
    act(() => { fireEvent.press(v.getByTestId('inline-replies-send')); });
    await act(async () => { answer({ comment: saved('c9', 'so true'), error: null }); });
    expect(v.getAllByText('so true')).toHaveLength(1);
    expect(v.getByTestId('inline-replies-c9')).toBeTruthy();
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });

  it('a refused reply comes back out, her words return, and a snackbar offers Retry', async () => {
    mockSubmit.mockResolvedValueOnce({ comment: null, error: 'That reply did not send.' });
    const { v, onCountChange } = await ready();
    fireEvent.changeText(v.getByTestId('inline-replies-input'), 'so true');
    await act(async () => { fireEvent.press(v.getByTestId('inline-replies-send')); });

    expect(v.queryByText('so true')).toBeNull();
    expect(v.getByTestId('inline-replies-input').props.value).toBe('so true');
    expect(v.getByTestId('inline-replies-snackbar')).toBeTruthy();
    expect(v.getByText('That reply did not send.')).toBeTruthy();
    expect(onCountChange).not.toHaveBeenCalledWith(1);

    mockSubmit.mockImplementation(() => new Promise(() => undefined));
    act(() => { fireEvent.press(v.getByTestId('inline-replies-snackbar-action')); });
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(v.getByText('so true')).toBeTruthy();
    expect(v.getByTestId('inline-replies-input').props.value).toBe('');
  });
});
