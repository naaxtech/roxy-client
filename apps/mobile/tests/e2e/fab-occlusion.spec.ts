import { test, expect, type Page } from '@playwright/test';
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
 *
 * Wave 3 (lane C; proposed by lane C, owner applies): every check runs at the
 * small phones the Wave 2 sheet failed on (360x800, 390x844) as well as
 * 412x915, and the tuck test now states the lane rule ("at rest nothing
 * readable or tappable sits under her"): she rests tucked while content
 * fills her lane (the top of Discover / You / Settings) and comes out at the
 * end of the list, where the lane is empty.
 */

const VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
];

type Hit = { text: string; role: string | null; testid: string | null; x: number; y: number };

/**
 * Every scroller to its end (the only place "covered" means "unreachable"),
 * again until late-loading rails stop growing the page (prod data lands in
 * pieces; "the end" is where a member who scrolled down comes to rest).
 */
async function scrollAllToEnd(page: Page) {
  let last = -1;
  for (let i = 0; i < 4; i += 1) {
    const total = await page.evaluate(() => {
      let sum = 0;
      document.querySelectorAll('*').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 4) {
          el.scrollTop = el.scrollHeight;
          el.dispatchEvent(new Event('scroll'));
          sum += el.scrollHeight;
        }
      });
      window.scrollTo(0, document.body.scrollHeight);
      return sum;
    });
    if (total === last) break;
    last = total;
    await page.waitForTimeout(700);
  }
}

/** The screen's main list to its top, 40% down or its end, then rest 900 ms. */
async function scrollRootTo(page: Page, where: 'top' | 'mid' | 'end') {
  if (where === 'end') {
    // Let late content land first: re-scroll until the list stops growing.
    let last = -1;
    for (let i = 0; i < 4; i += 1) {
      const h = await page.evaluate(() => {
        const scrollers = Array.from(document.querySelectorAll('*')).filter((el) => {
          const st = getComputedStyle(el);
          return el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(st.overflowY)
            && el.getBoundingClientRect().height > 200;
        });
        const root = scrollers.sort((a, b) => b.clientHeight - a.clientHeight)[0];
        if (!root) return 0;
        root.scrollTop = root.scrollHeight;
        root.dispatchEvent(new Event('scroll'));
        return root.scrollHeight;
      });
      if (h === last) break;
      last = h;
      await page.waitForTimeout(700);
    }
  }
  await page.evaluate((w) => {
    const scrollers = Array.from(document.querySelectorAll('*')).filter((el) => {
      const st = getComputedStyle(el);
      return el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(st.overflowY)
        && el.getBoundingClientRect().height > 200;
    });
    const root = scrollers.sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (!root) return;
    const max = root.scrollHeight - root.clientHeight;
    root.scrollTop = w === 'top' ? 0 : w === 'mid' ? Math.round(max * 0.4) : max;
    root.dispatchEvent(new Event('scroll'));
  }, where);
  await page.waitForTimeout(900);
}

/**
 * Readable or tappable elements under a 5 x 5 grid in `rect` (Roxy's own lane
 * ignored). A point that lands only on the padding of a full-width row (no
 * text, icon, image or painted child of the row under it) is marked `pad:`:
 * the row's label, icons and buttons are its content; the 16 dp screen margin
 * beside them is not.
 */
