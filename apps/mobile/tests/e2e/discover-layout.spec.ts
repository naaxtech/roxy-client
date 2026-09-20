import { test, expect } from '@playwright/test';
import { signInWithSeedUser, gotoTab } from './helpers/auth';

/**
 * Picking one category on Discover must stop the sideways swipe.
 *
 * A rail is a sampler: right for `All`, wrong once she has said "show me
 * communities" and the screen has nothing else on it. This asserts the painted
 * result — that the cards wrap down the page rather than running off the side.
 */

test.use({ viewport: { width: 412, height: 915 } });

async function cardsBox(page: import('@playwright/test').Page, testid: string) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const kids = Array.from(el.children).map((c) => {
      const b = (c as HTMLElement).getBoundingClientRect();
      return { top: Math.round(b.top), left: Math.round(b.left) };
    });
    return {
      width: Math.round(r.width),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      rows: new Set(kids.map((k) => k.top)).size,
      kids: kids.length,
    };
  }, testid);
}

test('one category fills the screen instead of scrolling sideways', async ({ page }) => {
  await signInWithSeedUser(page);
  await gotoTab(page, 'discover');
  await page.waitForTimeout(2500);

  await page.getByTestId('discover-chips-comms').click();
  await page.waitForTimeout(2000);

  const grid = await cardsBox(page, 'rail-communities-cards');
  expect(grid, 'the communities rail did not render').not.toBeNull();

  // The whole point: nothing is parked off the right edge.
  expect(grid!.scrollWidth).toBeLessThanOrEqual(grid!.clientWidth + 1);

  // And with more than one card, they stack into rows rather than one strip.
  if (grid!.kids > 1) expect(grid!.rows).toBeGreaterThan(1);

  await page.screenshot({ path: 'shots/discover-one-category.png', fullPage: true });
});

test('All still samples sideways', async ({ page }) => {
  await signInWithSeedUser(page);
  await gotoTab(page, 'discover');
  await page.waitForTimeout(2500);

  // The mixed view keeps its rails — nine categories cannot each own a screen.
  const rail = await cardsBox(page, 'rail-top10-cards');
  expect(rail).not.toBeNull();
  expect(rail!.rows).toBe(1);
});
