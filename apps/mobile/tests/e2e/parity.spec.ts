import { test, expect } from '@playwright/test';
import { signInWithSeedUser, gotoTab } from './helpers/auth';

/**
 * The doors that the five-tab flattening closed.
 *
 * Every capability here survived the redesign as working code and lost its only
 * entry point when `grow/`, `connect/` and `build/` were deleted. Nothing
 * failed: not tsc, not eslint, not 1135 unit tests — a route needs no importer
 * to exist, and a component nothing renders still compiles. They were found by
 * sweeping for zero references, and this file is what keeps them found.
 *
 * Each test asserts the LINK, not the destination screen. The screens have their
 * own coverage; what broke, and what will break again, is the way in.
 */
test.describe('Restored entry points', () => {
  test('You reaches My people and Badges — their only links in the app', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'you');

    await expect(page.getByTestId('you-people')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('you-people').click();
    await expect(page).toHaveURL(/\/people$/, { timeout: 15_000 });

    await page.goBack();
    await gotoTab(page, 'you');
    await page.getByTestId('you-badges').click();
    await expect(page).toHaveURL(/\/badges$/, { timeout: 15_000 });
  });

  test('Saved opens in place instead of throwing her into the video feed', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'you');

    await expect(page.getByTestId('you-saved')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('you-saved').click();

    // The row used to push `/(tabs)/feed`. Her saved posts are on this screen.
    await expect(page).toHaveURL(/\/you$/);
  });

  test('the communities rail offers a way past its twelve cards', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'discover');

    await page.getByTestId('discover-chips-comms').click();
    await page.getByTestId('rail-communities-link').click();
    await expect(page).toHaveURL(/\/communities$/, { timeout: 15_000 });
  });

  test('the community filter appears on the Feed Communities segment and nowhere else', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'feed');

    const switcher = page.getByTestId('community-switcher-btn');
    await expect(switcher).toHaveCount(0);

    await page.getByTestId('feed-segment-communities').click();
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('feed-segment-foryou').click();
    await expect(switcher).toHaveCount(0);
  });
});
