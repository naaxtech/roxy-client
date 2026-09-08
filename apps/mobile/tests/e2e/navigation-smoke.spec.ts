import { test, expect } from '@playwright/test';
import { signInWithSeedUser, gotoTab, TAB_SLOTS } from './helpers/auth';

/**
 * Navigation smoke for the Roxy 3.0 IA (four destinations plus a ＋ action).
 *
 * What it locks in, and why each one is here rather than assumed:
 *  - the bar has FOUR routes, not five. `grow`, `connect` and `build` are gone,
 *    and a `Tabs.Screen` naming a route that no longer exists is not inert —
 *    Expo Router logs on every render of the navigator.
 *  - ＋ is an ACTION. It opens a sheet and must never change the URL; it sits at
 *    the centre index precisely because it is not a destination.
 *  - community view is a ROOT route: opening it never switches tabs and back
 *    returns to the tab it was opened from (it used to be hijacked into Play).
 *  - the notifications bell has exactly one home now. It used to live on Grow;
 *    Feed is a full-bleed pager with no chrome to spare, so it moved to the
 *    Discover header. If that button goes, notifications become unreachable.
 */
test.describe('Navigation smoke', () => {
  test('the four tabs route to their URLs', async ({ page }) => {
    await signInWithSeedUser(page);

    for (const slot of TAB_SLOTS) {
      await gotoTab(page, slot);
    }
  });

  test('the bar tells assistive tech which tab is current', async ({ page }) => {
    await signInWithSeedUser(page);

    // `accessibilityState={{ selected }}` is inert on react-native-web: it
    // rendered a `role="tab"` with no selected state at all, which is a WCAG
    // 2.2 SC 4.1.2 failure. `lib/a11yState.ts` emits `aria-selected` beside it.
    // This assertion is the one that fails if anyone puts the RN-only spelling
    // back — the unit test cannot see the DOM, and the DOM is where it broke.
    await gotoTab(page, 'discover');
    await expect(page.getByTestId('nav-slot-discover')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-slot-feed')).toHaveAttribute('aria-selected', 'false');

    await gotoTab(page, 'you');
    await expect(page.getByTestId('nav-slot-you')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-slot-discover')).toHaveAttribute('aria-selected', 'false');
  });

  test('the retired tabs are gone from the bar', async ({ page }) => {
    await signInWithSeedUser(page);

    for (const dead of ['grow', 'connect', 'build']) {
      await expect(page.getByTestId(`nav-slot-${dead}`)).toHaveCount(0);
    }
  });

  test('the ＋ slot opens the create sheet and does not navigate', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'discover');

    const before = page.url();
    await page.getByTestId('nav-slot-create').click();

    await expect(page.getByTestId('create-sheet')).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toBe(before);
  });

  test('community view opens at the root route and back returns to Discover', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'discover');

    const firstCommunity = page.locator('[data-testid^="community-"]').first();
    const hasCommunity = await firstCommunity
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasCommunity, 'no communities seeded');

    await firstCommunity.click();

    // Root route, not the Discover-stack route it is implemented under.
    await expect(page).toHaveURL(/\/community\/[0-9a-f-]+$/, { timeout: 15_000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/discover$/);
  });

  test('the notifications bell reaches the notifications screen', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'discover');

    await page.getByTestId('discover-notifications').click();
    await expect(page).toHaveURL(/\/notifications$/, { timeout: 15_000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/discover$/);
  });

  test('a live room degrades to the native-only screen without polluting the tab', async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, 'feed');

    // Live rooms live in the collapsed "Now" rail over the feed. It is closed by
    // default on purpose — a feed is a place you fall into, not a strip of
    // things demanding attention — so the toggle is part of the path.
    await page.getByTestId('feed-now-toggle').click();

    const room = page.locator('[data-testid^="now-rail-room-"]').first();
    const hasRoom = await room
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasRoom, 'no live rooms seeded');

    await room.click();
    await expect(page).toHaveURL(/\/community-room-session\?/);

    // Web degrades gracefully — no dialog, a friendly screen with a back action.
    await expect(page.getByText('Video rooms work in the Roxy app', { exact: false }))
      .toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Go back').click();

    // Feed must land on the feed, not on a stale call screen.
    await gotoTab(page, 'feed');
    await expect(page.getByTestId('feed-screen')).toBeVisible();
  });
});
