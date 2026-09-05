import { test, expect } from '@playwright/test';
import { signInWithSeedUser } from './helpers/auth';

/**
 * The channel chips, in the DOM.
 *
 * Jest cannot see this. `TouchableOpacity` drops `aria-*` from the element
 * tree the test renderer walks, so a jest assertion on `aria-selected` reads
 * `undefined` whether the browser gets it or not — and `accessibilityState`
 * alone is inert on react-native-web 0.19.
 *
 * The chips first shipped as a `Pressable` with `accessible={false}` wrapping
 * a `View` that carried the role, the label and the selected state. Measured
 * in this browser, that produced two half-controls: the Pressable came out
 * `tabindex="0" role=null aria-label=null`, and the named `role="tab"` beside
 * it had no tabindex and no handler. A screen reader user reached a focusable
 * div with no name; the thing with the name could not be focused or activated.
 *
 * All four now sit on the one node, which is the shape `FloatingTabBar` uses
 * and this file proves.
 */

const COMMUNITY_ID = '4305a24a-8317-4e22-9277-8ac97baa2e53';

test.use({ viewport: { width: 412, height: 915 } });

test('a channel chip is named, roled, stated and focusable — all on one node', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto(`/community/channels/${COMMUNITY_ID}`);
  await page.getByTestId('channel-bar').waitFor({ state: 'visible', timeout: 30_000 });

  const chip = page.getByTestId('channel-bar-general');
  await expect(chip).toBeVisible();

  const attrs = await chip.evaluate((el) => ({
    role: el.getAttribute('role'),
    label: el.getAttribute('aria-label'),
    selected: el.getAttribute('aria-selected'),
    tabindex: el.getAttribute('tabindex'),
  }));

  expect(attrs.role).toBe('tab');
  expect(attrs.label).toBe('# general');
  // The state a screen reader announces. This is the attribute that was
  // missing entirely before `a11yState`, and on the wrong node after it.
  expect(attrs.selected).toBe('true');
  // Focusable, on the SAME node that carries the name and the role.
  expect(attrs.tabindex).toBe('0');
});

test('the unselected chip says so, rather than saying nothing', async ({ page }) => {
  await signInWithSeedUser(page);
  await page.goto(`/community/channels/${COMMUNITY_ID}`);
  await page.getByTestId('channel-bar').waitFor({ state: 'visible', timeout: 30_000 });

  const others = page.locator('[data-testid^="channel-bar-"]:not([data-testid="channel-bar-general"])');
  if (!(await others.count())) test.skip(true, 'community has a single channel');

  // An absent aria-selected is not the same claim as "false": it leaves a
  // tablist in which nothing tells assistive technology which tab is current.
  await expect(others.first()).toHaveAttribute('aria-selected', 'false');
});
