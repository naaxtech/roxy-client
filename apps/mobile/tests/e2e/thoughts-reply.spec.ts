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

  // The seed account carries a few written posts. If it does not, skip rather
  // than fail: an empty Thoughts tab is a fixture problem, and a red test that
  // means "no data" trains people to ignore red tests.
  await page.getByTestId('profile-thoughts-empty')
    .or(page.locator('[data-testid$="-reply"]').first())
    .waitFor({ state: 'visible', timeout: 30_000 });
  const replies = page.locator('[data-testid$="-reply"]');
  test.skip(await replies.count() === 0, 'seed account has no written posts');

  await replies.first().click();

  // She must STILL be on her profile: the whole point is that a one-line answer
  // does not cost her the scroll position and the thread she was reading.
  await expect(page).toHaveURL(/\/you$/);

  // Targeted by placeholder, not by `input[type=text]`: react-native-web
  // renders a TextInput with NO type attribute, so the type selector matched
  // nothing and an earlier version of this test failed over a working screen.
  const composer = page.getByPlaceholder('Write a reply…');
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.fill('replying inline');
  await expect(composer).toHaveValue('replying inline');
  await page.screenshot({ path: 'shots/thought-inline-reply.png', fullPage: true });

  // And it collapses again, so the profile does not fill with open threads.
  await replies.first().click();
  await expect(composer).toBeHidden({ timeout: 10_000 });
});

test('Like marks itself as pressed, so the tap is not silent', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto('/you');
  await page.getByTestId('profile-tab-thoughts').click();

  await page.getByTestId('profile-thoughts-empty')
    .or(page.locator('[data-testid$="-like"]').first())
    .waitFor({ state: 'visible', timeout: 30_000 });
  const likes = page.locator('[data-testid$="-like"]');
  test.skip(await likes.count() === 0, 'seed account has no written posts');
  const like = likes.first();

  const before = await like.getAttribute('aria-pressed');
  await like.click();
  await page.waitForTimeout(600);
  const after = await like.getAttribute('aria-pressed');

  // The state a screen reader announces has to change, not only the icon.
  expect(after).not.toBe(before);
});

test('the replies panel settles instead of spinning forever', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto('/you');
  await page.getByTestId('profile-tab-thoughts').click();

  const replies = page.locator('[data-testid$="-reply"]');
  await replies.first().waitFor({ state: 'visible', timeout: 30_000 });
  await replies.first().click();

  // Either replies, or the empty line. A spinner still turning after this long
  // means the load never resolved, and a permanent spinner is how a surface
  // says "broken" without saying anything.
  const panel = page.locator('[data-testid*="-replies-"]').first();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(4000);

  const stillLoading = await panel.locator('[data-testid$="-loading"]').count();
  expect(stillLoading, 'the replies panel is still spinning').toBe(0);
});

test('reacting with an emoji sticks, and the tally goes up', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto('/you');
  await page.getByTestId('profile-tab-thoughts').click();

  const add = page.locator('[data-testid$="-reactions-add"]').first();
  await add.waitFor({ state: 'visible', timeout: 30_000 });
  await add.click();

  // The picker offers the same six the chat bar does.
  const heart = page.locator('[data-testid$="-reactions-pick-❤️"]').first();
  await expect(heart).toBeVisible();
  await heart.click();

  // A chip appears carrying the emoji and a count — the reaction is part of
  // reading the post, not hidden behind the picker.
  const chip = page.locator('[data-testid$="-reactions-chip-❤️"]').first();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  await page.screenshot({ path: 'shots/thought-reactions.png', fullPage: true });
});
