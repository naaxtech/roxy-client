import { test, expect, type Page } from '@playwright/test';
import { signInWithSeedUser, gotoTab } from './helpers/auth';
import { attachDiagnostics, filterBenignErrors, formatDiagnostics } from './helpers/diagnostics';

/**
 * UI audit for the browse surfaces after the Roxy 3.0 flattening.
 *
 * The old version of this file walked Discover's own feed tab and the Connect
 * tab. Both are gone: Discover is a rail board now and Connect dissolved into
 * Feed's Communities segment and Discover's rails. What is audited here is what
 * replaced them.
 *
 * Every rail has four states — loading, ready, empty, error — and `Rail` emits a
 * testID for three of them. A rail that renders its ERROR state is a real
 * failure and is asserted against directly; a rail that is merely empty is a
 * property of the seed data and is allowed.
 */

/** Every rail Discover can draw, as `Rail` testIDs. */
const RAILS = ['top10', 'live', 'events', 'economy', 'communities', 'games'] as const;

/**
 * A rail has REACHED a terminal state — content or empty — and is not still
 * spinning.
 *
 * The first version of this ORed `rail-X` with its `-empty` and `-loading`
 * states, which could not fail: `Rail` puts `testID` on its outer `View`, and
 * that view is mounted in every status. Six rails spinning forever passed a
 * test called "every rail renders". `-loading` reaching zero is the assertion
 * with teeth.
 */
async function railSettled(page: Page, rail: string) {
  await expect(page.getByTestId(`rail-${rail}`)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId(`rail-${rail}-loading`)).toHaveCount(0, { timeout: 45_000 });

  const terminal = page
    .getByTestId(`rail-${rail}-cards`)
    .or(page.getByTestId(`rail-${rail}-empty`));
  await expect(terminal.first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Discover board', () => {
  test('every rail renders and none reports an error', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await signInWithSeedUser(page);
    await gotoTab(page, 'discover');

    await expect(page.getByTestId('discover-chips')).toBeVisible();

    for (const rail of RAILS) {
      await railSettled(page, rail);
      await expect(page.getByTestId(`rail-${rail}-error`)).toHaveCount(0);
    }

    // Question of the Day is not a `Rail` — it is a card that renders null on a
    // day with no question, so what is assertable end-to-end is its SLOT, which
    // is gated on the chip and on a real user id. The card's own states have
    // unit coverage; this is the wiring that made `/qotd/<id>` reachable again.
    await expect(page.getByTestId('rail-qotd')).toHaveCount(1);

    const critical = filterBenignErrors([...diag.pageErrors, ...diag.consoleErrors]);
    expect(critical, formatDiagnostics({ ...diag, pageErrors: critical, consoleErrors: [] })).toEqual([]);
  });

  test('a top chip narrows the board to its own rails', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'discover');

    // `components/discover/discoverFilters.ts` is the arithmetic; this is the
    // proof it is wired to the screen rather than merely unit-tested. Events
    // keeps the hero and the events rail and drops everything else — the bug
    // this guards is the one where a top chip silently hid an unrelated rail.
    await page.getByTestId('discover-chips-events').click();
    await railSettled(page, 'events');
    await expect(page.getByTestId('rail-economy')).toHaveCount(0);
    await expect(page.getByTestId('rail-communities')).toHaveCount(0);
    await expect(page.getByTestId('rail-games')).toHaveCount(0);
    // qotd is an all-view rail: a question of the day is a today thing, not an
    // events thing.
    await expect(page.getByTestId('rail-qotd')).toHaveCount(0);

    await page.getByTestId('discover-chips-shops').click();
    await railSettled(page, 'economy');
    await expect(page.getByTestId('rail-events')).toHaveCount(0);

    await page.getByTestId('discover-chips-all').click();
    await railSettled(page, 'communities');
  });

  test('search reaches the search screen and back returns to the board', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'discover');

    await page.getByTestId('discover-search').click();
    await expect(page).toHaveURL(/\/search$/, { timeout: 15_000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/discover$/);
  });
});

test.describe('Community detail', () => {
  test('posts render and a post opens its detail screen', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await signInWithSeedUser(page);
    await gotoTab(page, 'discover');

    const firstCommunity = page.locator('[data-testid^="community-"]').first();
    const hasCommunity = await firstCommunity
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasCommunity, 'no communities seeded');

    await firstCommunity.click();
    await expect(page).toHaveURL(/\/community\/[0-9a-f-]+$/, { timeout: 15_000 });

    // Community detail is the one surface still on the card pipeline —
    // `FeedCard` → `StaticPostCard` / `VideoPostCard`. The Feed tab is the
    // pager; these two are not the same component and not interchangeable.
    //
    // The two card types go to DIFFERENT screens: `contentDetailPath()` sends a
    // video to `/community/video/<id>` and everything else to
    // `/community/post/<id>`. A locator that took whichever came first read as
    // flaky and was not — it depended on whether that community's newest post
    // happened to be a video.
    const still = page.getByTestId('static-card').first();
    const hasStill = await still
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasStill, 'no non-video posts in the first community');

    await still.click();
    await expect(page).toHaveURL(/\/community\/post\/[0-9a-f-]+$/, { timeout: 15_000 });
    await expect(page.getByTestId('post-detail-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('post-detail-back').click();

    const critical = filterBenignErrors([...diag.pageErrors, ...diag.consoleErrors]);
    expect(critical, formatDiagnostics({ ...diag, pageErrors: critical, consoleErrors: [] })).toEqual([]);
  });

  test('a video post opens the player, not the post detail screen', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'discover');

    const firstCommunity = page.locator('[data-testid^="community-"]').first();
    const hasCommunity = await firstCommunity
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasCommunity, 'no communities seeded');

    await firstCommunity.click();

    const video = page.getByTestId('video-card').first();
    const hasVideo = await video
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasVideo, 'no video posts in the first community');

    await video.click();
    await expect(page).toHaveURL(/\/community\/video\/[0-9a-f-]+$/, { timeout: 15_000 });
    await expect(page.getByTestId('video-player-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('video-back-btn').click();
  });
});
