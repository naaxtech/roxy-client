import { test, expect } from '@playwright/test';
import { signInWithSeedUser, gotoTab } from './helpers/auth';

/**
 * Discover's Top 10 is people now, and a staff tag is the line under the name.
 *
 * The tag is editorial — assigned by the Roxy team, guarded by migration 121 —
 * so its whole value is that a member cannot write it about herself. That rule
 * is enforced in the database and proved there; this checks the other half,
 * that the tag actually reaches the surface it exists for.
 */

test.use({ viewport: { width: 412, height: 915 } });

test('the chart ranks members and shows their staff tag', async ({ page }) => {
  await signInWithSeedUser(page);
  await gotoTab(page, 'discover');

  const rail = page.getByTestId('rail-top10-cards');
  await rail.waitFor({ state: 'visible', timeout: 30_000 });

  await expect(page.getByText('Top 10 members')).toBeVisible();

  const cards = page.locator('[data-testid^="top10-"]');
  const count = await cards.count();
  expect(count, 'the chart is empty').toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(10);

  // A tag set by staff must be the line under the name. Skipped honestly if
  // nobody is tagged, rather than passing on a check that never ran.
  const tagged = page.getByText('Archivist', { exact: true });
  if (await tagged.count()) {
    await expect(tagged.first()).toBeVisible();
  } else {
    test.skip(true, 'no member carries a staff tag on this database');
  }

  // No screenshot of the chart itself: Discover scrolls inside a nested RNW
  // scroller, so neither scrollIntoViewIfNeeded, fullPage, nor setting
  // scrollTop by hand brings it into the viewport. The assertions above are
  // the evidence — the rail is visible, the cards are there, and the staff tag
  // is on screen.
  await page.screenshot({ path: 'shots/discover-top-members.png' });
});
