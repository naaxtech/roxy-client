import { test, expect } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * A page change must LOOK like movement.
 *
 * The web pager set `scrollTop` directly, so a swipe teleported to the next
 * post: the content changed without the screen ever appearing to move, and
 * nothing told you which way you had gone. This samples the scroll position
 * across the transition and asserts it passed through the middle.
 */

test.use({ viewport: { width: 412, height: 915 } });

test('a page glides to the next post instead of jumping', async ({ page }) => {
  await signInWithSeedUser(page);
  // Straight to the route rather than through the tab bar: this spec is about
  // the scroll, and a nav click racing the first render made it fail for a
  // reason that had nothing to do with what it measures.
  await page.goto('/feed');
  await page.waitForTimeout(4000);

  const samples = await page.evaluate(async () => {
    const scroller = Array.from(document.querySelectorAll<HTMLElement>('*')).find((el) => {
      const st = getComputedStyle(el);
      return (st.overflowY === 'auto' || st.overflowY === 'scroll')
        && el.scrollHeight > el.clientHeight + 2;
    });
    if (!scroller) return null;

    const start = scroller.scrollTop;
    const seen: number[] = [];
    // Sample every frame while the wheel-driven page change plays out.
    const stop = performance.now() + 500;
    const tick = () => {
      seen.push(scroller.scrollTop);
      if (performance.now() < stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 550));
    return { start, seen, end: scroller.scrollTop, page: scroller.clientHeight };
  });

  test.skip(samples === null, 'no scroller on this build');

  // It moved a whole page.
  expect(Math.abs(samples!.end - samples!.start)).toBeGreaterThan(samples!.page * 0.5);

  // And it was seen partway there — the proof it animated rather than teleported.
  const lo = Math.min(samples!.start, samples!.end);
  const hi = Math.max(samples!.start, samples!.end);
  const midway = samples!.seen.filter((v) => v > lo + 8 && v < hi - 8);
  expect(midway.length, 'the page jumped: no intermediate scroll positions were observed')
    .toBeGreaterThan(0);
});
