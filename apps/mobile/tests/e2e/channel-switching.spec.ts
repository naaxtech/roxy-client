import { test, expect } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * Switching channels, against the real database.
 *
 * This checks the SETTLED state: a message written to #general is there when
 * she comes back to it, and is not there while she is somewhere else.
 *
 * It deliberately does NOT try to catch the three in-flight defects review
 * found — the previous channel's messages surviving a switch, an out-of-order
 * fetch, and a send landing in the wrong channel. Those live only in the
 * window while a request is open, and a browser cannot hold that window open
 * reliably: the first version of this file waited for the message to
 * disappear, the fetch resolved during the wait, and it passed against the bug
 * it was written to catch. `__tests__/screens/CommunityChannels.test.tsx`
 * resolves those fetches by hand instead, and each of its four cases has been
 * shown to fail with its fix reverted.
 *
 * This spec writes real rows. The sweep is:
 *   node scripts/db-query.mjs "delete from public.community_channel_messages
 *     where body like 'e2e switch probe %'"
 */

const COMMUNITY_ID = '4305a24a-8317-4e22-9277-8ac97baa2e53';

test.use({ viewport: { width: 412, height: 915 } });

test('a channel never shows another channel’s messages under its name', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto(`/community/channels/${COMMUNITY_ID}`);
  await page.getByTestId('channel-bar').waitFor({ state: 'visible', timeout: 30_000 });

  const chips = page.locator('[data-testid^="channel-bar-"]');
  const chipCount = await chips.count();

  const marker = `e2e switch probe ${Date.now()}`;
  await page.getByTestId('channel-composer-input').fill(marker);
  await page.getByTestId('channel-composer-send').click();
  await expect(page.getByText(marker)).toBeVisible({ timeout: 20_000 });

  if (chipCount < 2) {
    // Only one channel in this community, so there is no switch to make. The
    // send round trip above is still worth asserting; skip the rest honestly
    // rather than passing on a check that never ran.
    test.skip(true, 'community has a single channel — nothing to switch to');
  }

  // Settled: once #rants has loaded, #general's message is not in it.
  await chips.nth(1).click();
  await expect(page.getByText(marker)).toBeHidden({ timeout: 15_000 });

  // And switching back brings it home — which is the half that proves the row
  // was really written and really belongs to #general.
  await chips.nth(0).click();
  await expect(page.getByText(marker)).toBeVisible({ timeout: 20_000 });
});

test('an unsent draft does not follow her into another channel', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto(`/community/channels/${COMMUNITY_ID}`);
  await page.getByTestId('channel-bar').waitFor({ state: 'visible', timeout: 30_000 });

  const chips = page.locator('[data-testid^="channel-bar-"]');
  if ((await chips.count()) < 2) test.skip(true, 'community has a single channel');

  // The composer kept its own state across a channel change, so a private
  // thought typed in #general could be sent into #support by a woman who
  // thought the box was empty.
  await page.getByTestId('channel-composer-input').fill('does anyone else feel like this');
  await chips.nth(1).click();
  await expect(page.getByTestId('channel-composer-input')).toHaveValue('');
});
