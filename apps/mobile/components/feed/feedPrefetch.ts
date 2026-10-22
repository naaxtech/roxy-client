import { getPostImageUrl } from '../../lib/media';
import { isPresetAvatar } from '../../lib/avatars';
import type { ReelRow } from '../../lib/reels';

/**
 * Which images the next feed pages show first, so they can be warmed before
 * she lands on them (budget F15; motion-spec §3 row 8: "the next 2 cells are
 * mounted and their first image prefetched").
 */

/** How many pages past the one she is on get their images warmed. */
export const PREFETCH_AHEAD = 2;

/** Anything the pager can hold; only posts carry images. */
type PagerItem = { id: string } & Partial<ReelRow>;

/**
 * The first things a page draws: the photo (only the first of a gallery) or
 * the clip's poster (never the video itself — that is `FeedVideoPlayer`'s
 * preload decision), and the author's face. The URLs are the ones the cells
 * request, so the warmed cache entries are the ones they hit.
 */
export function feedCellImageUrls(item: PagerItem): string[] {
  if (typeof item.post_type !== 'string') return [];
  const urls: string[] = [];
  const firstPhoto = item.media_urls?.[0];
  if (item.video_url) {
    if (item.video_thumbnail_url) urls.push(getPostImageUrl(item.video_thumbnail_url, 'detail'));
  } else if (firstPhoto) {
    urls.push(getPostImageUrl(firstPhoto, 'detail'));
  }
  const face = item.profiles?.avatar_url;
  // A preset face is an emoji on a colour, not a file.
  if (face && !isPresetAvatar(face)) urls.push(face);
  return urls;
}

/** The images of the `PREFETCH_AHEAD` pages after `index`. */
export function imagesAhead(items: readonly PagerItem[], index: number): string[] {
  return items.slice(index + 1, index + 1 + PREFETCH_AHEAD).flatMap(feedCellImageUrls);
}
