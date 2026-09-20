import { test } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * Shoots the profile and its Thoughts tab so the two can be held next to
 * `docs/handoff/roxy-3.0/Roxy App.dc.html`. A tool, not a gate — the audit
 * spec is where assertions live.
 */

test.use({ viewport: { width: 412, height: 915 } });

test('shoot the profile and its Thoughts tab', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto('/you');
  await page.getByTestId('profile-tabstrip').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/profile-you.png', fullPage: true });

  await page.getByTestId('profile-tab-thoughts').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/profile-thoughts.png', fullPage: true });
});
