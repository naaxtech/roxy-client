import { test, expect } from '@playwright/test';

test.describe('unauthenticated access', () => {
  test('root redirects to login when not signed in', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/auth\/login/);
  });

  test('protected dashboard redirects to login when not signed in', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/auth\/login/);
  });

  test('protected community page redirects to login when not signed in', async ({ page }) => {
    await page.goto('/community');
    await expect(page).toHaveURL(/auth\/login/);
  });

  test('protected events page redirects to login when not signed in', async ({ page }) => {
    await page.goto('/events');
    await expect(page).toHaveURL(/auth\/login/);
  });

  test('protected settings page redirects to login when not signed in', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/auth\/login/);
  });

  test('login page renders email and password fields', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in|log in/i })).toBeVisible();
  });

  test('login shows error on invalid credentials', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel(/email/i).fill('notareal@user.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // Should stay on login and show an error — not redirect
    await expect(page).toHaveURL(/auth\/login/);
    await expect(page.getByRole('alert').or(page.locator('[class*="error"],[class*="Error"]'))).toBeVisible({ timeout: 8_000 });
  });

  test('sign-up page renders required fields', async ({ page }) => {
    await page.goto('/auth/sign-up');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    // Password fields (could be two — password + confirm)
    await expect(page.getByRole('button', { name: /sign up|create account/i })).toBeVisible();
  });

  test('forgot password page renders', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /reset|send/i })).toBeVisible();
  });
});
