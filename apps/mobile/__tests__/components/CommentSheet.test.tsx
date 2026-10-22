import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { Comment } from '../../types';

const mockToggle = jest.fn();
const mockOlder = jest.fn();
jest.mock('../../lib/comments', () => {
  const actual = jest.requireActual('../../lib/comments');
  return {
    ...actual,
    toggleCommentLike: (...a: unknown[]) => mockToggle(...a),
    loadOlderComments: (...a: unknown[]) => mockOlder(...a),
  };
});
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() }, callEdgeFunction: jest.fn() }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/haptics', () => ({ haptic: jest.fn(), tapLight: jest.fn(), celebrate: jest.fn() }));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../components/ui/popIn', () => ({ usePopIn: () => ({}) }));

import { CommentSheet } from '../../components/feed/CommentSheet';
import { COMMENT_MAX, COMMENT_PAGE } from '../../lib/comments';

function c(i: number): Comment {
  return {
    id: `c${i}`, post_id: 'p1', author_id: 'dana', parent_id: null,
    content: `text ${i}`, media_url: null, gif_url: null, like_count: 0,
    deleted_at: null, created_at: `2026-10-01T10:00:${String(i % 60).padStart(2, '0')}Z`,
    profiles: { display_name: 'Dana', avatar_url: null }, replies: [],
  };
}

const props = {
  visible: true, postId: 'p1', likedCommentIds: new Set<string>(), currentUserId: 'me',
  onClose: jest.fn(),
};

beforeEach(() => { mockToggle.mockReset(); mockOlder.mockReset(); });

describe('CommentSheet', () => {
  it('rolls a comment like back when the write fails', async () => {
    mockToggle.mockResolvedValue({ error: 'offline' });
    const r = render(<CommentSheet {...props} comments={[c(1)]} onCommentsChange={jest.fn()} />);
    await act(async () => { fireEvent.press(r.getByTestId('comment-like-c1')); });
    expect(mockToggle).toHaveBeenCalledWith({ commentId: 'c1', userId: 'me', liked: false });
    expect(r.getByTestId('comment-like-c1').props.accessibilityLabel).toBe('Like comment');
  });

  it('keeps the like when the write lands', async () => {
    mockToggle.mockResolvedValue({ error: null });
    const r = render(<CommentSheet {...props} comments={[c(1)]} onCommentsChange={jest.fn()} />);
    await act(async () => { fireEvent.press(r.getByTestId('comment-like-c1')); });
    expect(r.getByTestId('comment-like-c1').props.accessibilityLabel).toBe('Unlike comment');
  });

  it('caps the box at 1000 characters and shows a counter near the end', () => {
    const r = render(<CommentSheet {...props} comments={[]} onCommentsChange={jest.fn()} />);
    const input = r.getByTestId('comment-input');
    expect(input.props.maxLength).toBe(COMMENT_MAX);
    expect(r.queryByTestId('comment-counter')).toBeNull();
    fireEvent.changeText(input, 'x'.repeat(950));
    expect(r.getByTestId('comment-counter').props.children.join('')).toBe(`950 / ${COMMENT_MAX}`);
  });

  it('a full first page offers earlier comments and prepends them', async () => {
    const page = Array.from({ length: COMMENT_PAGE }, (_, i) => c(i + 100));
    mockOlder.mockResolvedValue({ comments: [c(1)], likedIds: new Set(), error: null, hasEarlier: false });
    const onCommentsChange = jest.fn();
    const r = render(<CommentSheet {...props} comments={page} onCommentsChange={onCommentsChange} />);
    await act(async () => { fireEvent.press(r.getByTestId('comments-load-earlier')); });
    expect(mockOlder).toHaveBeenCalledWith('p1', 'me', { created_at: page[0].created_at, id: page[0].id });
    const next = onCommentsChange.mock.calls[0][0] as Comment[];
    expect(next[0].id).toBe('c1');
    expect(next).toHaveLength(COMMENT_PAGE + 1);
  });

  it('a short thread does not offer earlier comments', () => {
    const r = render(<CommentSheet {...props} comments={[c(1)]} onCommentsChange={jest.fn()} />);
    expect(r.queryByTestId('comments-load-earlier')).toBeNull();
  });
});
