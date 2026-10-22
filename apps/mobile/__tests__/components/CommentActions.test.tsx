import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { Comment } from '../../types';

const mockEdge = jest.fn();
const mockRpc = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a), from: jest.fn() },
  callEdgeFunction: (...a: unknown[]) => mockEdge(...a),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
const mockHaptic = jest.fn();
jest.mock('../../lib/haptics', () => ({ haptic: (...a: unknown[]) => mockHaptic(...a), tapLight: jest.fn(), celebrate: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { CommentThread } from '../../components/feed/CommentThread';
import { useSafetyStore } from '../../store/safetyStore';

function c(id: string, author: string, extra: Partial<Comment> = {}): Comment {
  return {
    id, post_id: 'p1', author_id: author, parent_id: null,
    content: `text ${id}`, media_url: null, gif_url: null, like_count: 0,
    deleted_at: null, created_at: '2026-10-01T10:00:00Z',
    profiles: { display_name: author === 'me' ? 'Me' : 'Dana', avatar_url: null },
    replies: [], ...extra,
  };
}

const base = {
  postId: 'p1', currentUserId: 'me', likedCommentIds: new Set<string>(),
  onLikeComment: jest.fn(), onReply: jest.fn(),
};

beforeEach(() => {
  mockEdge.mockReset();
  mockRpc.mockReset();
  useSafetyStore.setState({ mutedUserIds: [], blockedUserIds: [] });
});

describe('comment actions (FEED-04)', () => {
  it('⋯ on someone else’s comment → Report files a comment report', async () => {
    mockEdge.mockResolvedValue({ data: { ok: true }, error: null });
    const r = render(<CommentThread {...base} comments={[c('c1', 'dana')]} onRemoved={jest.fn()} />);
    fireEvent.press(r.getByTestId('comment-c1-more'));
    expect(r.queryByTestId('comment-action-delete')).toBeNull();
    fireEvent.press(r.getByTestId('comment-action-report'));
    fireEvent.press(r.getByTestId('comment-reason-harassment'));
    await act(async () => { fireEvent.press(r.getByTestId('comment-report-submit')); });
    expect(mockEdge).toHaveBeenCalledWith('submit-report', expect.objectContaining({
      contentType: 'comment', contentId: 'c1', userId: 'dana', reason: 'harassment',
    }));
    expect(r.getByTestId('comment-actions-done')).toBeTruthy();
  });

  it('long-press opens the same menu', () => {
    const r = render(<CommentThread {...base} comments={[c('c1', 'dana')]} />);
    fireEvent(r.getByTestId('comment-c1'), 'longPress');
    expect(r.getByTestId('comment-actions-sheet')).toBeTruthy();
  });

  // §3.3 / P3 (Wave 3): a long-press that opens a menu ticks once (selection);
  // the ⋯ button opening the same menu is a plain tap with no haptic.
  it('the long-press ticks once as a selection; the ⋯ tap plays no haptic', () => {
    mockHaptic.mockReset();
    const r = render(<CommentThread {...base} comments={[c('c1', 'dana')]} />);
    fireEvent.press(r.getByTestId('comment-c1-more'));
    expect(mockHaptic).not.toHaveBeenCalled();
    const r2 = render(<CommentThread {...base} comments={[c('c2', 'dana')]} />);
    fireEvent(r2.getByTestId('comment-c2'), 'longPress');
    expect(mockHaptic.mock.calls).toEqual([['selection']]);
  });

  it('a failed report says so and keeps the sheet on the form', async () => {
    mockEdge.mockResolvedValue({ data: null, error: 'nope' });
    const r = render(<CommentThread {...base} comments={[c('c1', 'dana')]} />);
    fireEvent.press(r.getByTestId('comment-c1-more'));
    fireEvent.press(r.getByTestId('comment-action-report'));
    fireEvent.press(r.getByTestId('comment-reason-spam'));
    await act(async () => { fireEvent.press(r.getByTestId('comment-report-submit')); });
    expect(r.getByTestId('comment-actions-error')).toBeTruthy();
    expect(r.queryByTestId('comment-actions-done')).toBeNull();
  });

  it('her own comment offers Delete, which calls delete_my_comment and tells the host', async () => {
    mockRpc.mockResolvedValue({ data: 'deleted', error: null });
    const onRemoved = jest.fn();
    const r = render(<CommentThread {...base} comments={[c('c1', 'me')]} onRemoved={onRemoved} />);
    fireEvent.press(r.getByTestId('comment-c1-more'));
    expect(r.queryByTestId('comment-action-report')).toBeNull();
    fireEvent.press(r.getByTestId('comment-action-delete'));
    await act(async () => { fireEvent.press(r.getByTestId('comment-delete-confirm')); });
    expect(mockRpc).toHaveBeenCalledWith('delete_my_comment', { p_comment_id: 'c1' });
    expect(onRemoved).toHaveBeenCalledWith('c1', 'deleted');
  });

  it('mute from the sheet hides her comments in the thread at once', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const r = render(<CommentThread {...base} comments={[c('c1', 'dana'), c('c2', 'other')]} />);
    fireEvent.press(r.getByTestId('comment-c1-more'));
    await act(async () => { fireEvent.press(r.getByTestId('comment-action-mute')); });
    expect(mockRpc).toHaveBeenCalledWith('mute_user', { p_target_id: 'dana' });
    fireEvent.press(r.getByTestId('comment-actions-done-close'));
    await waitFor(() => expect(r.queryByText('text c1')).toBeNull());
    expect(r.getByText('text c2')).toBeTruthy();
  });

  it('block from the sheet is confirmed, then hides her', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const r = render(<CommentThread {...base} comments={[c('c1', 'dana')]} />);
    fireEvent.press(r.getByTestId('comment-c1-more'));
    fireEvent.press(r.getByTestId('comment-action-block'));
    expect(mockRpc).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(r.getByTestId('comment-block-confirm')); });
    expect(mockRpc).toHaveBeenCalledWith('block_user', { p_target_id: 'dana' });
    await waitFor(() => expect(r.queryByText('text c1')).toBeNull());
  });
});

describe('muted authors (PRO-06)', () => {
  it('drops a muted woman’s comments and replies; keeps a placeholder when others replied', () => {
    useSafetyStore.setState({ mutedUserIds: ['dana'] });
    const parent = c('c1', 'dana', { replies: [c('r1', 'other', { parent_id: 'c1' }), c('r2', 'dana', { parent_id: 'c1' })] });
    const r = render(<CommentThread {...base} comments={[parent, c('c2', 'dana')]} />);
    expect(r.queryByText('text c1')).toBeNull();
    expect(r.queryByText('text c2')).toBeNull();
    expect(r.queryByText('text r2')).toBeNull();
    expect(r.getByText('text r1')).toBeTruthy();
    expect(r.getByTestId('comment-c1-muted')).toBeTruthy();
  });
});

describe('earlier comments', () => {
  it('shows "See earlier comments" when there are more and calls the loader', () => {
    const onLoadEarlier = jest.fn();
    const r = render(<CommentThread {...base} comments={[c('c1', 'dana')]} hasEarlier onLoadEarlier={onLoadEarlier} />);
    fireEvent.press(r.getByTestId('comments-load-earlier'));
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });
  it('hides it when the thread is complete', () => {
    const r = render(<CommentThread {...base} comments={[c('c1', 'dana')]} onLoadEarlier={jest.fn()} />);
    expect(r.queryByTestId('comments-load-earlier')).toBeNull();
  });
});
