import { test, expect } from '@playwright/test';

/**
 * Shoots the Studio sign-in page. A tool, not a gate — but it does assert the
 * one thing that was wrong: the page rendered a generic `Sparkles` icon while
 * the real wordmark sat unused in `public/brand/`.
 */
test.use({ viewport: { width: 1280, height: 900 } });

test('studio login wears the real mark', async ({ page }) => {
  await page.goto('http://localhost:3111/auth/login');
  const mark = page.getByAltText('Roxy');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('src', /roxy-wordmark/);

  // Rendered at a real size, not 11px of art lost in an 8000x4500 canvas.
  const box = await mark.boundingBox();
  expect(box!.height).toBeGreaterThan(28);
  expect(box!.width).toBeGreaterThan(90);

  // The stylesheet must actually load. A stale `next start` once served HTML
  // pointing at a CSS chunk the new build had replaced, and every assertion
  // here still passed over a completely unstyled page — the screenshot was the
  // only thing that noticed.
  const painted = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    return { bg, sheets: document.styleSheets.length };
  });
  expect(painted.sheets).toBeGreaterThan(0);
  // The brand surface is plum, never the browser default white.
  expect(painted.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(painted.bg).not.toBe('rgb(255, 255, 255)');

  await page.screenshot({ path: 'shots/studio-login.png' });
});
