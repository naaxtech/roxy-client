import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CommentThread } from '../components/feed/CommentThread';
import type { Comment } from '../types';

function makeComment(id: string, replies: Comment[] = []): Comment {
  return {
    id, post_id: 'p1', author_id: 'u1', parent_id: null,
    content: `Comment ${id}`, media_url: null, gif_url: null,
    like_count: 0, deleted_at: null, created_at: '',
    profiles: { display_name: 'Maya', avatar_url: null },
    replies,
  };
}

describe('CommentThread', () => {
  it('renders top-level comments', () => {
    const { getByText } = render(
      <CommentThread
        postId="p1"
        comments={[makeComment('c1'), makeComment('c2')]}
        currentUserId="u1"
        likedCommentIds={new Set()}
        onLikeComment={jest.fn()}
        onReply={jest.fn()}
      />
    );
    expect(getByText('Comment c1')).toBeTruthy();
    expect(getByText('Comment c2')).toBeTruthy();
  });

  it('deleted comment shows "This comment was removed."', () => {
    const deleted: Comment = {
      ...makeComment('c3'),
      content: null,
      deleted_at: '2026-04-01T00:00:00Z',
    };
    const { getByText } = render(
      <CommentThread
        postId="p1" comments={[deleted]} currentUserId="u1"
        likedCommentIds={new Set()} onLikeComment={jest.fn()} onReply={jest.fn()}
      />
    );
    expect(getByText('This comment was removed.')).toBeTruthy();
  });

  it('calls onReply when Reply tapped', () => {
    const onReply = jest.fn();
    const { getByText } = render(
      <CommentThread
        postId="p1" comments={[makeComment('c1')]} currentUserId="u1"
        likedCommentIds={new Set()} onLikeComment={jest.fn()} onReply={onReply}
      />
    );
    fireEvent.press(getByText('Reply'));
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('shows view-more when >2 replies', () => {
    const replies = [1, 2, 3, 4].map(i => ({
      ...makeComment(`r${i}`),
      parent_id: 'c1',
    }));
    const comment = makeComment('c1', replies);
    const { getByTestId } = render(
      <CommentThread
        postId="p1" comments={[comment]} currentUserId="u1"
        likedCommentIds={new Set()} onLikeComment={jest.fn()} onReply={jest.fn()}
      />
    );
    expect(getByTestId('view-more-replies')).toBeTruthy();
  });

  it('tapping view-more expands all replies', () => {
    const replies = [1, 2, 3, 4].map(i => ({
      ...makeComment(`r${i}`),
      parent_id: 'c1',
    }));
    const comment = makeComment('c1', replies);
    const { getByTestId, queryByTestId } = render(
      <CommentThread
        postId="p1" comments={[comment]} currentUserId="u1"
        likedCommentIds={new Set()} onLikeComment={jest.fn()} onReply={jest.fn()}
      />
    );
    fireEvent.press(getByTestId('view-more-replies'));
    expect(queryByTestId('view-more-replies')).toBeNull();
  });
});
