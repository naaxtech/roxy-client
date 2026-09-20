import { test } from '@playwright/test';
import { signInWithSeedUser, gotoTab, TAB_SLOTS } from './helpers/auth';

/**
 * Shoot every main surface at the design's own viewport, so the live build can
 * be held next to `docs/handoff/roxy-3.0/Roxy App.dc.html` and compared.
 *
 * A tool, not a gate. It asserts nothing — it produces the evidence a person
 * (or I) look at. The audit spec is where assertions live.
 */

test.use({ viewport: { width: 412, height: 915 } });

test('shoot every tab', async ({ page }) => {
  await signInWithSeedUser(page);

  for (const slot of TAB_SLOTS) {
    await gotoTab(page, slot);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `shots/tab-${slot}.png` });
  }
});

test('shoot the archive surfaces', async ({ page }) => {
  await signInWithSeedUser(page);

  await page.goto('/archive');
  // Wait for CONTENT, not a stopwatch. A fixed 2.5s caught the spinner on a
  // cold bundle and produced an empty screenshot that looked like a bug.
  await page.locator('[data-testid^="archive-row-"]').first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/archive-browse.png' });

  // An entry page, which is where the design is richest.
  const firstRow = page.locator('[data-testid^="archive-row-"]').first();
  if (await firstRow.count()) {
    await firstRow.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'shots/archive-entry.png' });
  }
});