async function contentUnder(page: Page, rect: { x: number; y: number; width: number; height: number }) {
  return page.evaluate((r) => {
    const laneEl = document.querySelector('[data-testid="fab-lane"]');
    const out: Hit[] = [];
    const seen = new Set<Element>();
    const n = 5;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const x = r.x + 1 + ((r.width - 2) * i) / (n - 1);
        const y = r.y + 1 + ((r.height - 2) * j) / (n - 1);
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        for (const el of document.elementsFromPoint(x, y)) {
          if (laneEl && (laneEl.contains(el) || el.contains(laneEl))) continue;
          const role = el.getAttribute('role');
          const interactive = role === 'button' || role === 'switch' || role === 'link' || role === 'tab'
            || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'A';
          const ownText = Array.from(el.childNodes)
            .filter((c) => c.nodeType === Node.TEXT_NODE)
            .map((c) => (c.textContent ?? '').trim())
            .join('');
          if ((interactive || ownText) && !seen.has(el)) {
            seen.add(el);
            const box = el.getBoundingClientRect();
            // Invisible is not content: PressableScale keeps its state layer
            // mounted at opacity 0 (v3), so skip anything not actually painted.
            const shown = (d: Element) => {
              for (let a: Element | null = d; a && a !== el.parentElement; a = a.parentElement) {
                if (parseFloat(getComputedStyle(a).opacity) < 0.01) return false;
              }
              return d.getAttribute('data-testid') !== 'press-state-layer';
            };
            const contentAtPoint = !interactive || Array.from(el.querySelectorAll('*')).some((d) => {
              const b = d.getBoundingClientRect();
              if (x < b.left || x > b.right || y < b.top || y > b.bottom) return false;
              if (!shown(d)) return false;
              const cs = getComputedStyle(d);
              const hasText = Array.from(d.childNodes)
                .some((c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim());
              const painted = cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
                || (cs.borderStyle !== 'none' && parseFloat(cs.borderWidth) > 0);
              return hasText || painted || d.tagName === 'svg' || d.tagName === 'IMG';
            });
            const rowPadding = interactive && !contentAtPoint && box.width >= innerWidth * 0.8;
            out.push({
              text: `${rowPadding ? 'pad:' : ''}${(el.textContent ?? '').trim().slice(0, 40)}`,
              role,
              testid: el.getAttribute('data-testid'),
              x: Math.round(x),
              y: Math.round(y),
            });
          }
          break; // only the topmost content element under each point counts
        }
      }
    }
    return out;
  }, rect);
}
const real = (h: Hit[]) => h.filter((x) => !x.text.startsWith('pad:'));

