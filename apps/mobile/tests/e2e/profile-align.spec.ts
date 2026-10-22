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

test('badges and Edit sit beside the avatar, not below it', async ({ page }) => {
  await signInWithSeedUser(page);
  await gotoTab(page, 'you');
  await expect(page.getByTestId('profile-avatar')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('profile-primary-action')).toBeVisible();

  const avatar = await page.getByTestId('profile-avatar').boundingBox();
  const edit = await page.getByTestId('profile-primary-action').boundingBox();
  expect(avatar).toBeTruthy();
  expect(edit).toBeTruthy();

  const overlaps = (a: { y: number; height: number }, b: { y: number; height: number }) =>
    a.y < b.y + b.height && a.y + a.height > b.y;

  expect(overlaps(avatar!, edit!)).toBeTruthy();

  // v2 (direction › You) draws no badge chip and no XP pill on her own
  // profile; check them only where they still exist (count first: a
  // boundingBox() on a missing node waits for the whole test timeout).
  const badgeChip = page.getByTestId('profile-badge-chip');
  if (await badgeChip.count()) {
    const badges = await badgeChip.boundingBox();
    if (badges) expect(overlaps(avatar!, badges)).toBeTruthy();
  }

  const xpPill = page.getByTestId('profile-xp');
  if (await xpPill.count()) {
    const xp = await xpPill.boundingBox();
    if (xp) expect(overlaps(avatar!, xp)).toBeTruthy();
  }
});
