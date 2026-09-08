import { test, expect } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * The ship gate's demo asset, captured rather than asserted.
 *
 * Walks the four things this slice changed, at phone size, with video on. The
 * output is a real .webm under `shots/demo/` — the gate's line is "demo asset
 * captured", and a claim that one exists is not one.
 *
 * Run against production with:
 *   PLAYWRIGHT_BASE_URL=https://roxy.expo.app npx playwright test tests/e2e/demo-capture.spec.ts
 */

test.use({
  viewport: { width: 412, height: 915 },
  video: { mode: 'on', size: { width: 412, height: 915 } },
});

test('demo — thoughts, replies, reactions, rating', async ({ page }) => {
  await signInWithSeedUser(page);

  // 1. Thoughts: text posts read in full, not cropped into a photo grid.
  await page.goto('/you');
  await page.getByTestId('profile-tab-thoughts').click();
  await page.waitForTimeout(1800);

  // 2. Replies open in place — she never leaves her profile.
  const reply = page.locator('[data-testid$="-reply"]').first();
  if (await reply.count()) {
    await reply.click();
    await page.waitForTimeout(1500);
    const composer = page.getByPlaceholder('Write a reply…');
    if (await composer.count()) {
      await composer.fill('this is the whole point — no new screen');
      await page.waitForTimeout(1200);
    }
    await expect(page).toHaveURL(/\/you$/);
    await reply.click();
    await page.waitForTimeout(800);
  }

  // 3. Emoji reactions.
  const add = page.locator('[data-testid$="-reactions-add"]').first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(900);
    const pick = page.locator('[data-testid$="-reactions-pick-❤️"]').first();
    if (await pick.count()) await pick.click();
    await page.waitForTimeout(1200);
  }

  // 4. The Archive's 0–5 rating.
  await page.goto('/archive');
  const firstRow = page.locator('[data-testid^="archive-row-"]').first();
  await firstRow.waitFor({ state: 'visible', timeout: 30_000 });
  await firstRow.click();
  await page.waitForTimeout(2000);

  // 5. Discover: one category fills the screen.
  await page.goto('/discover');
  await page.waitForTimeout(2000);
  const comms = page.getByTestId('discover-chips-comms');
  if (await comms.count()) {
    await comms.click();
    await page.waitForTimeout(2200);
  }
});
