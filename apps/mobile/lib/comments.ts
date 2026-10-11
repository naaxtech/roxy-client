import { supabase, callEdgeFunction } from './supabase';
import { COMMENT_WITH_AUTHOR } from './supabaseQueries';
import { logError } from './errorLogger';
import type { Comment } from '../types';
import { REPORT_DETAIL_MAX } from '../components/feed/feedSafety';
import type { ReportReason } from '../components/feed/feedSafety';

/**
 * The database cap on a comment (045 `comments_content_check`: content is at
 * most 1000 characters). Every comment input sets `maxLength` to this and shows
 * a counter near the end, so she never meets the CHECK as a raw error.
 */
export const COMMENT_MAX = 1000;

/** How close to the cap the counter appears. */
export const COMMENT_COUNTER_FROM = 800;

/**
 * Top-level comments per page. Replies always come with their parent, so a
 * page can carry more rows than this.
 *
 * The thread used to fetch the OLDEST 80 rows ascending, so on a busy post the
 * newest comments — the ones a notification links to — were the ones cut. A
 * page is now the newest N top-level comments; "See earlier comments" walks
 * back from the oldest one on screen.
 */
export const COMMENT_PAGE = 50;

/** Where the next "earlier" page starts: the oldest top-level comment shown. */
export type CommentCursor = { created_at: string; id: string };

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
  gifUrl?: string | null;
  mediaUrl?: string | null;
}): Promise<{ comment: Comment | null; error: string | null }> {
  // Mirrors the CHECK so an over-long comment is refused in words she can act
  // on, before a request, instead of as a constraint name.
  if ((params.content?.trim().length ?? 0) > COMMENT_MAX) {
    return { comment: null, error: `Comments can be up to ${COMMENT_MAX} characters.` };
  }
  const { data, error } = await supabase
    .from('comments')
    .insert({
      post_id: params.postId,
      author_id: params.authorId,
      // A GIF-only reply has no caption; the CHECK (content OR media OR gif)
      // is what keeps a truly empty comment out.
      content: params.content?.trim() || null,
      parent_id: params.parentId ?? null,
      gif_url: params.gifUrl ?? null,
      media_url: params.mediaUrl ?? null,
    })
    .select(COMMENT_WITH_AUTHOR)
    .single();

  if (error) return { comment: null, error: error.message };
  return { comment: data as Comment, error: null };
}

export type CommentPage = {
  comments: Comment[];
  likedIds: Set<string>;
  error: string | null;
  /** There are top-level comments older than the first one in `comments`. */
  hasEarlier: boolean;
};

/**
 * One page of top-level comments, newest page first, shown oldest-first.
 *
 * Keyset on (created_at, id) so two comments in the same microsecond are
 * neither skipped nor repeated at a page edge. Replies to the page's comments
 * are fetched by parent id, so a late reply to an old comment is never lost to
 * a time window.
 */
