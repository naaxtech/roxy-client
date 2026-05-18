import { test, expect } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

test.describe('Discover feed', () => {
  test('shows seeded posts after login', async ({ page }) => {
    await signInWithSeedUser(page);

    await page.getByRole('link', { name: /Discover/i }).click();
    await page.getByTestId('discover-tab-feed').click();

    // At least one feed card type from seed data (standard/photo/video/etc.)
    const feedCard = page.getByTestId('static-card').or(page.getByTestId('video-card')).first();
    await expect(feedCard).toBeVisible({ timeout: 30_000 });

    // Should not show empty-state copy when DB has content
    await expect(page.getByText('No posts yet. Join more communities')).toHaveCount(0);
  });
});
