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
