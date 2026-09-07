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
export function applyWebPageOffset(root: HTMLElement, offset: number): void {
  const scroller = findOverflowScroller(root);
  if (!scroller || !Number.isFinite(offset)) return;
  scroller.scrollTop = offset;
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
