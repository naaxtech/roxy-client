import { test, expect } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * Navigation smoke for the 5-tab IA (2026-07-19 full click audit).
 * Locks in the regressions fixed that day:
 *  - community view is a ROOT route: opening it never switches tabs and
 *    back returns to the origin tab (was: hijacked into Play)
 *  - room session is a ROOT route: leaving it never leaves a stale call
 *    screen on the Connect tab stack
 *  - room join on web degrades to the friendly native-only screen
 *    (was: "Connection error" alert from the empty web stub)
 */
test.describe('Navigation smoke', () => {
  test('all five tabs route to their URLs', async ({ page }) => {
    await signInWithSeedUser(page);

    await page.getByRole('link', { name: /Connect/i }).click();
    await expect(page).toHaveURL(/\/connect$/);

    await page.getByRole('link', { name: /Play/i }).click();
    await expect(page).toHaveURL(/\/discover$/);

    await page.getByRole('link', { name: /Messages/i }).click();
    await expect(page).toHaveURL(/\/messages$/);

    await page.getByRole('link', { name: /Build/i }).click();
    await expect(page).toHaveURL(/\/build$/);

    await page.getByRole('link', { name: /Grow/i }).click();
    await expect(page).toHaveURL(/\/grow$/);
  });

  test('community view opens at root route and back returns to Connect', async ({ page }) => {
    await signInWithSeedUser(page);

    await page.getByRole('link', { name: /Connect/i }).click();
    await page.getByTestId('connect-tab-communities').click();

    // Open the first community row (each carries a Join/Leave button label).
    const firstCommunity = page
      .getByLabel(/^(Join|Leave) /)
      .first();
    await expect(firstCommunity).toBeVisible({ timeout: 30_000 });
    // Click the row's parent card (the row navigates; the button toggles join).
    await firstCommunity.locator('..').click();

    // Root route, not the Play-stack route.
    await expect(page).toHaveURL(/\/community\/[0-9a-f-]+$/, { timeout: 15_000 });

    // Back returns to Connect — not Play.
    await page.goBack();
    await expect(page).toHaveURL(/\/connect$/);
  });

  test('web room join shows the native-only screen, and Connect tab is not polluted', async ({ page }) => {
    await signInWithSeedUser(page);

    // Join a live room from Connect › Rooms (if any is live).
    await page.getByRole('link', { name: /Connect/i }).click();
    await page.getByTestId('connect-tab-rooms').click();

    const room = page.getByLabel(/^Join room /).first();
    const hasRoom = await room
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasRoom, 'no live rooms seeded');

    await room.click();
    await expect(page).toHaveURL(/\/community-room-session\?/);

    // Web degrades gracefully — no dialog, a friendly screen with a back action.
    await expect(page.getByText('Video rooms work in the Roxy app', { exact: false }))
      .toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Go back').click();

    // The Connect tab must land on Connect home, not a stale call screen.
    await page.getByRole('link', { name: /Connect/i }).click();
    await expect(page).toHaveURL(/\/connect$/);
  });
});
