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

/**
 * Wait for a rail to finish loading, by its own state, not by the clock.
 *
 * These used to sleep 2.5s and then look. On the production project each rail
 * is several round trips, and on 2026-10-04 Discover took ~5.6s to settle
 * (Supabase free tier, Seoul region) — so the sleep read a spinner and failed
 * against roxy.expo.app and a local build alike. Rail.tsx gives every state its
 * own testID (`-loading`, `-cards`, `-empty`, `-error`); waiting for the one
 * that means "loaded" is the contract, and an error state still fails loudly.
 */
async function waitForRailCards(page: import('@playwright/test').Page, rail: string) {
  await expect(page.getByTestId(`${rail}-loading`)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId(`${rail}-error`), `${rail} errored`).toHaveCount(0);
  await expect(page.getByTestId(`${rail}-cards`), `${rail} has no cards`).toBeVisible();
}

test('one category fills the screen instead of scrolling sideways', async ({ page }) => {
  await signInWithSeedUser(page);
  await gotoTab(page, 'discover');

  await page.getByTestId('discover-chips-comms').click();
  await waitForRailCards(page, 'rail-communities');

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
  await waitForRailCards(page, 'rail-top10');

  // The mixed view keeps its rails — nine categories cannot each own a screen.
  const rail = await cardsBox(page, 'rail-top10-cards');
  expect(rail).not.toBeNull();
  expect(rail!.rows).toBe(1);
});
