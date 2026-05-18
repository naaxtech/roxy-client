import { expect, type Page } from '@playwright/test';

export const E2E_EMAIL = process.env.E2E_EMAIL ?? 'e2e-playwright@seed.roxy.app';
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-playwright-pass-123';

export async function signInWithSeedUser(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('use-email-link').click();
  await page.getByText('Already have an account? Sign In').click();
  await page.getByTestId('email-input').fill(E2E_EMAIL);
  await page.getByTestId('password-input').fill(E2E_PASSWORD);
  await page.getByTestId('auth-submit-btn').click();

  await expect(page.getByRole('link', { name: /Discover/i })).toBeVisible({ timeout: 30_000 });
}
