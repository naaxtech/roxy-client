import { expect, type Page } from '@playwright/test';

export const E2E_EMAIL = process.env.E2E_EMAIL ?? 'e2e-playwright@seed.roxy.app';
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-playwright-pass-123';

/**
 * The four destinations in the Roxy 3.0 bar, keyed by the Expo Router directory
 * under `app/(tabs)/`. `create` is the fifth slot and is deliberately absent:
 * it is an action, not a destination, so it has no URL to assert.
 *
 * `components/nav/navSlots3.ts` is the source; `nav-slot-<routeName>` is the
 * testID `FloatingTabBar` emits per slot.
 */
export const TAB_SLOTS = ['feed', 'discover', 'messages', 'you'] as const;
export type TabSlot = (typeof TAB_SLOTS)[number];

/**
 * Sign in as the seeded Playwright user and wait until the app shell is up.
 *
 * The first screen is the invite-code gate, not the welcome screen — a member
 * who already has an account reaches the email form through
 * `already-have-account`. Skipping that hop is why this helper went stale: it
 * waited on `welcome-screen` at `/`, which has not been the root since the code
 * gate shipped.
 *
 * The readiness signal is `nav-bar`, the floating pill itself. It used to be a
 * link named "Play" — a tab that no longer exists, and a role that no longer
 * applies now that the bar is `TouchableOpacity` with `accessibilityRole="tab"`
 * rather than a set of router links.
 */
export async function signInWithSeedUser(page: Page) {
  await page.goto('/');

  await expect(page.getByTestId('code-gate-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('already-have-account').click();

  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('use-email-link').click();

  // The form opens in sign-in mode when there is no validated invite code, which
  // is exactly how we got here. Asserting the mode rather than clicking a toggle
  // is deliberate: clicking blind would flip a form that was already correct and
  // silently create an account instead of signing into one.
  await expect(page.getByTestId('auth-submit-btn')).toHaveAttribute('aria-label', 'Sign In');

  await page.getByTestId('email-input').fill(E2E_EMAIL);
  await page.getByTestId('password-input').fill(E2E_PASSWORD);
  await page.getByTestId('auth-submit-btn').click();

  await expect(page.getByTestId('nav-bar')).toBeVisible({ timeout: 30_000 });
  await dismissFirstRunSheets(page);
}

/**
 * Clear anything the app opens by itself on first launch.
 *
 * Feed shows the Mini Wins sheet once per calendar day, gated on AsyncStorage —
 * and every Playwright context is a fresh browser profile, so "once per day" is
 * "every single test". It is a `Modal`, so its scrim covers the tab bar: any
 * test that navigates before dismissing it fails on an intercepted click that
 * has nothing to do with what it was testing.
 *
 * Deliberately tolerant of the sheet not being there. Whether it appears is a
 * property of the day and the account, and a helper that required it would fail
 * for a reason the test does not care about.
 */
export async function dismissFirstRunSheets(page: Page) {
  const sheet = page.getByTestId('mini-wins-sheet');
  const open = await sheet
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!open) return;

  await page.getByLabel('Close').click();
  await expect(sheet).toBeHidden({ timeout: 10_000 });
}

/** Tap a bar slot and wait for its URL. Never asserts on the label — labels are
 *  copy and copy moves; the route name is the contract. */
export async function gotoTab(page: Page, slot: TabSlot) {
  await page.getByTestId(`nav-slot-${slot}`).click();
  await expect(page).toHaveURL(new RegExp(`/${slot}$`), { timeout: 15_000 });
}
