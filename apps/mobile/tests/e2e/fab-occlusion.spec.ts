import { test, expect } from '@playwright/test';
import { signInWithSeedUser, gotoTab, TAB_SLOTS } from './helpers/auth';

/**
 * The Roxy FAB floats over every tab. When a scroll container ends without
 * enough bottom padding, the last row of content parks permanently underneath
 * it — on `you`, the FAB covered the Ghost mode toggle's label and switch with
 * the page scrolled all the way down, so there was no scroll position that
 * revealed it.
 *
 * A FAB overlapping content MID-scroll is normal and expected. The defect is
 * an element the viewer can never uncover, so this scrolls to the BOTTOM first
 * and only then asks what is underneath.
 */

test.use({ viewport: { width: 412, height: 915 } });

for (const slot of TAB_SLOTS) {
  test(`nothing is stranded under the FAB on ${slot}`, async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, slot);
    await page.waitForTimeout(2500);

    const fab = page.getByTestId('fab-button');
    if (!(await fab.count())) test.skip(true, 'no FAB on this tab');

    // Bottom of every scroller: this is the only position where "covered"
    // means "unreachable" rather than "scroll a bit further".
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
      });
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(700);

    const stranded = await page.evaluate(() => {
      const fabEl = document.querySelector('[data-testid="fab-button"]');
      if (!fabEl) return [];
      const f = fabEl.getBoundingClientRect();
      const out: { text: string; role: string | null; testid: string | null }[] = [];

      // Sample the FAB's own footprint. Anything interactive found beneath it
      // there is a control the viewer cannot reach.
      for (const [dx, dy] of [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5], [0.5, 0.2], [0.5, 0.8]]) {
        const x = f.left + f.width * dx;
        const y = f.top + f.height * dy;
        for (const el of document.elementsFromPoint(x, y)) {
          if (fabEl.contains(el) || el.contains(fabEl)) continue;
          const role = el.getAttribute('role');
          const interactive = role === 'button' || role === 'switch' || role === 'link'
            || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'A';
          if (!interactive) continue;
          const text = (el.textContent ?? '').trim().slice(0, 50);
          out.push({ text, role, testid: el.getAttribute('data-testid') });
          break;
        }
      }
      return out;
    });

    expect(stranded, `covered by the FAB at the bottom of ${slot}: ${JSON.stringify(stranded)}`)
      .toEqual([]);
  });
}

/**
 * v2 (design direction › The Roxy AI button): she owns an 88 × 88 lane at the
 * bottom end corner, and lists end `FAB_LANE` higher. The check above samples
 * only the button's own 56 dp footprint; the lane promise is wider: at the end
 * of the list, nothing readable OR tappable sits anywhere in the 88 × 88 —
 * text counts, not just controls. Read-only: it only scrolls.
 */
for (const slot of ['discover', 'you'] as const) {
  test(`Roxy's 88 dp lane is clear at the end of ${slot}`, async ({ page }) => {
    await signInWithSeedUser(page);
    await gotoTab(page, slot);
    await page.waitForTimeout(2500);

    const lane = page.getByTestId('fab-lane');
    if (!(await lane.count())) test.skip(true, 'Roxy AI is off or this tier has no companion');

    await page.evaluate(() => {
      document.querySelectorAll('*').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
      });
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(900);

    const inLane = await page.evaluate(() => {
      const laneEl = document.querySelector('[data-testid="fab-lane"]');
      if (!laneEl) return [];
      const r = laneEl.getBoundingClientRect();
      const out: { text: string; role: string | null; testid: string | null }[] = [];
      const seen = new Set<Element>();
      // A 5 × 5 grid across the whole lane, inset 2 dp from its edges.
      for (let i = 0; i < 5; i += 1) {
        for (let j = 0; j < 5; j += 1) {
          const x = r.left + 2 + ((r.width - 4) * i) / 4;
          const y = r.top + 2 + ((r.height - 4) * j) / 4;
          for (const el of document.elementsFromPoint(x, y)) {
            if (laneEl.contains(el) || el.contains(laneEl)) continue;
            const role = el.getAttribute('role');
            const interactive = role === 'button' || role === 'switch' || role === 'link'
              || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'A';
            const ownText = Array.from(el.childNodes)
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => (n.textContent ?? '').trim())
              .join('');
            if ((interactive || ownText) && !seen.has(el)) {
              seen.add(el);
              out.push({ text: (el.textContent ?? '').trim().slice(0, 50), role, testid: el.getAttribute('data-testid') });
            }
            break; // only the topmost content element under each point counts
          }
        }
      }
      return out;
    });

    expect(inLane, `readable or tappable inside Roxy's lane at the end of ${slot}: ${JSON.stringify(inLane)}`)
      .toEqual([]);
  });
}

/**
 * The tuck (M3 extended-FAB behaviour, made Roxy's): scrolling Discover down
 * tucks her to the screen edge; back at the top she returns. Read-only.
 */
test('Roxy tucks while Discover scrolls down and returns at the top', async ({ page }) => {
  await signInWithSeedUser(page);
  await gotoTab(page, 'discover');
  await page.waitForTimeout(2500);
  if (!(await page.getByTestId('fab-lane').count())) test.skip(true, 'Roxy AI is off');

  const scrollRoot = async (to: 'down' | 'top') => page.evaluate((dir) => {
    const scrollers = Array.from(document.querySelectorAll('*')).filter((el) => {
      const style = getComputedStyle(el);
      return el.scrollHeight > el.clientHeight + 200 && /(auto|scroll)/.test(style.overflowY);
    });
    const root = scrollers.sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (!root) return false;
    if (dir === 'top') root.scrollTop = 0;
    else root.scrollTop += 240;
    root.dispatchEvent(new Event('scroll'));
    return true;
  }, to);

  expect(await scrollRoot('down')).toBe(true);
  await page.waitForTimeout(250);
  await scrollRoot('down');
  await expect(page.getByTestId('fab-tucked')).toBeVisible({ timeout: 5_000 });

  await scrollRoot('top');
  await expect(page.getByTestId('fab-tucked')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId('fab-button')).toBeVisible();
});
