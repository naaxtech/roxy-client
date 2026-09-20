/**
 * TikTok-style vertical paging maths.
 *
 * The web feed cannot trust native overflow + snapToInterval: a wheel tick
 * leaves the list between pages, a mouse drag never scrolls an overflow:auto
 * scroller, and a like re-render can freeze that mid-page offset. These helpers
 * decide the one page a gesture should land on.
 */

/** A drag shorter than this is a tap (like / pause), not a page turn. */
export const FEED_PAGE_DRAG_THRESHOLD = 64;

/**
 * Ignore residual trackpad ticks. A real wheel notch is ~100; a deliberate
 * flick is much more. Anything under this is noise, not a page request.
 */
export const FEED_PAGE_WHEEL_THRESHOLD = 8;

/** Nearest page-top for an offset that may be stuck between pages. */
export function snapPageOffset(y: number, pageH: number, count: number): number {
  if (!(pageH > 0) || count <= 0 || !Number.isFinite(y)) return 0;
  const max = count - 1;
  const page = Math.round(y / pageH);
  const index = Math.min(Math.max(page, 0), max);
  return index * pageH;
}

export function clampPageIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

/**
 * Signed page step from a signed delta. Positive delta → next page.
 * Wheel-down and swipe-up both feed a positive delta into this.
 */
export function pageStepFromDelta(delta: number, threshold: number): -1 | 0 | 1 {
  if (!(threshold > 0) || !Number.isFinite(delta)) return 0;
  if (delta > threshold) return 1;
  if (delta < -threshold) return -1;
  return 0;
}

export function pageStepFromWheel(deltaY: number): -1 | 0 | 1 {
  return pageStepFromDelta(deltaY, FEED_PAGE_WHEEL_THRESHOLD);
}

/** Finger up (end < start) is the next page, matching TikTok. */
export function pageStepFromDrag(startY: number, endY: number): -1 | 0 | 1 {
  return pageStepFromDelta(startY - endY, FEED_PAGE_DRAG_THRESHOLD);
}
