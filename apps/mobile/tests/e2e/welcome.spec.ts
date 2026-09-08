import { test, expect } from '@playwright/test';

/**
 * The front door is the invite-code gate, not the welcome screen. A member with
 * an account reaches the email form through `already-have-account`; a woman
 * without a code reaches nothing, which is the point of the gate.
 */
test.describe('Entry', () => {
  test('the code gate loads without a blank page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.getByTestId('code-gate-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('code-input')).toBeVisible();
    await expect(page.getByText('Enter your Roxy code')).toBeVisible();

    expect(errors.filter((m) => !m.includes('ResizeObserver'))).toEqual([]);
  });

  test('an existing account reaches the email sign-in form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('code-gate-screen')).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('already-have-account').click();
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('use-email-link').click();
    await expect(page.getByTestId('email-input')).toBeVisible();
    await expect(page.getByTestId('password-input')).toBeVisible();
  });
});
