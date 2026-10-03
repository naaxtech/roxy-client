// Exploratory dogfood crawl for Roxy Studio (not part of the Playwright suite).
// Usage: node tests/e2e/dogfood-crawl.mjs  (needs BASE, E2E_TEST_EMAIL, E2E_TEST_PASSWORD env)
// Writes screenshots + findings.json to shots/dogfood-<date>/.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const OUT = process.env.OUT ?? 'shots/dogfood-2026-10-01';
const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;
if (!email || !password) throw new Error('E2E_TEST_EMAIL / E2E_TEST_PASSWORD required');
fs.mkdirSync(OUT, { recursive: true });

const MEMBER_ROUTES = [
  '/dashboard', '/community', '/community/members', '/invites', '/applications', '/events',
  '/rooms', '/games', '/games/submissions', '/games/submit', '/stripe-onboarding', '/products',
  '/orders', '/seller-payouts', '/payouts', '/settings',
];
const STAFF_ROUTES = [
  '/staff', '/staff/launch', '/staff/team', '/staff/member-tags', '/staff/archive',
  '/staff/archive/entries', '/staff/archive/entries/new', '/staff/archive/members',
  '/staff/archive/revisions', '/staff/archive/reports', '/staff/businesses', '/staff/products',
  '/staff/games', '/staff/feature-requests', '/staff/feedback', '/staff/email-queue',
  '/staff/reconciliation', '/staff/disputes',
];

const findings = [];
const browser = await chromium.launch();

async function visit(ctx, route, width, tag) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failed = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes('posthog') && !u.includes('vercel')) failed.push(`${r.status()} ${u.slice(0, 160)}`);
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.includes('posthog') && !u.includes('_vercel')) failed.push(`FAILED ${r.failure()?.errorText} ${u.slice(0, 160)}`);
  });
  let status = null;
  try {
    const resp = await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45_000 });
    status = resp?.status() ?? null;
  } catch (e) {
    pageErrors.push('NAV: ' + String(e).slice(0, 200));
  }
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => ({
    title: document.title,
    h1: [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim()).slice(0, 3),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    notFound: /could not be found|404/i.test(document.body.innerText.slice(0, 2000)),
    errorBoundary: /something went wrong/i.test(document.body.innerText.slice(0, 3000)),
    bodySnippet: document.body.innerText.replace(/\s+/g, ' ').slice(0, 220),
  }));
  const file = path.join(OUT, `${tag}-${width}${route.replace(/\//g, '_') || '_root'}.png`);
  await page.screenshot({ path: file, fullPage: false });
  findings.push({ tag, route, width, status, finalUrl: page.url().replace(BASE, ''), ...info, consoleErrors, pageErrors, failed, shot: file });
  await page.close();
}

// 1) Unauthenticated
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  for (const r of ['/dashboard', '/staff', '/staff/feedback', '/settings']) await visit(ctx, r, 1280, 'anon');
  await ctx.close();
}

// 2) Signed-in member
for (const width of [1280, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/auth/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 20_000 }).catch(() => {});
  findings.push({ tag: 'login', width, landed: page.url().replace(BASE, '') });
  await page.close();
  for (const r of MEMBER_ROUTES) await visit(ctx, r, width, 'member');
  if (width === 1280) for (const r of STAFF_ROUTES) await visit(ctx, r, width, 'staffprobe');
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
console.log('wrote', findings.length, 'records');
