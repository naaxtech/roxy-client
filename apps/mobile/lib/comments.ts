import { supabase } from './supabase';
import { COMMENT_WITH_AUTHOR } from './supabaseQueries';
import { logError } from './errorLogger';
import type { Comment } from '../types';

/**
 * Hang replies under their parent. The sheet and the detail route both
 * need this; doing it in two places is how one of them shipped without
 * replies at all.
 */
export function nestComments(rows: Comment[]): Comment[] {
  const byParent = new Map<string, Comment[]>();
  const top: Comment[] = [];
  for (const row of rows) {
    if (row.parent_id) {
      const list = byParent.get(row.parent_id) ?? [];
      list.push(row);
      byParent.set(row.parent_id, list);
    } else {
      top.push(row);
    }
  }
  return top.map((comment) => ({
    ...comment,
    replies: byParent.get(comment.id) ?? [],
  }));
}

export async function submitComment(params: {
  postId: string;
  authorId: string;
  content: string;
  parentId?: string | null;
}): Promise<{ comment: Comment | null; error: string | null }> {
  const { data, error } = await supabase
    .from('comments')
    .insert({
      post_id: params.postId,
      author_id: params.authorId,
      content: params.content.trim(),
      parent_id: params.parentId ?? null,
    })
    .select(COMMENT_WITH_AUTHOR)
    .single();

  if (error) return { comment: null, error: error.message };
  return { comment: data as Comment, error: null };
}

export async function loadPostComments(postId: string, userId?: string | null): Promise<{
  comments: Comment[];
  likedIds: Set<string>;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('comments')
    .select(COMMENT_WITH_AUTHOR)
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(80);

  if (error) {
    logError(error, 'loadPostComments');
    return { comments: [], likedIds: new Set(), error: error.message };
  }

  const nested = nestComments((data ?? []) as Comment[]);
  const ids = nested.flatMap((c) => [c.id, ...(c.replies ?? []).map((r) => r.id)]);
  if (!userId || ids.length === 0) {
    return { comments: nested, likedIds: new Set(), error: null };
  }

  const { data: likes, error: likeError } = await supabase
    .from('comment_likes')
    .select('comment_id')
    .in('comment_id', ids)
    .eq('user_id', userId);

  if (likeError) logError(likeError, 'loadPostComments.likes');
  return {
    comments: nested,
    likedIds: new Set((likes ?? []).map((row) => row.comment_id)),
    error: null,
  };
}

export function appendComment(list: Comment[], comment: Comment): Comment[] {
  if (!comment.parent_id) return [...list, { ...comment, replies: [] }];
  return list.map((row) => (
    row.id === comment.parent_id
      ? { ...row, replies: [...(row.replies ?? []), comment] }
      : row
  ));
}

export async function toggleCommentLike(params: {
  commentId: string;
  userId: string;
  liked: boolean;
}): Promise<{ error: string | null }> {
  if (params.liked) {
    const { error } = await supabase
      .from('comment_likes')
      .delete()
      .eq('comment_id', params.commentId)
      .eq('user_id', params.userId);
    return { error: error?.message ?? null };
  }
  const { error } = await supabase
    .from('comment_likes')
    .insert({ comment_id: params.commentId, user_id: params.userId });
  return { error: error?.message ?? null };
}
