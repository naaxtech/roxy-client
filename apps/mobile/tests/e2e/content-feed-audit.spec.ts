import { test, expect } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';
import { attachDiagnostics, filterBenignErrors, formatDiagnostics } from './helpers/diagnostics';

/**
 * Automated UI audit for the content feed (spec: 2026-04-24-content-feed-design).
 * Clicks through Discover + Connect, asserts card types, actions, and zero critical errors.
 */
test.describe('Content feed UI audit', () => {
  test('Discover: mixed card types, actions, and post detail', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await signInWithSeedUser(page);

    await page.getByRole('link', { name: /Discover/i }).click();
    await page.getByTestId('discover-tab-feed').click();

    // Wait for at least one feed card
    const anyCard = page
      .getByTestId('static-card')
      .or(page.getByTestId('video-card'))
      .or(page.getByTestId('roxy-link-card'));
    await expect(anyCard.first()).toBeVisible({ timeout: 45_000 });

    // Photo post should render an image zone when seeded correctly
    const photoCard = page.getByTestId('static-card').filter({
      has: page.getByTestId('post-image'),
    });
    if (await photoCard.count()) {
      await expect(photoCard.first().getByTestId('post-image')).toBeVisible();
    }

    // Video card + open player
    const videoCard = page.getByTestId('video-card').first();
    if (await videoCard.isVisible().catch(() => false)) {
      await videoCard.click();
      await expect(page.getByTestId('video-player-screen')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('video-back-btn').click();
    }

    // Roxy link card
    const linkCard = page.getByTestId('roxy-link-card').first();
    if (await linkCard.isVisible().catch(() => false)) {
      await expect(linkCard.getByTestId('roxy-link-cta')).toBeVisible();
    }

    // Like / save on first static card
    const staticCard = page.getByTestId('static-card').first();
    await staticCard.getByTestId('action-like').click();
    await staticCard.getByTestId('action-save').click();

    // Open post detail (must load when navigated from feed)
    await staticCard.click();
    await expect(page.getByTestId('post-detail-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('post-detail-back').click();

    const critical = filterBenignErrors([...diag.pageErrors, ...diag.consoleErrors]);
    expect(critical, formatDiagnostics({ ...diag, pageErrors: critical, consoleErrors: [] })).toEqual([]);
  });

  test('Connect: feed from joined communities + community filter', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await signInWithSeedUser(page);

    await page.getByRole('link', { name: /Connect/i }).click();
    await page.getByTestId('connect-tab-feed').click();

    const feedCard = page
      .getByTestId('static-card')
      .or(page.getByTestId('video-card'))
      .or(page.getByTestId('roxy-link-card'));
    await expect(feedCard.first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Join communities to see their posts here')).toHaveCount(0);
    await expect(page.getByText('Could not load feed')).toHaveCount(0);

    const countAll = await feedCard.count();

    // Filter to first community in picker
    await page.getByTestId('community-switcher-btn').click();
    await expect(page.getByTestId('community-search-input')).toBeVisible();
    const firstCommunity = page.locator('[data-testid^="community-option-"]').nth(1);
    if (await firstCommunity.isVisible()) {
      await firstCommunity.click();
      await expect(feedCard.first()).toBeVisible({ timeout: 20_000 });
    }

    // Back to All Communities
    await page.getByTestId('community-switcher-btn').click();
    await page.getByTestId('community-option-all').click();
    const countReset = await feedCard.count();
    expect(countReset).toBeGreaterThanOrEqual(1);
    expect(countReset).toBeGreaterThanOrEqual(Math.min(countAll, 1));

    const critical = filterBenignErrors([...diag.pageErrors, ...diag.consoleErrors]);
    expect(critical, formatDiagnostics({ ...diag, pageErrors: critical, consoleErrors: [] })).toEqual([]);
  });
});
