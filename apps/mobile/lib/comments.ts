import { supabase } from './supabase';
import { COMMENT_WITH_AUTHOR } from './supabaseQueries';
import type { Comment } from '../types';

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
