import { test } from '@playwright/test';
import { signInWithSeedUser, gotoTab } from './helpers/auth';

/**
 * Diagnostic, not a gate. Dumps every truncated text node on Discover so the
 * real ones can be seen rather than guessed at.
 *
 * The audit spec's clipped-text check has a hole this exists to expose:
 * react-native-web renders `numberOfLines={1}` as `text-overflow: ellipsis`
 * with `white-space: nowrap` (which DOES widen scrollWidth), but
 * `numberOfLines={2}` as `display: -webkit-box` with `-webkit-line-clamp: 2`
 * — and a line-clamped box wraps INSIDE its width, so scrollWidth equals
 * clientWidth and the horizontal check sees nothing. The clipping is vertical.
 *
 * So this measures three ways: horizontal overflow, vertical overflow, and the
 * true rendered width of the text via a Range, which is the only one that
 * catches an ellipsis honestly.
 */

test.use({ viewport: { width: 412, height: 915 } });

test('dump every truncated text node on Discover', async ({ page }) => {
  await signInWithSeedUser(page);
  await gotoTab(page, 'discover');
  await page.waitForTimeout(2500);

  const findings = await page.evaluate(() => {
    const out: Record<string, unknown>[] = [];

    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (el.children.length > 0) continue;
      // scrollHeight/scrollWidth are not meaningful on SVG content — an <text>
      // node reports a couple of pixels of overflow that is never visible.
      // Verified against a screenshot of the Top 10 rail: the numerals are
      // whole. Excluded so the real findings are not buried under eight of them.
      if (el.namespaceURI === 'http://www.w3.org/2000/svg') continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const cs = getComputedStyle(el);
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none'
        ? Number(cs.webkitLineClamp) : null;

      // The honest measure: how wide the text actually wants to be.
      const range = document.createRange();
      range.selectNodeContents(el);
      const textWidth = range.getBoundingClientRect().width;

      const horizontallyCut = el.scrollWidth > el.clientWidth + 1;
      const verticallyCut = el.scrollHeight > el.clientHeight + 1;
      // Single-line ellipsis: the text is wider than the box it sits in.
      const ellipsised = cs.textOverflow === 'ellipsis'
        && cs.whiteSpace === 'nowrap'
        && textWidth > rect.width + 1;

      if (horizontallyCut || verticallyCut || ellipsised) {
        out.push({
          text: text.slice(0, 70),
          box: Math.round(rect.width),
          textWants: Math.round(textWidth),
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          scrollH: el.scrollHeight,
          clientH: el.clientHeight,
          clamp,
          why: [
            horizontallyCut ? 'scrollWidth' : null,
            verticallyCut ? 'scrollHeight' : null,
            ellipsised ? 'ellipsis' : null,
          ].filter(Boolean).join('+'),
        });
      }
    }
    return out;
  });

  // eslint-disable-next-line no-console
  console.log('\n=== TRUNCATED ON DISCOVER ===\n' + JSON.stringify(findings, null, 2));
});

test('shoot the filter surfaces so they can be looked at', async ({ page }) => {
  await signInWithSeedUser(page);

  await gotoTab(page, 'discover');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'shots/discover-top.png' });

  await page.goto('/archive');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'shots/archive-top.png' });
});
