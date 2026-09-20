import { test, expect, devices } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * On a phone the browser must own the scroll.
 *
 * The JS pager intercepted pointerdown/pointerup and jumped a page. On a mouse
 * that is right — overflow:auto has no mouse-drag scrolling. On a finger it is
 * wrong: the browser is already producing momentum, and jumping mid-gesture
 * fights it. That is the stutter this was reported for.
 *
 * CSS scroll-snap is what TikTok's own web build uses. It runs on the
 * compositor and carries the platform's momentum curve, which no JS timer can
 * imitate.
 */

test.use({ ...devices['Pixel 7'] });

test('a touch device gets CSS scroll-snap, not JS paging', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto('/feed');
  await page.waitForTimeout(4000);

  const snap = await page.evaluate(() => {
    const scroller = Array.from(document.querySelectorAll<HTMLElement>('*')).find((el) => {
      const st = getComputedStyle(el);
      return (st.overflowY === 'auto' || st.overflowY === 'scroll')
        && el.scrollHeight > el.clientHeight + 2;
    });
    if (!scroller) return null;
    const cs = getComputedStyle(scroller);
    const aligned = Array.from(scroller.querySelectorAll<HTMLElement>('*'))
      .filter((el) => getComputedStyle(el).scrollSnapAlign === 'start').length;
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      snapType: cs.scrollSnapType,
      overscroll: cs.overscrollBehaviorY,
      alignedCells: aligned,
    };
  });

  test.skip(snap === null, 'no scroller on this build');
  expect(snap!.coarse, 'the emulated device is not reporting a coarse pointer').toBe(true);

  // The snap has to be mandatory: `proximity` leaves a post parked half on
  // screen, which is the thing that reads as broken.
  expect(snap!.snapType).toContain('mandatory');
  expect(snap!.snapType).toContain('y');
  // And each page must declare where it comes to rest, or the container snaps
  // to nothing.
  expect(snap!.alignedCells, 'no cell carries scroll-snap-align').toBeGreaterThan(0);
  // A flick at the end must not scroll the page behind the feed.
  expect(snap!.overscroll).toBe('contain');
});