async function loadCommentPage(
  postId: string,
  userId: string | null | undefined,
  before: CommentCursor | null,
): Promise<CommentPage> {
  let query = supabase
    .from('comments')
    .select(COMMENT_WITH_AUTHOR)
    .eq('post_id', postId)
    .is('parent_id', null);
  if (before) {
    query = query.or(
      `created_at.lt."${before.created_at}",and(created_at.eq."${before.created_at}",id.lt.${before.id})`,
    );
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(COMMENT_PAGE + 1);

  if (error) {
    logError(error, 'loadPostComments');
    return { comments: [], likedIds: new Set(), error: error.message, hasEarlier: false };
  }

  const rows = (data ?? []) as Comment[];
  const hasEarlier = rows.length > COMMENT_PAGE;
  const top = rows.slice(0, COMMENT_PAGE).reverse();
  const topIds = top.map((c) => c.id);

  let replies: Comment[] = [];
  if (topIds.length > 0) {
    const { data: replyRows, error: replyError } = await supabase
      .from('comments')
      .select(COMMENT_WITH_AUTHOR)
      .in('parent_id', topIds)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (replyError) {
      logError(replyError, 'loadPostComments.replies');
      return { comments: [], likedIds: new Set(), error: replyError.message, hasEarlier: false };
    }
    replies = (replyRows ?? []) as Comment[];
  }

  const nested = nestComments([...top, ...replies]);
  const ids = nested.flatMap((c) => [c.id, ...(c.replies ?? []).map((r) => r.id)]);
  if (!userId || ids.length === 0) {
    return { comments: nested, likedIds: new Set(), error: null, hasEarlier };
  }

  const { data: likes, error: likeError } = await supabase
    .from('comment_likes')
    .select('comment_id')
    .in('comment_id', ids)
    .eq('user_id', userId);

  if (likeError) logError(likeError, 'loadPostComments.likes');
  return {
    comments: nested,
    likedIds: new Set((likes ?? []).map((row: { comment_id: string }) => row.comment_id)),
    error: null,
    hasEarlier,
  };
}

/** The newest page of a thread. */
export function loadPostComments(postId: string, userId?: string | null): Promise<CommentPage> {
  return loadCommentPage(postId, userId, null);
}

/** The page before `before` (the oldest top-level comment on screen). */
export function loadOlderComments(
  postId: string,
  userId: string | null | undefined,
  before: CommentCursor,
): Promise<CommentPage> {
  return loadCommentPage(postId, userId, before);
}

/** The cursor for "See earlier comments", or null for an empty thread. */
export function oldestTopLevel(comments: Comment[]): CommentCursor | null {
  const first = comments[0];
  return first ? { created_at: first.created_at, id: first.id } : null;
}

/** Earlier page in front of what is on screen, without duplicating a row. */
export function prependEarlier(list: Comment[], earlier: Comment[]): Comment[] {
  const seen = new Set(list.map((c) => c.id));
  return [...earlier.filter((c) => !seen.has(c.id)), ...list];
}

export function appendComment(list: Comment[], comment: Comment): Comment[] {
  if (!comment.parent_id) return [...list, { ...comment, replies: [] }];
  return list.map((row) => (
    row.id === comment.parent_id
      ? { ...row, replies: [...(row.replies ?? []), comment] }
      : row
  ));
}

export type CommentRemoval = 'deleted' | 'removed';

/**
 * Delete her own comment through `delete_my_comment` (133). A comment with
 * replies is blanked ('removed') so other women's replies survive; one
 * without is deleted. Throws when nothing changed — dropping the row from the
 * screen on a no-op would tell her it was gone when it was not.
 */
export async function deleteMyComment(commentId: string): Promise<CommentRemoval> {
  const { data, error } = await supabase.rpc('delete_my_comment', { p_comment_id: commentId });
  if (error) {
    logError(error, 'deleteMyComment');
    throw new Error('delete-failed');
  }
  if (data !== 'deleted' && data !== 'removed') throw new Error('delete-noop');
  return data;
}

/** The thread after a delete: gone, or blanked in place with its replies. */
export function applyCommentRemoval(list: Comment[], commentId: string, outcome: CommentRemoval): Comment[] {
  const blank = (c: Comment): Comment => ({
    ...c, content: '', media_url: null, gif_url: null, deleted_at: c.deleted_at ?? new Date().toISOString(),
  });
  const out: Comment[] = [];
  for (const c of list) {
    if (c.id === commentId) {
      if (outcome === 'removed' || (c.replies?.length ?? 0) > 0) out.push(blank(c));
      continue;
    }
    const replies = (c.replies ?? []).filter((r) => r.id !== commentId);
    out.push(replies.length === (c.replies ?? []).length ? c : { ...c, replies });
  }
  return out;
}

/**
 * Comments from women she muted are not shown. A muted woman's top-level
 * comment that other people replied to stays as a quiet placeholder so the
 * replies keep their context; with no visible replies it is dropped.
 * Blocks are already applied by RLS (088 `comments_select`).
 */
export function hideMutedComments(list: Comment[], mutedIds: readonly string[]): Comment[] {
  if (mutedIds.length === 0) return list;
  const muted = new Set(mutedIds);
  const out: Comment[] = [];
  for (const c of list) {
    const replies = (c.replies ?? []).filter((r) => !muted.has(r.author_id));
    if (!muted.has(c.author_id)) {
      out.push(replies.length === (c.replies ?? []).length ? c : { ...c, replies });
    } else if (replies.length > 0) {
      out.push({ ...c, replies, mutedPlaceholder: true });
    }
  }
  return out;
}

/** Report a comment. Rejects when the report did not land. */
export async function reportComment(params: {
  commentId: string;
  authorId: string;
  reason: ReportReason;
  detail: string;
}): Promise<void> {
  const detail = params.detail.trim().slice(0, REPORT_DETAIL_MAX);
  const { error } = await callEdgeFunction('submit-report', {
    userId: params.authorId,
    contentType: 'comment',
    contentId: params.commentId,
    reason: params.reason,
    detail: detail || undefined,
  });
  if (error) {
    // Logged, not shown: the message can carry a database detail.
    logError(new Error(error), 'comments.reportComment');
    throw new Error('report-failed');
  }
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
