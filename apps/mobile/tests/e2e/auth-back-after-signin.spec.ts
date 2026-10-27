import { test, expect, type Page } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * Bug B (848c7c75, found 2026-10-28): /code → /welcome (pushed) → sign in →
 * /feed (replaces welcome) → browser Back → /code, where a signed-in, approved
 * member saw the applicant screen — "One more step: your code / Enter an
 * invite code to start your application" — and a reload kept her there. The
 * routing skipped /code for every signed-in account; the skip was meant only
 * for an account with no profile and no held code (G-15). Continue on that
 * screen would have called redeem_invite_code, which resets anything but an
 * approved row to 'pending'.
 *
 * Read-only: the seeded user signs in and navigates; nothing is posted, and
 * Continue is never pressed.
 *
 * Run (from apps/mobile), against a local export or live:
 *   PLAYWRIGHT_BASE_URL=http://localhost:8083 npx playwright test tests/e2e/auth-back-after-signin.spec.ts
 */

const APPLICANT_TITLE = 'One more step: your code';
const APPLICANT_BODY = 'Enter an invite code to start your application.';

async function expectNotOnApplicantCodeScreen(page: Page) {
  // The layout may show /code for the length of one profile read before it
  // routes her home, so wait for the URL to leave it, then hold and re-check.
  await expect(page).not.toHaveURL(/\/code$/, { timeout: 20_000 });
  await page.waitForTimeout(3_000);
  await expect(page).not.toHaveURL(/\/code$/);
  await expect(page.getByText(APPLICANT_TITLE)).toBeHidden();
  await expect(page.getByText(APPLICANT_BODY)).toBeHidden();
}

test.describe('Back right after signing in', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('does not leave a member on the applicant code screen', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await signInWithSeedUser(page);
    await expect(page).toHaveURL(/\/feed$/);

    await page.goBack();
    await expectNotOnApplicantCodeScreen(page);
    await expect(page.getByTestId('nav-bar')).toBeVisible({ timeout: 15_000 });

    expect(errors.filter((m) => !m.includes('ResizeObserver'))).toEqual([]);
  });

  test('opening /code while signed in (the reload case) routes her home', async ({ page }) => {
    await signInWithSeedUser(page);

    await page.goto('/code');
    await expectNotOnApplicantCodeScreen(page);
    await expect(page.getByTestId('nav-bar')).toBeVisible({ timeout: 15_000 });
  });
});
