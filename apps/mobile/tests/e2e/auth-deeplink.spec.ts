import { test, expect, type Page } from '@playwright/test';
import { submitSeedSignInFromCodeGate } from './helpers/auth';

/**
 * Bug A (b2e54f94, found 2026-10-28): opening any URL other than `/` while
 * signed out — /feed, /notifications, /archive, /user/<id> — showed a blank
 * page forever. ~1.4 s in, expo-router threw "Attempted to navigate before
 * mounting the Root Layout component": the auth redirect fired while the root
 * layout was still holding its navigator back for the fonts. `/` escaped only
 * because its segments stay empty until the index redirect.
 *
 * Every test here starts in a fresh browser context (no session) and is
 * read-only: the only write is the seeded user's own sign-in.
 *
 * Run (from apps/mobile), against a local export or live:
 *   PLAYWRIGHT_BASE_URL=http://localhost:8083 npx playwright test tests/e2e/auth-deeplink.spec.ts
 */

const MOUNT_ERROR = 'Attempted to navigate before mounting the Root Layout component';

/** The deep links the bug was reproduced on (390 and 1280). */
const DEEP_LINKS = ['/notifications', '/feed', '/archive', '/user/183d2c16-5eac-4739-8b7e-707834917663'];

const VIEWPORTS = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
];

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes(MOUNT_ERROR)) errors.push(m.text());
  });
  return errors;
}

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`signed-out deep link (${name})`, () => {
    test.use({ viewport });

    for (const path of DEEP_LINKS) {
      test(`${path} reaches the code gate, not a blank page`, async ({ page }) => {
        const errors = collectPageErrors(page);

        await page.goto(path);
        await expect(page.getByTestId('code-gate-screen')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText('Enter your Roxy code')).toBeVisible();
        await expect(page).toHaveURL(/\/code$/);

        // A page that rendered something and then crashed to blank would pass
        // the visibility check only if we looked too early: hold, look again.
        await page.waitForTimeout(3_000);
        await expect(page.getByTestId('code-gate-screen')).toBeVisible();
        const text = await page.evaluate(() => document.body.innerText.trim().length);
        expect(text).toBeGreaterThan(0);

        expect(errors.filter((m) => m.includes(MOUNT_ERROR))).toEqual([]);
        expect(errors.filter((m) => !m.includes('ResizeObserver'))).toEqual([]);
      });
    }

    test('a reload of the deep link does the same', async ({ page }) => {
      const errors = collectPageErrors(page);
      await page.goto('/notifications');
      await expect(page.getByTestId('code-gate-screen')).toBeVisible({ timeout: 60_000 });

      await page.goto('/archive');
      await expect(page.getByTestId('code-gate-screen')).toBeVisible({ timeout: 60_000 });
      expect(errors.filter((m) => m.includes(MOUNT_ERROR))).toEqual([]);
    });
  });
}

test.describe('signed-out deep link, then sign in', () => {
  test('she lands on the page she asked for', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('/notifications');
    await submitSeedSignInFromCodeGate(page);

    await expect(page).toHaveURL(/\/notifications$/, { timeout: 30_000 });
    await expect(page.getByTestId('code-gate-screen')).toBeHidden();
    await expect(page.getByTestId('welcome-screen')).toBeHidden();
    expect(errors.filter((m) => m.includes(MOUNT_ERROR))).toEqual([]);
  });
});
