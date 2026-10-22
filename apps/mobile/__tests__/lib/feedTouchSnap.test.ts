/**
 * @jest-environment jsdom
 */
import { PAGE_FRAME_TESTID, watchTouchSnap } from '../../lib/feedPagerWeb';

/**
 * The feed never snapped on a phone (jank audit #1): the snap was set up once,
 * in the commit that set `items`, and the list renderer adds its scroller and
 * cells in a LATER commit. At effect time there was nothing that overflowed, the
 * snap was skipped, and nothing ever looked again — every swipe parked a post
 * half on screen (0 of 8 flicks landed on a page, median 222 px off).
 *
 * On the web export FlashList also nests TWO y-scroll containers (measured on
 * the local export: an outer one that never overflows, and the inner one that
 * actually scrolls 33,024 px). The snap belongs on the container the pages
 * scroll in, so the watcher finds it from a page frame upwards, waits until the
 * first page exists, and follows the list when it rebuilds.
 */

function yScroller(): HTMLElement {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  return el;
}

function pageFrame(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-testid', PAGE_FRAME_TESTID);
  return el;
}

/** The DOM FlashList draws on web: root > outer scroller > inner scroller > pages. */
function pagerDom(withPage = true) {
  const root = document.createElement('div');
  const outer = yScroller();
  const inner = yScroller();
  root.appendChild(outer);
  outer.appendChild(inner);
  if (withPage) inner.appendChild(pageFrame());
  document.body.appendChild(root);
  return { root, outer, inner };
}

/** MutationObserver callbacks are microtasks. */
const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

describe('watchTouchSnap', () => {
  it('snaps the container the pages scroll in, not an outer wrapper that never scrolls', () => {
    const { root, outer, inner } = pagerDom();

    const stop = watchTouchSnap(root);

    expect(inner.style.scrollSnapType).toBe('y mandatory');
    expect(inner.style.overscrollBehaviorY).toBe('contain');
    expect(outer.style.scrollSnapType).toBe('');
    stop();
  });

  it('waits for the list to draw its first page, then snaps', async () => {
    const { root, inner } = pagerDom(false);
    const stop = watchTouchSnap(root);
    expect(inner.style.scrollSnapType).toBe('');

    inner.appendChild(pageFrame());
    await flush();

    expect(inner.style.scrollSnapType).toBe('y mandatory');
    stop();
  });

  it('follows the list when it rebuilds its scroller', async () => {
    const { root, outer, inner } = pagerDom();
    const stop = watchTouchSnap(root);

    outer.removeChild(inner);
    const rebuilt = yScroller();
    rebuilt.appendChild(pageFrame());
    outer.appendChild(rebuilt);
    await flush();

    expect(rebuilt.style.scrollSnapType).toBe('y mandatory');
    stop();
  });

  it('never snaps a sideways scroller inside a page', () => {
    const { root, inner } = pagerDom(false);
    const page = pageFrame();
    const carousel = document.createElement('div');
    carousel.style.overflowX = 'auto';
    carousel.style.overflowY = 'hidden';
    page.appendChild(carousel);
    inner.appendChild(page);

    const stop = watchTouchSnap(root);

    expect(carousel.style.scrollSnapType).toBe('');
    expect(inner.style.scrollSnapType).toBe('y mandatory');
    stop();
  });

  it('puts the scroller back and stops watching on cleanup', async () => {
    const { root, outer, inner } = pagerDom();
    const stop = watchTouchSnap(root);

    stop();
    expect(inner.style.scrollSnapType).toBe('');
    expect(inner.style.overscrollBehaviorY).toBe('');

    outer.removeChild(inner);
    const late = yScroller();
    late.appendChild(pageFrame());
    outer.appendChild(late);
    await flush();
    expect(late.style.scrollSnapType).toBe('');
  });
});

/**
 * Measured on the local export (390x844, the first flick ~2.5 s after the feed
 * drew): the scroller was snapped, yet the first drag of the session came to
 * rest 322 px into the next page and stayed there; later drags snapped. A
 * post parked half on screen is the exact defect, so when a scroll ends off a
 * page the pager settles it onto the nearer one — after the scroll, never
 * during it, so it cannot fight the finger or the platform's fling.
 */
describe('watchTouchSnap settles a scroll that ended between pages', () => {
  const PAGE = 768;

  function settledDom(top: number) {
    const { root, inner } = pagerDom();
    Object.defineProperty(inner, 'scrollTop', { value: top, configurable: true, writable: true });
    const scrollTo = jest.fn();
    (inner as unknown as { scrollTo: jest.Mock }).scrollTo = scrollTo;
    return { root, inner, scrollTo };
  }

  afterEach(() => { jest.useRealTimers(); });

  it('moves a scroll that stopped 322 px in back onto the nearer page', () => {
    const { root, inner, scrollTo } = settledDom(322);
    const stop = watchTouchSnap(root, () => PAGE);

    inner.dispatchEvent(new Event('scrollend'));

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    stop();
  });

  it('carries a scroll that stopped past half a page on to the next page', () => {
    const { root, inner, scrollTo } = settledDom(500);
    const stop = watchTouchSnap(root, () => PAGE);

    inner.dispatchEvent(new Event('scrollend'));

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: PAGE }));
    stop();
  });

  it('leaves a scroll that ended on a page alone', () => {
    const { root, inner, scrollTo } = settledDom(PAGE * 2);
    const stop = watchTouchSnap(root, () => PAGE);

    inner.dispatchEvent(new Event('scrollend'));

    expect(scrollTo).not.toHaveBeenCalled();
    stop();
  });

  it('settles once the scroll has been still, never under a finger', () => {
    jest.useFakeTimers();
    const { root, inner, scrollTo } = settledDom(322);
    const stop = watchTouchSnap(root, () => PAGE);

    inner.dispatchEvent(new Event('touchstart'));
    inner.dispatchEvent(new Event('scroll'));
    jest.advanceTimersByTime(1000);
    expect(scrollTo).not.toHaveBeenCalled();

    inner.dispatchEvent(new Event('scroll'));
    jest.advanceTimersByTime(1000);
    expect(scrollTo).not.toHaveBeenCalled();

    // Lifted, and no scroll event follows: the browser never ended the scroll.
    inner.dispatchEvent(new Event('touchend'));
    jest.advanceTimersByTime(1000);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    stop();
  });

  it('waits while a fling is still scrolling', () => {
    jest.useFakeTimers();
    const { root, inner, scrollTo } = settledDom(322);
    const stop = watchTouchSnap(root, () => PAGE);

    for (let i = 0; i < 10; i++) {
      inner.dispatchEvent(new Event('scroll'));
      jest.advanceTimersByTime(16);
    }
    expect(scrollTo).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops settling after cleanup', () => {
    const { root, inner, scrollTo } = settledDom(322);
    const stop = watchTouchSnap(root, () => PAGE);
    stop();

    inner.dispatchEvent(new Event('scrollend'));

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
