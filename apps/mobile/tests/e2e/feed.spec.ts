import { test, expect } from '@playwright/test';
import { signInWithSeedUser, gotoTab } from './helpers/auth';

/**
 * The Feed tab — a full-bleed vertical pager, not a scrolling card list.
 *
 * Assertions are structural on purpose. Whether a given seed database has video
 * in a given scope is not a property of the app, so a test that demanded cards
 * would fail on the shape of the data rather than on a regression. What must
 * always hold is that the pager resolves to CONTENT or to a stated EMPTY state
 * and never to neither — a feed stuck between the two is the failure mode that
 * ships silently.
 */
test.describe('Feed', () => {
  test('the pager resolves for every segment', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'feed');

    await expect(page.getByTestId('feed-screen')).toBeVisible();
    await expect(page.getByTestId('feed-segments')).toBeVisible();

    const settled = page.getByTestId('reels-feed').or(page.getByTestId('reels-feed-empty'));

    for (const segment of ['foryou', 'following', 'communities']) {
      await page.getByTestId(`feed-segment-${segment}`).click();
      await expect(settled.first()).toBeVisible({ timeout: 45_000 });
    }
  });

  test('the Now rail opens and closes from its toggle', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'feed');

    const toggle = page.getByTestId('feed-now-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Open means it reports SOMETHING — rooms, empty, or a failed load. A rail
    // that is expanded and renders nothing at all is the bug.
    const railState = page
      .getByTestId('now-rail')
      .or(page.getByTestId('now-rail-empty'))
      .or(page.getByTestId('now-rail-error'))
      .or(page.getByTestId('now-rail-loading'));
    await expect(railState.first()).toBeVisible({ timeout: 30_000 });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('the streak chip opens Mini Wins', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'feed');

    // `signInWithSeedUser` has already dismissed the once-a-day auto-open, so
    // this exercises the manual path — the only one left after the first open.
    await page.getByTestId('feed-streak-chip').click();
    await expect(page.getByTestId('mini-wins-sheet')).toBeVisible({ timeout: 15_000 });
  });
});
