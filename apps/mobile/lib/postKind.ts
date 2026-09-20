import type { PostType } from '../types';

/**
 * Does this post lead with words rather than with a picture?
 *
 * One definition, because two surfaces have to agree about it and the profile
 * is where they stopped agreeing: `ProfilePostsGrid` squeezed text posts into
 * square photo cells, where a paragraph is cropped to a thumbnail and reads as
 * a broken image tile. Splitting them into their own tab only works if "which
 * posts are text" has a single answer.
 *
 * Composed from the types that ARE text-first, never by excluding the ones that
 * are not. `!== 'photo'` would sweep in every type added later — a poll, a
 * resource, an event — the way `!== 'receipt'` once counted purchase orders as
 * money owed.
 */
const TEXT_FIRST: readonly PostType[] = ['standard', 'roxy_link'];

export function isThought(postType: PostType): boolean {
  return TEXT_FIRST.includes(postType);
}

/** The complement, stated positively for the same reason. */
export function isMediaPost(postType: PostType): boolean {
  return !isThought(postType);
}
