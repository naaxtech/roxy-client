import { test as setup, expect } from '@playwright/test';

const SESSION_FILE = 'tests/e2e/.auth/session.json';

setup('authenticate', async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set.\n' +
      'Add them to apps/studio/.env.test or export them before running.'
    );
  }

  await page.goto('/auth/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  // Wait for redirect to dashboard after successful login
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await expect(page).toHaveURL(/dashboard/);

  // Save auth state (cookies + localStorage) for reuse
  await page.context().storageState({ path: SESSION_FILE });
});