async function restCheck(page: Page, label: string) {
  const tucked = (await page.getByTestId('fab-tucked').count()) > 0;
  const reachable = tucked
    ? await page.getByTestId('fab-tucked').isVisible()
    : await page.getByTestId('fab-button').isVisible();
  const lane = await page.getByTestId('fab-lane').boundingBox();
  const disc = await page.getByTestId('fab-tuck').boundingBox();
  const vw = page.viewportSize()!.width;
  let under: Hit[] = [];
  let hitArea: Hit[] = [];
  if (!tucked && lane) under = await contentUnder(page, lane);
  if (tucked && disc) {
    const x = Math.max(disc.x, 0);
    const right = Math.min(disc.x + disc.width, vw);
    under = await contentUnder(page, { x, y: disc.y, width: right - x, height: disc.height });
    const hit = await page.getByTestId('fab-tucked').boundingBox();
    if (hit) hitArea = await contentUnder(page, hit);
  }
  if (process.env.FAB_SHOTS) await page.screenshot({ path: `${process.env.FAB_SHOTS}/${label}.png` });
  return { label, tucked, reachable, under, hitArea };
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    for (const slot of TAB_SLOTS) {
      test(`nothing is stranded under the FAB on ${slot} (${vp.width}x${vp.height})`, async ({ page }) => {
        await signInWithSeedUser(page);
        await gotoTab(page, slot);
        await page.waitForTimeout(2500);

        const fab = page.getByTestId('fab-button');
        if (!(await fab.count()) && !(await page.getByTestId('fab-tucked').count())) {
          test.skip(true, 'no FAB on this tab');
        }

        await scrollAllToEnd(page);
        await page.waitForTimeout(900);

        const stranded = await page.evaluate(() => {
          const fabEl = document.querySelector('[data-testid="fab-button"]');
          if (!fabEl) return [];
          const f = fabEl.getBoundingClientRect();
          const out: { text: string; role: string | null; testid: string | null }[] = [];
          for (const [dx, dy] of [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5], [0.5, 0.2], [0.5, 0.8]]) {
            const x = f.left + f.width * dx;
            const y = f.top + f.height * dy;
            for (const el of document.elementsFromPoint(x, y)) {
              if (fabEl.contains(el) || el.contains(fabEl)) continue;
              const role = el.getAttribute('role');
              const interactive = role === 'button' || role === 'switch' || role === 'link'
                || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'A';
              if (!interactive) continue;
              out.push({ text: (el.textContent ?? '').trim().slice(0, 50), role, testid: el.getAttribute('data-testid') });
              break;
            }
          }
          return out;
        });

        expect(stranded, `covered by the FAB at the bottom of ${slot}: ${JSON.stringify(stranded)}`).toEqual([]);
      });
    }

    for (const slot of ['discover', 'you'] as const) {
      test(`Roxy's 88 dp lane is clear at the end of ${slot} (${vp.width}x${vp.height})`, async ({ page }) => {
        await signInWithSeedUser(page);
        await gotoTab(page, slot);
        await page.waitForTimeout(2500);
        if (!(await page.getByTestId('fab-lane').count())) test.skip(true, 'Roxy AI is off or this tier has no companion');

        await scrollAllToEnd(page);
        await page.waitForTimeout(900);
        // At the end the lane is empty, so she is out (the lane rule).
        await expect(page.getByTestId('fab-button')).toBeVisible();
        const lane = (await page.getByTestId('fab-lane').boundingBox())!;
        const inLane = real(await contentUnder(page, lane));
        expect(inLane, `readable or tappable inside Roxy's lane at the end of ${slot}: ${JSON.stringify(inLane)}`)
          .toEqual([]);
      });
    }

    /**
     * The lane rule at rest (design direction v2 › The Roxy AI button): at the
     * top, 40% down and the end of Discover, You and Settings, after 900 ms
     * without a scroll, she is reachable and nothing readable or tappable is
     * under her: out, the whole 88 x 88 lane is empty; tucked, the part of her
     * O on screen and her tucked target cover nothing (both live in the 16 dp
     * margin). She is tucked at the top of Discover and out at each end.
     * Read-only: it scrolls and opens Settings from You.
     */
    test(`Roxy never rests on a control (${vp.width}x${vp.height})`, async ({ page }) => {
      test.setTimeout(240_000);
      await signInWithSeedUser(page);
      const results: Awaited<ReturnType<typeof restCheck>>[] = [];

      await page.waitForTimeout(2500);
      if (await page.getByTestId('fab-lane').count()) results.push(await restCheck(page, `${vp.width}-feed-top`));

      await gotoTab(page, 'discover');
      await page.waitForTimeout(3500);
      if (!(await page.getByTestId('fab-lane').count())) test.skip(true, 'Roxy AI is off');
      for (const at of ['top', 'mid', 'end'] as const) {
        await scrollRootTo(page, at);
        results.push(await restCheck(page, `${vp.width}-discover-${at}`));
      }

      await gotoTab(page, 'you');
      await page.waitForTimeout(3000);
      for (const at of ['top', 'mid', 'end'] as const) {
        await scrollRootTo(page, at);
        results.push(await restCheck(page, `${vp.width}-you-${at}`));
      }

      await scrollRootTo(page, 'top');
      const settingsRow = page.getByTestId('you-row-settings');
      await settingsRow.scrollIntoViewIfNeeded();
      await settingsRow.click();
      await page.waitForTimeout(2500);
      for (const at of ['top', 'mid', 'end'] as const) {
        await scrollRootTo(page, at);
        results.push(await restCheck(page, `${vp.width}-settings-${at}`));
      }

      console.log(`FAB-REST ${vp.width}x${vp.height} ${JSON.stringify(results)}`);
      const unreachable = results.filter((r) => !r.reachable).map((r) => r.label);
      const covered = results.filter((r) => real(r.under).length > 0 || real(r.hitArea).length > 0)
        .map((r) => ({ at: r.label, tucked: r.tucked, under: real(r.under), hitArea: real(r.hitArea) }));
      expect(unreachable, 'Roxy must stay reachable at rest').toEqual([]);
      expect(covered, 'nothing readable or tappable under Roxy at rest').toEqual([]);
      const at = (l: string) => results.find((r) => r.label === `${vp.width}-${l}`);
      expect(at('discover-top')?.tucked, 'content fills her lane at the top of Discover: tucked').toBe(true);
      expect(at('discover-end')?.tucked, 'her lane is empty at the end of Discover: out').toBe(false);
      expect(at('you-end')?.tucked).toBe(false);
      expect(at('settings-end')?.tucked).toBe(false);
    });
  });
}
