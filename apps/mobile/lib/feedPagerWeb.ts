import {
  clampPageIndex,
  pageStepFromDrag,
  pageStepFromWheel,
} from './feedPagerSnap';

export interface FeedPagerWebControllerOptions {
  getPageH: () => number;
  getCount: () => number;
  getIndex: () => number;
  goToIndex: (index: number) => void;
  now?: () => number;
  lockMs?: number;
}

export interface FeedPagerWebController {
  onWheel: (event: Pick<WheelEvent, 'deltaY' | 'preventDefault'>) => void;
  onPointerDown: (event: Pick<PointerEvent, 'clientY' | 'pointerId'> & {
    target?: EventTarget | null;
  }) => void;
  onPointerUp: (event: Pick<PointerEvent, 'clientY' | 'pointerId'>) => void;
  onClickCapture: (event: Pick<MouseEvent, 'preventDefault' | 'stopPropagation'>) => void;
}

/**
 * One vertical gesture = one page. Native web scroll is not used:
 * overflow:auto ignores mouse-drag, and snapToInterval leaves the list
 * between pages so the next gesture has nowhere to go.
 */
export function createFeedPagerWebController({
  getPageH,
  getCount,
  getIndex,
  goToIndex,
  now = Date.now,
  lockMs = 420,
}: FeedPagerWebControllerOptions): FeedPagerWebController {
  let lockedUntil = 0;
  let startY: number | null = null;
  let swallowClick = false;

  const pageBy = (step: -1 | 0 | 1): boolean => {
    if (step === 0 || !(getPageH() > 0)) return false;
    const t = now();
    if (t < lockedUntil) return false;
    const next = clampPageIndex(getIndex() + step, getCount());
    if (next === getIndex()) return false;
    lockedUntil = t + lockMs;
    goToIndex(next);
    return true;
  };

  return {
    onWheel(event) {
      event.preventDefault();
      pageBy(pageStepFromWheel(event.deltaY));
    },
    onPointerDown(event) {
      startY = event.clientY;
      const target = event.target as { setPointerCapture?: (id: number) => void } | null;
      target?.setPointerCapture?.(event.pointerId);
    },
    onPointerUp(event) {
      if (startY == null) return;
      const step = pageStepFromDrag(startY, event.clientY);
      startY = null;
      if (pageBy(step)) swallowClick = true;
    },
    onClickCapture(event) {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

export function findWebNode(ref: { current: unknown }): HTMLElement | null {
  const value = ref.current as
    | HTMLElement
    | { getNode?: () => unknown }
    | null;
  if (!value) return null;
  if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) return value;
  // `value` is still the union here: the instanceof above narrows only the
  // branch it returns from. React Native Web's ref may be a host node or a
  // legacy wrapper exposing getNode(), so ask for the property rather than
  // assuming the shape.
  const wrapper = value as { getNode?: () => unknown };
  if (typeof wrapper.getNode === 'function') {
    const node = wrapper.getNode();
    if (node instanceof HTMLElement) return node;
  }
  return null;
}

/** FlashList's first scrollToOffset on web is often a no-op. Write the scroller. */
/**
 * How long a page takes to glide into place.
 *
 * TikTok's transition is fast and eased, not instant. This was
 * `scroller.scrollTop = offset` — a teleport — so the web feed changed posts
 * without ever appearing to move, which is the opposite of satisfying and made
 * it impossible to tell which direction you had just gone.
 *
 * 280ms sits inside the controller's 420ms gesture lock, so an animation is
 * always finished before the next swipe is allowed to start one.
 */
export const PAGE_GLIDE_MS = 280;

/** Ease-out cubic: quick off the mark, settling gently. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/** Cancels any glide already running on this scroller. */
const running = new WeakMap<HTMLElement, number>();

function cancelGlide(scroller: HTMLElement): void {
  const id = running.get(scroller);
  if (id !== undefined && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(id);
  }
  running.delete(scroller);
}

/**
 * Whether the viewer has asked for less movement. An animation is a nicety; her
 * setting is not.
 */
function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function applyWebPageOffset(root: HTMLElement, offset: number): void {
  const scroller = findOverflowScroller(root);
  if (!scroller || !Number.isFinite(offset)) return;

  // A second request supersedes the first; two glides on one element fight and
  // the page ends up between two posts.
  cancelGlide(scroller);

  const from = scroller.scrollTop;
  const distance = offset - from;
  if (
    distance === 0
    || prefersReducedMotion()
    || typeof requestAnimationFrame !== 'function'
    || typeof performance === 'undefined'
  ) {
    scroller.scrollTop = offset;
    return;
  }

  const started = performance.now();
  const step = () => {
    const elapsed = performance.now() - started;
    const progress = elapsed / PAGE_GLIDE_MS;
    if (progress >= 1) {
      scroller.scrollTop = offset;
      running.delete(scroller);
      return;
    }
    scroller.scrollTop = from + distance * easeOutCubic(progress);
    running.set(scroller, requestAnimationFrame(step));
  };
  running.set(scroller, requestAnimationFrame(step));
}

export function findOverflowScroller(root: HTMLElement): HTMLElement | null {
  if (typeof getComputedStyle === 'undefined') return null;
  const nodes: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  for (const el of nodes) {
    const style = getComputedStyle(el);
    if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll')
      && el.scrollHeight > el.clientHeight + 2
    ) {
      return el;
    }
  }
  return null;
}

export function attachFeedPagerWebGestures(
  node: HTMLElement,
  controller: FeedPagerWebController,
): () => void {
  const onWheel = (event: WheelEvent) => controller.onWheel(event);
  const onPointerDown = (event: PointerEvent) => controller.onPointerDown(event);
  const onPointerUp = (event: PointerEvent) => controller.onPointerUp(event);
  const onClick = (event: MouseEvent) => controller.onClickCapture(event);

  node.addEventListener('wheel', onWheel, { passive: false, capture: true });
  node.addEventListener('pointerdown', onPointerDown, true);
  node.addEventListener('pointerup', onPointerUp, true);
  node.addEventListener('click', onClick, true);

  return () => {
    node.removeEventListener('wheel', onWheel, true);
    node.removeEventListener('pointerdown', onPointerDown, true);
    node.removeEventListener('pointerup', onPointerUp, true);
    node.removeEventListener('click', onClick, true);
  };
}

/**
 * Does this device drive the feed with a finger?
 *
 * `(pointer: coarse)` is the touch case — a phone or a tablet. It is the one
 * that must be left alone: a finger already gets momentum scrolling from the
 * browser, and JS that intercepts pointerdown/pointerup to jump a page fights
 * that momentum instead of riding it. The result is the stutter this exists to
 * remove.
 */
export function isTouchPointer(): boolean {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Hand paging to CSS on touch devices.
 *
 * `scroll-snap-type: y mandatory` is what TikTok's own web build uses, and it
 * is the only way to get the real thing on a phone: the snap runs on the
 * compositor, follows the finger, and carries the platform's own momentum
 * curve. No JS timer can imitate that — the JS pager was computing a target and
 * jumping to it, which is why it felt like a slideshow rather than a scroll.
 *
 * `overscroll-behavior-y: contain` stops a flick at the end of the feed from
 * scrolling the page behind it or triggering pull-to-refresh mid-swipe.
 *
 * Returns a cleanup that restores whatever was there before, so the effect can
 * re-run without stacking.
 */
/**
 * RETIRED by `watchTouchSnap` (Wave 3 lane B, jank audit #1). It ran once, in
 * the commit that set the pager's items, and needed the scroller to overflow
 * already; the list draws its scroller and cells in a later commit, so on a
 * phone it found nothing, returned undefined and never looked again — the feed
 * never snapped (0 of 8 flicks landed on a page). Origin: `git log -S
 * applyTouchSnap` (the touch-pager slice). Kept exported, uncalled, for any
 * surface that applies a snap to a list it knows is already drawn; prefer
 * `watchTouchSnap`.
 */
export function applyTouchSnap(root: HTMLElement, pageH: number): (() => void) | undefined {
  const scroller = findOverflowScroller(root);
  if (!scroller || !(pageH > 0)) return undefined;

  const style = scroller.style as CSSStyleDeclaration & { webkitOverflowScrolling?: string };
  const previous = {
    scrollSnapType: style.scrollSnapType,
    overscrollBehaviorY: style.overscrollBehaviorY,
    webkitOverflowScrolling: style.webkitOverflowScrolling ?? '',
  };

  style.scrollSnapType = 'y mandatory';
  style.overscrollBehaviorY = 'contain';
  style.webkitOverflowScrolling = 'touch';

  // Each page announces where it should come to rest. The cells are whatever
  // the list renderer produced, so they are found by height rather than by a
  // class name the renderer is free to change.
  const cells = pageCells(scroller, pageH);
  for (const cell of cells) cell.style.scrollSnapAlign = 'start';

  return () => {
    style.scrollSnapType = previous.scrollSnapType;
    style.overscrollBehaviorY = previous.overscrollBehaviorY;
    style.webkitOverflowScrolling = previous.webkitOverflowScrolling;
    for (const cell of cells) cell.style.scrollSnapAlign = '';
  };
}

/**
 * The elements that are one page tall.
 *
 * Measured, not matched by selector: the list renderer owns its own DOM and a
 * class name is not a contract. A cell within 2px of the page height is a page.
 *
 * RETIRED with `applyTouchSnap`: measuring every node forced a layout per node
 * (jank audit #9). The pager's page frame now declares `scrollSnapAlign` from
 * its first render (`FeedPager`, testID `feed-pager-page`).
 */
export function pageCells(scroller: HTMLElement, pageH: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of Array.from(scroller.querySelectorAll<HTMLElement>('*'))) {
    const h = child.getBoundingClientRect().height;
    if (Math.abs(h - pageH) <= 2 && child.children.length > 0) out.push(child);
  }
  return out;
}

/**
 * The testID of the frame `FeedPager` wraps every web page in. It carries the
 * page's snap point, and it is how the snap finds the container the pages
 * actually scroll in.
 */
export const PAGE_FRAME_TESTID = 'feed-pager-page';

/**
 * The container the pager's pages scroll in: the nearest y-scrolling ancestor
 * of a page frame. Found from a page upwards because FlashList's web output
 * nests two y-scroll containers — measured on the local export, an outer one
 * that never overflows and the inner one that scrolls the whole feed — and a
 * snap on the outer one does nothing. Null until the first page is drawn.
 *
 * Whether it overflows yet is not asked: a snap on a scroller with nothing to
 * scroll does nothing, and waiting for the overflow is what left the feed
 * unsnapped.
 */
export function findPagerScroller(root: HTMLElement): HTMLElement | null {
  if (typeof getComputedStyle === 'undefined') return null;
  const frame = root.querySelector<HTMLElement>(`[data-testid="${PAGE_FRAME_TESTID}"]`);
  for (let el = frame?.parentElement ?? null; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
    if (el === root) break;
  }
  return null;
}

/**
 * How long a scroll must be still, with no finger down, before it counts as
 * ended. Chrome's own `scrollend` is not enough on its own: on the local
 * export a drag sometimes came to rest without ending (no snap, no
 * `scrollend`) until the next touch.
 */
export const SETTLE_IDLE_MS = 200;

/**
 * The browser's `Element#scrollTo`, never the scroller node's own.
 *
 * react-native-web assigns `ScrollView#scrollTo({ x, y, animated })` onto the
 * ScrollView's DOM node (`node.scrollTo = this.scrollTo`), so `node.scrollTo({
 * top })` reads `y` as 0 and smooth-scrolls to the top of the feed — measured
 * on live: a settle from page 6 landed on page 0. The prototype keeps the
 * browser's smooth scroll, which also respects the CSS snap.
 * src: https://github.com/necolas/react-native-web/blob/0.19.13/packages/react-native-web/src/exports/ScrollView/index.js · react-native-web 0.19.13 · 2026-10-26
 */
function nativeScrollTo(scroller: HTMLElement, top: number): void {
  // The options overload only: `.call` on the overloaded method picks `(x, y)`.
  const browserScrollTo = typeof Element === 'undefined'
    ? undefined
    : Element.prototype.scrollTo as ((this: Element, options: ScrollToOptions) => void) | undefined;
  if (typeof browserScrollTo !== 'function') {
    scroller.scrollTop = top;
    return;
  }
  browserScrollTo.call(scroller, { top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/**
 * Settles `scroller` onto the nearer page boundary whenever a scroll comes to
 * rest off one. Returns the undo.
 */
function settleScroller(scroller: HTMLElement, getPageH: () => number): () => void {
  let fingers = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const settle = () => {
    const pageH = getPageH();
    if (!(pageH > 0) || fingers > 0) return;
    const top = scroller.scrollTop;
    const target = Math.round(top / pageH) * pageH;
    if (Math.abs(top - target) <= 1) return;
    nativeScrollTo(scroller, target);
  };

  const onScroll = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; settle(); }, SETTLE_IDLE_MS);
  };
  // Read from the event's own `touches` (every finger still on the screen), not
  // counted up and down. A touchend fired on a node that was removed mid-touch
  // never bubbles here — cold start swaps the cached For You page for the
  // network's under her finger — and a counter then stayed at 1 for the
  // session, so no scroll was ever settled again. The next touch resyncs.
  const onTouchStart = (event: Event) => {
    fingers = (event as TouchEvent).touches?.length ?? fingers + 1;
  };
  const onTouchEnd = (event: Event) => {
    fingers = (event as TouchEvent).touches?.length ?? Math.max(0, fingers - 1);
    // A drag that is lifted without moving again still has to be looked at.
    onScroll();
  };

  scroller.addEventListener('scrollend', settle);
  scroller.addEventListener('scroll', onScroll, { passive: true });
  scroller.addEventListener('touchstart', onTouchStart, { passive: true });
  scroller.addEventListener('touchend', onTouchEnd, { passive: true });
  scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });

  return () => {
    if (timer !== null) clearTimeout(timer);
    scroller.removeEventListener('scrollend', settle);
    scroller.removeEventListener('scroll', onScroll);
    scroller.removeEventListener('touchstart', onTouchStart);
    scroller.removeEventListener('touchend', onTouchEnd);
    scroller.removeEventListener('touchcancel', onTouchEnd);
  };
}

