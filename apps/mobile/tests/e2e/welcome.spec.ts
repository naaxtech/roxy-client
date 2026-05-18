import { test, expect } from '@playwright/test';

test.describe('Welcome screen', () => {
  test('loads without a blank page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Roxy')).toBeVisible();
    await expect(page.getByText('Your community. Your story.')).toBeVisible();

    expect(errors.filter((m) => !m.includes('ResizeObserver'))).toEqual([]);
  });

  test('email sign-in form can be opened', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('use-email-link').click();
    await expect(page.getByTestId('email-input')).toBeVisible();
    await expect(page.getByTestId('password-input')).toBeVisible();
  });
});
