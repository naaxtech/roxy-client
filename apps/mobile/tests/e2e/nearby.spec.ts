import { test, expect, type Page, type Request } from '@playwright/test';
import { signInWithSeedUser, gotoTab } from './helpers/auth';

/**
 * Discover's "Near you" rail, end to end (spec › Tests › e2e, read-only).
 *
 * Read-only: it signs in, taps "Use my location" or not, and looks. It never
 * joins, never chooses a city, never writes. Run it against a local or
 * preview build, never production (the coordinator runs it).
 *
 *  - granted: permission is asked only from her tap; the rail then settles
 *    into rows or the empty state (which depends on the database), never an
 *    error; and every suggestion call is a POST whose body carries the pair
 *    rounded to 0.1°, with nothing in the URL.
 *  - not granted: her tap ends on the prompt card with "Choose a city", no
 *    position is ever sent, and after a refusal the city picker offers no way
 *    back to the browser prompt.
 */

test.use({ viewport: { width: 412, height: 915 } });

/** Makati, to six places: what a browser hands over. The app may send only 14.6 / 121. */
const MAKATI = { latitude: 14.554729, longitude: 121.024445 };
const NEARBY_RPC = /\/rest\/v1\/rpc\/(suggest_nearby_communities|suggest_communities_in_city|search_cities)\b/;

type RpcCall = { method: string; url: string; body: string | null };

function recordNearbyRpcs(page: Page): RpcCall[] {
  const calls: RpcCall[] = [];
  page.on('request', (req: Request) => {
    if (NEARBY_RPC.test(req.url())) calls.push({ method: req.method(), url: req.url(), body: req.postData() });
  });
  return calls;
}

async function openNearYou(page: Page) {
  await signInWithSeedUser(page);
  await gotoTab(page, 'discover');
  await expect(page.getByTestId('nearby-rail')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('nearby-prompt')).toBeVisible({ timeout: 30_000 });
}

test('granted: her tap locates, sends only the rounded pair by POST, and the rail settles', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(MAKATI);
  const calls = recordNearbyRpcs(page);

  await openNearYou(page);
  // Granted or not, nothing is located or sent before she taps.
  expect(calls, 'a nearby RPC went out before her tap').toHaveLength(0);

  await page.getByTestId('nearby-use-location').click();

  await expect(page.getByTestId('nearby-prompt')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('nearby-rail-loading')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('nearby-rail-error'), 'Near you errored').toHaveCount(0);

  const rows = page.locator('[data-testid^="nearby-row-"]');
  const empty = page.getByTestId('nearby-rail-empty');
  await expect(rows.first().or(empty), 'Near you settled into neither rows nor the empty state').toBeVisible();
  if (await empty.isVisible()) {
    // Empty says what she can do, with the moves on the rail itself.
    await expect(page.getByTestId('nearby-empty-city')).toBeVisible();
    await expect(page.getByText(/start one|be the first/i)).toHaveCount(0);
  }

  const suggest = calls.filter((c) => c.url.includes('suggest_nearby_communities'));
  expect(suggest.length, 'no suggestion call was made').toBeGreaterThan(0);
  for (const c of suggest) {
    expect(c.method).toBe('POST');
    expect(new URL(c.url).search, 'arguments leaked into the URL').toBe('');
    const body = JSON.parse(c.body ?? '{}') as Record<string, unknown>;
    expect(body.p_lat).toBe(14.6);
    expect(body.p_lng).toBe(121);
    expect(c.body ?? '').not.toMatch(/14\.55|121\.02/);
  }
});

test('not granted: her tap ends on "Choose a city", and no position is ever sent', async ({ page, context }) => {
  await context.clearPermissions();
  const calls = recordNearbyRpcs(page);

  await openNearYou(page);
  await page.getByTestId('nearby-use-location').click();

  // Headless Chromium answers an ungranted geolocation request as
  // PERMISSION_DENIED (the refusal copy); a headed browser leaves its prompt
  // open, which the app bounds at WEB_PERMISSION_TIMEOUT_MS (20 s, the
  // timeout copy). Either way she lands on the prompt card, not skeletons.
  const refused = page.getByText(/Location is off for Roxy/);
  const timedOut = page.getByText(/Finding your location took too long/);
  await expect(refused.or(timedOut)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('nearby-prompt')).toBeVisible();
  await expect(page.getByTestId('nearby-choose-city')).toBeVisible();
  await expect(page.getByTestId('nearby-rail-loading')).toHaveCount(0);

  expect(calls.filter((c) => /suggest_nearby_communities/.test(c.url)), 'a position was sent without a grant').toHaveLength(0);

  if (await refused.isVisible()) {
    // After a refusal nothing asks again: no "Use my location" on the card,
    // and the city picker offers none either (the web has no Settings page).
    await expect(page.getByTestId('nearby-use-location')).toHaveCount(0);
    await page.getByTestId('nearby-choose-city').click();
    await expect(page.getByTestId('city-picker')).toBeVisible();
    await expect(page.getByTestId('city-use-location')).toHaveCount(0);
    await expect(page.getByTestId('city-open-settings')).toHaveCount(0);
    await expect(page.getByTestId('city-picker-attribution')).toHaveText('City data © GeoNames (CC BY 4.0)');
  }
});