/** Writes the snap onto one scroller; returns the undo. */
function snapScroller(scroller: HTMLElement): () => void {
  const style = scroller.style as CSSStyleDeclaration & { webkitOverflowScrolling?: string };
  const previous = {
    scrollSnapType: style.scrollSnapType ?? '',
    overscrollBehaviorY: style.overscrollBehaviorY ?? '',
    webkitOverflowScrolling: style.webkitOverflowScrolling ?? '',
  };
  style.scrollSnapType = 'y mandatory';
  style.overscrollBehaviorY = 'contain';
  style.webkitOverflowScrolling = 'touch';
  return () => {
    style.scrollSnapType = previous.scrollSnapType;
    style.overscrollBehaviorY = previous.overscrollBehaviorY;
    style.webkitOverflowScrolling = previous.webkitOverflowScrolling;
  };
}

/**
 * Hand paging to CSS on a touch device, and keep it handed over.
 *
 * `scroll-snap-type: y mandatory` on the container the pages scroll in (see
 * `applyTouchSnap` above for why CSS and not JS); each page declares
 * `scroll-snap-align: start` itself (the pager's page frame). The list
 * renderer draws its scroller and pages in commits after the pager's effect
 * runs, and rebuilds the scroller when the list is rebuilt, so this watches the
 * pager's subtree until the first page is there and follows the scroller when
 * it is replaced. Once applied, a mutation costs one `contains` check — no
 * style or layout reads.
 *
 * Returns the cleanup: stops watching and puts the scroller's style back.
 *
 * With `getPageH`, a scroll that comes to REST between pages is also settled
 * onto the nearer page (`settleScroller`). Measured on the local export: the
 * first drag of a session could stop 322 px into the next page and stay there
 * although the snap was on; later drags snapped. Settling runs after the
 * scroll has ended — `scrollend`, or 150 ms of stillness with no finger down
 * where the browser has no `scrollend` — so it never fights a drag or a fling.
 */
export function watchTouchSnap(root: HTMLElement, getPageH?: () => number): () => void {
  let applied: { scroller: HTMLElement; undo: () => void } | null = null;

  const sync = () => {
    if (applied && root.contains(applied.scroller)) return;
    applied?.undo();
    applied = null;
    const scroller = findPagerScroller(root);
    if (!scroller) return;
    const undoSnap = snapScroller(scroller);
    const undoSettle = getPageH ? settleScroller(scroller, getPageH) : () => undefined;
    applied = { scroller, undo: () => { undoSettle(); undoSnap(); } };
  };

  sync();
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(sync) : null;
  observer?.observe(root, { childList: true, subtree: true });

  return () => {
    observer?.disconnect();
    applied?.undo();
    applied = null;
  };
}
