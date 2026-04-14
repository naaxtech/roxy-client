import { test, expect } from '@playwright/test';

// All tests in this file use the saved authenticated session from auth.setup.ts

test.describe('dashboard', () => {
  test('renders after login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/dashboard/);
    // Sidebar should be present
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('shows community count stat', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText(/communities/i)).toBeVisible();
  });

  test('shows events count stat', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText(/events/i)).toBeVisible();
  });

  test('sidebar nav links are present', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /dashboard/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /community/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /events/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
  });
});

test.describe('community page', () => {
  test('renders without error', async ({ page }) => {
    await page.goto('/community');
    await expect(page).toHaveURL(/community/);
    await expect(page.getByRole('navigation')).toBeVisible();
  });
});

test.describe('events page', () => {
  test('renders without error', async ({ page }) => {
    await page.goto('/events');
    await expect(page).toHaveURL(/events/);
    await expect(page.getByRole('navigation')).toBeVisible();
  });
});

test.describe('settings page', () => {
  test('renders account info', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/settings/);
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('shows Stripe connection status', async ({ page }) => {
    await page.goto('/settings');
    // Stripe status banner should appear — connected, incomplete, or not started
    await expect(
      page.getByText(/stripe|connected|connect your account/i)
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('navigation', () => {
  test('sidebar links navigate correctly', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /community/i }).click();
    await expect(page).toHaveURL(/community/);

    await page.getByRole('link', { name: /events/i }).click();
    await expect(page).toHaveURL(/events/);

    await page.getByRole('link', { name: /settings/i }).click();
    await expect(page).toHaveURL(/settings/);

    await page.getByRole('link', { name: /dashboard/i }).click();
    await expect(page).toHaveURL(/dashboard/);
  });
});
