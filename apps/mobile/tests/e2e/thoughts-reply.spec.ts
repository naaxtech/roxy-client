import { test, expect } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * A thought you cannot answer is a broadcast.
 *
 * Reply deliberately routes to the post's own page rather than opening a
 * composer inside the profile tab: the thread and the composer already live
 * there, and a second comment surface would be a second place for a reply to
 * go missing. This proves the route actually lands somewhere she can type.
 */

test.use({ viewport: { width: 412, height: 915 } });

test('Reply lands on the thought, with somewhere to write', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto('/you');
  await page.getByTestId('profile-tab-thoughts').click();

  const firstReply = page.locator('[data-testid$="-reply"]').first();
  await firstReply.waitFor({ state: 'visible', timeout: 30_000 });
  await firstReply.click();

  // Off the profile and onto the post.
  await expect(page).not.toHaveURL(/\/you$/, { timeout: 20_000 });

  // Targeted by placeholder, not by `input[type=text]`: react-native-web
  // renders a TextInput with NO type attribute, so the type selector matched
  // nothing and the first version of this test failed over a working screen.
  const composer = page.getByPlaceholder('Add a comment…');
  await expect(composer).toBeVisible({ timeout: 20_000 });

  // She can actually type in it — visible is not the same as usable.
  await composer.fill('replying from the thoughts tab');
  await expect(composer).toHaveValue('replying from the thoughts tab');

  await page.screenshot({ path: 'shots/thought-detail.png', fullPage: true });
});

test('Like marks itself as pressed, so the tap is not silent', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto('/you');
  await page.getByTestId('profile-tab-thoughts').click();

  const like = page.locator('[data-testid$="-like"]').first();
  await like.waitFor({ state: 'visible', timeout: 30_000 });

  const before = await like.getAttribute('aria-pressed');
  await like.click();
  await page.waitForTimeout(600);
  const after = await like.getAttribute('aria-pressed');

  // The state a screen reader announces has to change, not only the icon.
  expect(after).not.toBe(before);
});
