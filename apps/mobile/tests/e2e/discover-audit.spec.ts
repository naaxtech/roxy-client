import { test, expect } from '@playwright/test';
import { signInWithSeedUser, gotoTab } from './helpers/auth';

/**
 * A geometry audit of the Discover tab, in a real browser at the design's own
 * viewport.
 *
 * Jest renders the native tree and cannot see any of this: it knows a style
 * object said `width: 164`, not whether the text inside overflowed it, wrapped,
 * or got clipped. Every defect this file looks for is one that only exists once
 * a layout engine has run.
 *
 * The checks are deliberately about MEASURED boxes rather than screenshots.
 * A screenshot diff tells you something changed; `scrollWidth > clientWidth`
 * tells you a woman cannot read the end of a word.
 */

const VIEWPORT = { width: 412, height: 915 };

test.use({ viewport: VIEWPORT });

test.beforeEach(async ({ page }) => {
  await signInWithSeedUser(page);
  await gotoTab(page, 'discover');
});

test('nothing on Discover overflows the viewport horizontally', async ({ page }) => {
  // A page that scrolls sideways is the single most common symptom of a card
  // with a fixed width inside a padded parent.
  const overflow = await page.evaluate((w) => document.documentElement.scrollWidth - w, VIEWPORT.width);
  expect(overflow, 'document scrolls horizontally').toBeLessThanOrEqual(0);
});

test('no visible text is clipped by its own box', async ({ page }) => {
  await page.waitForTimeout(1500);

  const clipped = await page.evaluate(() => {
    const bad: { text: string; scroll: number; client: number }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('div, span, p'))) {
      // Only leaf text nodes — a container's scrollWidth legitimately exceeds
      // its client width when it is a horizontal scroller.
      if (el.children.length > 0) continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;

      const style = getComputedStyle(el);
      if (style.overflow === 'visible' && style.textOverflow !== 'ellipsis') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      // A horizontally scrollable row is not clipped text.
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;

      if (el.scrollWidth > el.clientWidth + 1) {
        bad.push({ text: text.slice(0, 60), scroll: el.scrollWidth, client: el.clientWidth });
      }
    }
    return bad;
  });

  expect(clipped, `clipped text on Discover:\n${JSON.stringify(clipped, null, 2)}`).toEqual([]);
});

test('every category chip is legible and hittable', async ({ page }) => {
  const chips = page.locator('[data-testid^="discover-chips-"]:not([data-testid$="-pill"])');
  const count = await chips.count();
  expect(count, 'no category chips rendered').toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const chip = chips.nth(i);
    const box = await chip.boundingBox();
    const name = await chip.getAttribute('aria-label');

    expect(box, `chip ${name} has no box`).not.toBeNull();
    // The rule the redesign is about: the TARGET stays >= 44, and the row does
    // not become a wall of slabs.
    expect(box!.height, `chip ${name} target too small`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `chip ${name} target absurdly tall`).toBeLessThanOrEqual(64);
    expect(box!.width, `chip ${name} too narrow to read`).toBeGreaterThan(40);
  }
});

test('the chip row is one line, not a wrapped block', async ({ page }) => {
  const chips = page.locator('[data-testid^="discover-chips-"]:not([data-testid$="-pill"])');
  const count = await chips.count();

  const tops = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const box = await chips.nth(i).boundingBox();
    if (box) tops.add(Math.round(box.y));
  }
  // Every chip shares a baseline; more than one means the row wrapped and the
  // header is eating the rails' space.
  expect([...tops], 'chip row wrapped onto multiple lines').toHaveLength(1);
});

test('rail cards in a row all bottom out at the same height', async ({ page }) => {
  await page.waitForTimeout(1500);

  const ragged = await page.evaluate(() => {
    const rows: { rail: string; heights: number[] }[] = [];
    for (const rail of Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="rail-"]'))) {
      const scroller = rail.querySelector<HTMLElement>('[data-testid$="-cards"]');
      if (!scroller) continue;
      const cards = Array.from(scroller.children) as HTMLElement[];
      const heights = cards
        .map((c) => Math.round(c.getBoundingClientRect().height))
        .filter((h) => h > 0);
      if (heights.length < 2) continue;
      // A ragged rail is the visual symptom of a title block that grows with
      // its content instead of reserving its space.
      if (Math.max(...heights) - Math.min(...heights) > 2) {
        rows.push({ rail: rail.getAttribute('data-testid') ?? '?', heights });
      }
    }
    return rows;
  });

  expect(ragged, `rails with uneven card heights:\n${JSON.stringify(ragged, null, 2)}`).toEqual([]);
});

test('no element is wider than the screen', async ({ page }) => {
  await page.waitForTimeout(1500);

  const tooWide = await page.evaluate((w) => {
    const bad: { testid: string; width: number }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-testid]'))) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
      const box = el.getBoundingClientRect();
      if (box.width > w + 1) {
        bad.push({ testid: el.getAttribute('data-testid') ?? '?', width: Math.round(box.width) });
      }
    }
    return bad;
  }, VIEWPORT.width);

  expect(tooWide, `elements wider than the viewport:\n${JSON.stringify(tooWide, null, 2)}`).toEqual([]);
});
