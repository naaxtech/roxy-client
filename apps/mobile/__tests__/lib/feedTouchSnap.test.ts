/**
 * @jest-environment jsdom
 */
import { watchTouchSnap } from '../../lib/feedPagerWeb';

/**
 * The feed never snapped on a phone (jank audit #1): the snap was set up once,
 * in the commit that set `items`, and the list renderer adds its scroller and
 * cells in a LATER commit. At effect time there was nothing that overflowed, the
 * snap was skipped, and nothing ever looked again — every swipe parked a post
 * half on screen (0 of 8 flicks landed on a page, median 222 px off).
 *
 * The watcher keeps looking until the scroller is there, applies the snap to it
 * whether or not it overflows yet, and follows the list when it rebuilds.
 */

function scroller(): HTMLElement {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  return el;
}

/** MutationObserver callbacks are microtasks. */
const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

describe('watchTouchSnap', () => {
  it('snaps a scroller that the list renders after the pager mounted', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stop = watchTouchSnap(root);

    const list = scroller();
    root.appendChild(list);
    await flush();

    expect(list.style.scrollSnapType).toBe('y mandatory');
    expect(list.style.overscrollBehaviorY).toBe('contain');
    stop();
  });

  it('snaps the scroller before it has any content to overflow', () => {
    const root = document.createElement('div');
    const list = scroller();
    root.appendChild(list);

    const stop = watchTouchSnap(root);

    expect(list.style.scrollSnapType).toBe('y mandatory');
    stop();
  });

  it('follows the list when it rebuilds its scroller', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const first = scroller();
    root.appendChild(first);
    const stop = watchTouchSnap(root);

    root.removeChild(first);
    const second = scroller();
    root.appendChild(second);
    await flush();

    expect(second.style.scrollSnapType).toBe('y mandatory');
    stop();
  });

  it('ignores a sideways scroller inside a cell', () => {
    const root = document.createElement('div');
    const carousel = document.createElement('div');
    carousel.style.overflowX = 'auto';
    carousel.style.overflowY = 'hidden';
    root.appendChild(carousel);

    const stop = watchTouchSnap(root);

    expect(carousel.style.scrollSnapType).toBe('');
    stop();
  });

  it('puts the scroller back and stops watching on cleanup', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const list = scroller();
    root.appendChild(list);
    const stop = watchTouchSnap(root);

    stop();
    expect(list.style.scrollSnapType).toBe('');
    expect(list.style.overscrollBehaviorY).toBe('');

    const late = scroller();
    root.removeChild(list);
    root.appendChild(late);
    await flush();
    expect(late.style.scrollSnapType).toBe('');
  });
});
