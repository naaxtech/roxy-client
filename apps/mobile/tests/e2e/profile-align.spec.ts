import { expect, test } from '@playwright/test';
import { signInWithSeedUser, gotoTab } from './helpers/auth';

test.use({ viewport: { width: 412, height: 915 } });

test('avatar centre sits on the cover / body seam', async ({ page }) => {
  await signInWithSeedUser(page);
  await gotoTab(page, 'you');
  await expect(page.getByTestId('profile-avatar')).toBeVisible({ timeout: 30_000 });

  const cover = await page.getByTestId('profile-cover').boundingBox();
  const avatar = await page.getByTestId('profile-avatar').boundingBox();
  expect(cover).toBeTruthy();
  expect(avatar).toBeTruthy();

  const seam = cover!.y + cover!.height;
  const avatarCentre = avatar!.y + avatar!.height / 2;
  expect(Math.abs(avatarCentre - seam)).toBeLessThan(4);
});
