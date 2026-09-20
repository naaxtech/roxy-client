import type { Post } from '../types';

/**
 * A post as the reels list holds it: the row plus the community name the list
 * joins in, so a cell can label itself without a second query.
 */
export type ReelRow = Post & { communities: { name: string } | null };

/**
 * Drop videos the viewer has already watched from a freshly fetched page.
 *
 * Unlike `feedStore`'s card-feed filter this one refuses to filter a page down
 * to nothing: the reels list renders "No videos yet" on an empty array, and a
 * returning viewer whose whole first page is already seen would be told her
 * communities have never posted video. When every row is seen the page is
 * served unchanged — a repeat beats a lie.
 */
export function excludeSeenReels<T extends Pick<Post, 'id'>>(
  rows: T[],
  seenIds: Set<string>,
): T[] {
  if (!rows.length || !seenIds.size) return rows;
  const unseen = rows.filter((r) => !seenIds.has(r.id));
  return unseen.length > 0 ? unseen : rows;
}

/**
 * The like count to render for a post held in a list of its own.
 *
 * `feedStore.toggleLike` adjusts the copies inside `feedStore.posts`, but the
 * reels list and the Connect card feed each fetch and hold their own rows, so
 * their `like_count` is frozen at fetch time and a tap on the rail leaves the
 * number unchanged. The store publishes the net per-post delta instead, and any
 * list holding its own copy applies it here.
 */
export function displayedLikeCount(
  post: Pick<Post, 'id' | 'like_count'>,
  deltas: Record<string, number>,
): number {
  return Math.max(0, post.like_count + (deltas[post.id] ?? 0));
}

/**
 * Which page a vertical pager is showing, derived from its scroll offset.
 *
 * `onViewableItemsChanged` cannot be the only source of the active index: on a
 * fast flick it fires with an EMPTY `viewableItems` array, so a feed that trusts
 * it alone never leaves the cell it started on — the previous clip keeps playing
 * its audio underneath the new cell's black frame. The scroll offset is always
 * truthful, so it is the fallback.
 *
 * Clamped into range, and 0 before the page has been measured, so the result is
 * always a valid index rather than NaN or an out-of-bounds read.
 */
export function activeIndexFromScroll(
  scrollY: number,
  pageHeight: number,
  count: number,
): number {
  if (count <= 0) return 0;
  if (!(pageHeight > 0) || !Number.isFinite(scrollY)) return 0;
  const index = Math.round(scrollY / pageHeight);
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

/**
 * Where the reels list should open when the viewer arrived by tapping one
 * specific video in the card feed.
 *
 * Falls back to the top of the list rather than throwing when the post is not
 * in the page — the caller has already tried to splice it in, and opening at a
 * neighbouring video beats opening at nothing.
 */
export function initialReelIndex<T extends Pick<Post, 'id'>>(
  rows: T[],
  postId: string | null | undefined,
): number {
  if (!postId) return 0;
  const index = rows.findIndex((r) => r.id === postId);
  return index >= 0 ? index : 0;
}
