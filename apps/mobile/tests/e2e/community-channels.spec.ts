import { test, expect } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * Community channels, end to end against the real database.
 *
 * The unit tests mock supabase, so they prove the module calls the right
 * things — not that migration 105's RLS lets the seed user through, that the
 * realtime filter matches, or that the composer's write survives a round trip.
 * This posts a real message and reads it back.
 */

const COMMUNITY_ID = '4305a24a-8317-4e22-9277-8ac97baa2e53';

test.use({ viewport: { width: 412, height: 915 } });

test('a member opens a channel, posts, and sees her message', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto(`/community/channels/${COMMUNITY_ID}`);

  // The chip row must be VISIBLE, not merely present: a horizontal ScrollView
  // with no intrinsic height renders at 6px on react-native-web and every
  // assertion about its existence still passes.
  const bar = page.getByTestId('channel-bar');
  await bar.waitFor({ state: 'visible', timeout: 30_000 });
  const barHeight = await bar.evaluate((el) => el.getBoundingClientRect().height);
  expect(barHeight, 'the channel bar was crushed by a flex sibling').toBeGreaterThan(30);

  await expect(page.getByTestId('channel-bar-general')).toBeVisible();

  const body = `e2e channel probe ${Date.now()}`;
  await page.getByTestId('channel-composer-input').fill(body);
  await page.getByTestId('channel-composer-send').click();

  // Round trip: it is on screen because the database accepted it and handed
  // the row back, not because an optimistic update ran.
  await expect(page.getByText(body)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('channel-composer-input')).toHaveValue('');

  // Settle past the realtime INSERT this send triggers. The message must still
  // be there after the refetch it causes — a list that renders optimistically
  // and then empties itself on reload is the exact failure worth catching.
  await page.waitForTimeout(3000);
  await expect(page.getByText(body)).toBeVisible();
  await page.screenshot({ path: 'shots/community-channels.png' });

  // This test writes a real row into a real community. It cannot delete it —
  // the browser holds no service-role key — so the body is prefixed and
  // `node scripts/db-query.mjs "delete from public.community_channel_messages
  // where body like 'e2e channel probe %'"` is the sweep.
});
