import { test, expect } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * Answering the question of the day (Nicole, 2026-10-23: "responding to a
 * question post is weird and awkward").
 *
 * Before: the text box opened pre-filled with "QUESTION OF THE DAY" and the
 * question, so she typed under a caps label she could delete; her answer was
 * the small grey line under the question; Back opened the post-type picker.
 * Now the question is fixed on the card, the box holds only her answer, her
 * words become the card's headline, and Back leaves.
 *
 * Read-only: it never presses Publish, and any write to `posts` is aborted.
 */

test.use({ viewport: { width: 390, height: 844 } });

test('the answer composer: fixed question, empty box, her words lead the card', async ({ page }) => {
  await page.route(/\/rest\/v1\/posts/, (route) => (
    route.request().method() === 'GET' ? route.continue() : route.abort()
  ));
  await signInWithSeedUser(page);

  await page.goto('/community/create-post?prompt=2');
  const box = page.getByTestId('create-caption');
  await box.waitFor({ state: 'visible', timeout: 30_000 });

  await expect(page.getByText('Your answer', { exact: true })).toBeVisible();
  await expect(page.getByTestId('text-card-preview-kick')).toBeVisible();
  const question = (await page.getByTestId('text-card-preview-question').innerText()).trim();
  expect(question.length, 'the question is on the card').toBeGreaterThan(10);
  await expect(page.getByTestId('text-card-preview-answer-placeholder')).toBeVisible();

  // The box is hers alone: no caps label, no question to type around.
  await expect(box).toHaveValue('');
  await expect(page.getByTestId('create-publish')).toHaveAttribute('aria-disabled', 'true');

  await box.fill('Gilmore Girls, every autumn.');
  await expect(page.getByTestId('text-card-preview-prompt')).toHaveText('Gilmore Girls, every autumn.');
  await expect(page.getByTestId('text-card-preview-question')).toHaveText(question);
  await expect(page.getByTestId('create-publish')).not.toHaveAttribute('aria-disabled', 'true');

  // Her answer sits below the question and reads larger than it.
  const q = await page.getByTestId('text-card-preview-question').boundingBox();
  const a = await page.getByTestId('text-card-preview-prompt').boundingBox();
  expect(q && a && q.y < a.y, 'question above her answer').toBeTruthy();
  const size = async (id: string) => page.getByTestId(id).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size('text-card-preview-prompt')).toBeGreaterThan(await size('text-card-preview-question'));

  // Back leaves the composer; it does not open the post-type picker.
  await page.getByText('Back', { exact: true }).click();
  await expect(page.getByTestId('create-type-standard')).toHaveCount(0);
  await page.getByTestId('nav-bar').waitFor({ state: 'visible', timeout: 30_000 });
});
