import type { PostType } from '../types';

/**
 * Community-owned content lives under /community/* so Connect/Discover feeds
 * open detail without switching tabs (feeds are filtered views of community posts).
 */
export function contentDetailPath(postId: string, postType: PostType): string {
  if (postType === 'video') {
    return `/community/video/${postId}`;
  }
  return `/community/post/${postId}`;
}
