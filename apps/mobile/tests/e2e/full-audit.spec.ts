import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { signInWithSeedUser, gotoTab, TAB_SLOTS } from './helpers/auth';
import { attachDiagnostics, filterBenignErrors, type UiDiagnostics } from './helpers/diagnostics';

/**
 * Full-app audit. One test per surface; each records page errors, console
 * errors and failed Supabase calls, plus a screenshot, then appends a line to
 * test-results/audit-report.txt so a per-tab report can be read off afterward.
 */

const shots = 'shots/audit';
mkdirSync(shots, { recursive: true });

function reportLine(name: string, diag: UiDiagnostics, extra: { bodyLen: number }) {
  const errors = filterBenignErrors(diag.pageErrors);
  const consoleErrs = filterBenignErrors(diag.consoleErrors);
  const failed = diag.failedRequests;
  const flags: string[] = [];
  if (errors.length) flags.push(`${errors.length} page-errors`);
  if (consoleErrs.length) flags.push(`${consoleErrs.length} console-errors`);
  if (failed.length) flags.push(`${failed.length} failed-api`);
  if (extra.bodyLen < 20) flags.push('NEARLY-BLANK');
  const summary = flags.length ? `WARN ${flags.join(', ')}` : 'CLEAN';
  const lines = [`${name}: ${summary} (body ${extra.bodyLen} chars)`];
  if (errors.length) lines.push(`  page: ${JSON.stringify(errors.slice(0, 5))}`);
  if (consoleErrs.length) lines.push(`  console: ${JSON.stringify(consoleErrs.slice(0, 5))}`);
  if (failed.length) lines.push(`  api: ${JSON.stringify(failed.slice(0, 8))}`);
  writeFileSync('test-results/audit-report.txt', lines.join('\n') + '\n', { flag: 'a' });
}

async function settle(page: Page) {
  await page.waitForTimeout(1800);
}

async function capture(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
  return await page.evaluate(() => ({
    bodyLen: (document.body.innerText ?? '').trim().length,
    text: (document.body.innerText ?? '').trim().slice(0, 400),
  }));
}

test.beforeEach(async ({ page }) => {
  await signInWithSeedUser(page);
});

for (const slot of TAB_SLOTS) {
  test(`tab:${slot} renders`, async ({ page }) => {
    const diag = attachDiagnostics(page);
    await gotoTab(page, slot);
    const info = await capture(page, `tab-${slot}`);
    reportLine(`tab:${slot}`, diag, info);
    expect(filterBenignErrors(diag.pageErrors)).toEqual([]);
  });
}

test('create sheet opens', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await page.getByTestId('nav-slot-create').click();
  await settle(page);
  await page.screenshot({ path: `${shots}/create-sheet.png` });
  reportLine('create-sheet', diag, { bodyLen: 0 });
  await page.keyboard.press('Escape').catch(() => {});
});

test('archive screen renders', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await page.goto('/archive');
  await settle(page);
  const info = await capture(page, 'archive');
  reportLine('archive', diag, info);
});

test('community channels render', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await page.goto('/community/channels/4305a24a-8317-4e22-9277-8ac97baa2e53');
  await settle(page);
  const info = await capture(page, 'channels');
  reportLine('channels', diag, info);
});

test('roxy chat renders', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await page.goto('/roxy-chat');
  await settle(page);
  const info = await capture(page, 'roxy-chat');
  reportLine('roxy-chat', diag, info);
});

test('search screen renders', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await page.goto('/search');
  await settle(page);
  const info = await capture(page, 'search');
  reportLine('search', diag, info);
});

test('notifications screen renders', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await page.goto('/notifications');
  await settle(page);
  const info = await capture(page, 'notifications');
  reportLine('notifications', diag, info);
});

test('messages inbox sections present', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await gotoTab(page, 'messages');
  const info = await capture(page, 'messages');
  const hasDirect = await page.getByTestId('inbox-section-direct').isVisible().catch(() => false);
  const hasCommunity = await page.getByTestId('inbox-section-community').isVisible().catch(() => false);
  writeFileSync('test-results/audit-report.txt', `messages-sections: direct=${hasDirect} community=${hasCommunity}\n`, { flag: 'a' });
  reportLine('messages-inbox', diag, info);
});

test('create sheet content measured', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await page.getByTestId('nav-slot-create').click();
  await settle(page);
  const info = await page.evaluate(() => ({ len: (document.body.innerText ?? '').trim().length, text: (document.body.innerText ?? '').trim().slice(0, 300) }));
  writeFileSync('test-results/audit-report.txt', `create-sheet-measured: len=${info.len} text=${JSON.stringify(info.text)}\n`, { flag: 'a' });
  reportLine('create-sheet-measured', diag, { bodyLen: info.len });
  expect(filterBenignErrors(diag.pageErrors)).toEqual([]);
});
