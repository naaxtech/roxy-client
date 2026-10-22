/**
 * Feel: navigation and screen transitions (Wave 3 lane A; polish/motion-spec.md
 * §3.1 rows 4-6, budgets F3, F4, F5 (Create), F12).
 *
 * READ-ONLY against whatever backend the build points at (a local export uses
 * PRODUCTION keys): it signs in as the e2e seed account, switches tabs, opens
 * Settings and Notifications and goes back, opens and closes the Create sheet.
 * It never taps a Settings row, never posts, reacts, follows, joins or sends;
 * a request guard aborts any Supabase write that is not the sign-in itself.
 *
 * Run (one sign-in, reused through FEEL_STATE; serialised by lock-run.cjs):
 *   FEEL_VP=390x844 FEEL_OUT=<dir> FEEL_STATE=<dir>/state.json [FEEL_RM=1] [FEEL_SHOTS=1]
 *   PLAYWRIGHT_BASE_URL=http://localhost:8161 npx playwright test feel-transitions --workers=1
 *
 * Every frame (rAF) is sampled in the page: the screen-transition layers'
 * opacity/translate, each tab's fade layer, the nav pill's scaleX, the bar's
 * rect, the Create sheet's rect. Results go to <FEEL_OUT>/runs.jsonl; budgets
 * are soft assertions so one run reports every miss.
 */
import { test, expect, type Page, type CDPSession, type BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { signInWithSeedUser, dismissFirstRunSheets } from './helpers/auth';

const [VW, VH] = (process.env.FEEL_VP ?? '390x844').split('x').map(Number);
const OUT = process.env.FEEL_OUT ?? path.join(process.cwd(), 'feel-out');
const STATE = process.env.FEEL_STATE ?? path.join(OUT, 'state.json');
const CPU = Number(process.env.FEEL_CPU ?? 4);
const REDUCED = process.env.FEEL_RM === '1';
const SHOTS = process.env.FEEL_SHOTS === '1';
const RUN_ID = `${VW}x${VH}${REDUCED ? '-rm' : ''}-${Date.now()}`;

type Layer = { id: string; op: number; tx: number; ty: number; pe: string };
type Frame = {
  t: number;
  url: string;
  layers: Layer[];
  fades: { id: string; op: number }[];
  bar: number[] | null;
  pills: { id: string; sx: number }[];
  sheet: { top: number; op: number } | null;
};

/** Installed before the app loads: a per-frame sampler plus cold-start watchers. */
const SAMPLER = `(() => {
  const q = (sel) => Array.from(document.querySelectorAll(sel));
  const vis = (el) => (el.checkVisibility ? el.checkVisibility() : !!el.offsetParent);
  const mx = (el) => {
    const tr = getComputedStyle(el).transform;
    if (!tr || tr === 'none') return { a: 1, e: 0, f: 0 };
    const m = new DOMMatrixReadOnly(tr);
    return { a: m.a, e: m.e, f: m.f };
  };
  const f = (window.__feel = {
    frames: [], on: false, t0: 0, cold: { pendingAt: null, loadingAt: null, navAt: null },
    start() { this.frames = []; this.on = true; requestAnimationFrame(tick); },
    stop() { this.on = false; return this.frames; },
  });
  addEventListener('pointerdown', () => { f.t0 = performance.now(); }, true);
  function tick() {
    const layers = q('[data-testid="screen-transition"]').filter(vis).map((el) => {
      const m = mx(el); const cs = getComputedStyle(el);
      return { id: el.id, op: +cs.opacity, tx: m.e, ty: m.f, pe: cs.pointerEvents };
    });
    const fades = q('[data-testid^="tab-fade"][data-testid$="-content"]').filter(vis)
      .map((el) => ({ id: el.dataset.testid, op: +getComputedStyle(el).opacity }));
    const bar = document.querySelector('[data-testid="nav-bar"]');
    const r = bar && vis(bar) ? bar.getBoundingClientRect() : null;
    const pills = q('[data-testid^="nav-indicator-"]').map((el) => ({ id: el.dataset.testid, sx: mx(el).a }));
    const sh = document.querySelector('[data-testid="create-sheet"]');
    let sheet = null;
    if (sh && vis(sh)) {
      let op = 1; for (let n = sh; n && n !== document.body; n = n.parentElement) op *= +getComputedStyle(n).opacity;
      sheet = { top: sh.getBoundingClientRect().top, op };
    }
    f.frames.push({ t: performance.now(), url: location.pathname, layers, fades,
      bar: r ? [r.x, r.y, r.width, r.height] : null, pills, sheet });
    if (f.on) requestAnimationFrame(tick);
  }
  // Cold start (jank audit #6): the public "Membership pending" shell must
  // never paint for a member; the Feed's own skeleton may.
  const mo = new MutationObserver(() => {
    const c = f.cold;
    if (c.pendingAt === null && document.body && document.body.innerText.includes('Membership pending')) c.pendingAt = performance.now();
    if (c.loadingAt === null && document.querySelector('[data-testid="feed-access-loading"]')) c.loadingAt = performance.now();
    if (c.navAt === null && document.querySelector('[data-testid="nav-slot-feed"]')) c.navAt = performance.now();
    if (c.navAt !== null && performance.now() - c.navAt > 8000) mo.disconnect();
  });
  addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true }));
})();`;

/** Write-like RPC names (same rule as the feel harness). */
const WRITE_RPC = /^(mark|record|track|log|insert|update|upsert|set|touch|claim|award|grant|join|leave|follow|unfollow|react|unreact|like|unlike|send|create|delete|remove|accept|decline|rsvp|save|unsave|bump|increment|ping|heartbeat|answer|vote|report|block|unblock|mute|unmute|toggle|submit|add|redeem|consume|complete|dismiss|hide|register|request|start|end|close|open|archive|pin|unpin|invite|approve|reject|cancel|purchase|buy|tip|donate|checkin|check_in)(_|$)/i;

async function guardWrites(ctx: BrowserContext, blocked: string[]) {
  await ctx.route(/supabase\.co\//, (route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
    if (url.pathname.startsWith('/auth/v1/token')) return route.continue();
    const rpc = url.pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/);
    if (rpc && !WRITE_RPC.test(rpc[1])) return route.continue();
    blocked.push(`${method} ${url.pathname}`);
    return route.abort();
  });
}

async function throttle(cdp: CDPSession) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 165,
    downloadThroughput: (9 * 1024 * 1024 * 0.9) / 8,
    uploadThroughput: (1.5 * 1024 * 1024 * 0.9) / 8,
  });
}

async function sample(page: Page, act: () => Promise<void>, settleMs = 1400): Promise<{ t0: number; frames: Frame[] }> {
  await page.evaluate(() => (window as unknown as { __feel: { start(): void } }).__feel.start());
  await page.waitForTimeout(80);
  await act();
  await page.waitForTimeout(settleMs);
  return page.evaluate(() => {
    const f = (window as unknown as { __feel: { stop(): Frame[]; t0: number } }).__feel;
    return { frames: f.stop(), t0: f.t0 };
  });
}

/** Optional per-frame screenshots (CDP screencast) for the vision check; not used for timing. */
async function screencast(cdp: CDPSession, name: string, act: () => Promise<void>, ms = 900) {
  if (!SHOTS) return;
  const dir = path.join(OUT, 'frames', `${RUN_ID}-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const frames: { data: string; ts: number }[] = [];
  const onFrame = (p: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    frames.push({ data: p.data, ts: p.metadata.timestamp ?? 0 });
    void cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => undefined);
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  await act();
  await new Promise((r) => setTimeout(r, ms));
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', onFrame);
  frames.forEach((fr, i) => {
    const ms0 = Math.round((fr.ts - frames[0].ts) * 1000);
    fs.writeFileSync(path.join(dir, `${String(i).padStart(2, '0')}-${ms0}ms.jpg`), Buffer.from(fr.data, 'base64'));
  });
}

// ─── analysis ────────────────────────────────────────────────────────────────

function tabSwitch(slot: string, { t0, frames }: { t0: number; frames: Frame[] }) {
  const after = frames.filter((f) => f.t >= t0);
  const pillId = `nav-indicator-${slot}`;
  const fadeId = `tab-fade-${slot}-content`;
  const sel = after.find((f) => f.pills.some((p) => p.id === pillId));
  const vis = after.filter((f) => f.fades.some((x) => x.id === fadeId));
  const opOf = (f: Frame) => f.fades.find((x) => x.id === fadeId)?.op ?? NaN;
  const first = vis[0];
  const done = vis.find((f) => opOf(f) >= 0.99);
  const ramp = vis.filter((f) => opOf(f) > 0.01 && opOf(f) < 0.99).length;
  const sxOf = (f: Frame) => f.pills.find((p) => p.id === pillId)?.sx ?? NaN;
  let pillSettled: Frame | undefined;
  // Settled = within REST.px (0.5 px) of the 56 dp pill's final width.
  const pillRest = 0.5 / 56;
  for (let i = after.length - 1; i >= 0; i--) {
    const sx = sxOf(after[i]);
    if (!(Math.abs(sx - 1) <= pillRest)) break;
    pillSettled = after[i];
  }
  const pillMin = Math.min(...after.map(sxOf).filter((v) => !Number.isNaN(v)));
  const bars = frames.map((f) => f.bar).filter(Boolean) as number[][];
  const barShift = bars.length ? Math.max(...bars.map((b) => Math.max(...b.map((v, i) => Math.abs(v - bars[0][i]))))) : NaN;
  return {
    slot,
    selPaintMs: sel ? Math.round(sel.t - t0) : null,
    firstVisibleMs: first ? Math.round(first.t - t0) : null,
    firstOpacity: first ? Number(opOf(first).toFixed(3)) : null,
    fadeMs: first && done ? Math.round(done.t - first.t) : null,
    rampFrames: ramp,
    contentMs: done ? Math.round(done.t - t0) : null,
    pillSettleMs: pillSettled ? Math.round(pillSettled.t - t0) : null,
    pillMinScale: Number.isFinite(pillMin) ? Number(pillMin.toFixed(3)) : null,
    barShiftPx: Number.isFinite(barShift) ? Number(barShift.toFixed(2)) : null,
  };
}

const moved = (a: Layer, b: Layer) => Math.abs(a.op - b.op) > 0.005 || Math.abs(a.tx - b.tx) > 0.25 || Math.abs(a.ty - b.ty) > 0.25;

/** Time from the first frame that shows the move to the last frame anything moved. */
function settleOf(frames: Frame[], from: number) {
  let last = from;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t < from) continue;
    const prev = new Map(frames[i - 1].layers.map((l) => [l.id, l]));
    const changed = frames[i].layers.some((l) => !prev.has(l.id) || moved(prev.get(l.id)!, l))
      || frames[i - 1].layers.some((l) => !frames[i].layers.find((x) => x.id === l.id));
    if (changed) last = frames[i].t;
  }
  return last;
}

function push({ t0, frames }: { t0: number; frames: Frame[] }) {
  const before = frames.filter((f) => f.t < t0).pop() ?? frames[0];
  const pre = new Set(before.layers.map((l) => l.id));
  const after = frames.filter((f) => f.t >= t0);
  const firstNew = after.find((f) => f.layers.some((l) => !pre.has(l.id)));
  const newLayer = firstNew?.layers.find((l) => !pre.has(l.id));
  const end = settleOf(frames, firstNew ? firstNew.t : t0);
  const maxTx = Math.max(0, ...after.flatMap((f) => f.layers.map((l) => Math.abs(l.tx))));
  const maxTy = Math.max(0, ...after.flatMap((f) => f.layers.map((l) => Math.abs(l.ty))));
  const rampMs = (() => {
    const id = newLayer?.id;
    if (!id) return null;
    const seen = after.filter((f) => f.layers.some((l) => l.id === id));
    const full = seen.find((f) => (f.layers.find((l) => l.id === id)?.op ?? 0) >= 0.99);
    return full ? Math.round(full.t - seen[0].t) : null;
  })();
  return {
    tapToFirstMs: firstNew ? Math.round(firstNew.t - t0) : null,
    firstFrameShowsMove: newLayer ? newLayer.op < 0.99 || Math.abs(newLayer.tx) > 0.5 || Math.abs(newLayer.ty) > 0.5 : false,
    coveredVisibleInFirstFrame: firstNew ? firstNew.layers.some((l) => pre.has(l.id) && l.op > 0.99) : false,
    transitionMs: firstNew ? Math.round(end - firstNew.t) : null,
    tapToSettleMs: Math.round(end - t0),
    opacityRampMs: rampMs,
    maxTranslatePx: Number(Math.max(maxTx, maxTy).toFixed(1)),
  };
}

function pop({ t0, frames }: { t0: number; frames: Frame[] }, startAt = t0) {
  const before = frames.filter((f) => f.t < startAt).pop() ?? frames[0];
  const topId = before.layers[before.layers.length - 1]?.id;
  const after = frames.filter((f) => f.t >= startAt);
  const leaving = after.filter((f) => f.layers.some((l) => l.id === topId));
  const opAt = (f: Frame) => f.layers.find((l) => l.id === topId)?.op ?? 0;
  const startOp = before.layers.find((l) => l.id === topId)?.op ?? 1;
  const maxOpAfter = Math.max(0, ...leaving.map(opAt));
  const gone = after.find((f) => !f.layers.some((l) => l.id === topId));
  const last = after[after.length - 1];
  const leftovers = last ? last.layers.filter((l) => l.op > 0.01 && l.op < 0.99) : [];
  const revealed = last?.layers.filter((l) => l.id !== topId) ?? [];
  const firstMove = leaving.find((f) => opAt(f) < startOp - 0.01) ?? leaving[0];
  const maxTx = Math.max(0, ...after.flatMap((f) => f.layers.map((l) => Math.abs(l.tx))));
  return {
    exitAnimatedFrames: leaving.length,
    reversesFromCurrent: maxOpAfter <= startOp + 0.05,
    startOpacity: Number(startOp.toFixed(3)),
    transitionMs: firstMove && gone ? Math.round(gone.t - firstMove.t) : null,
    endLayers: last ? last.layers.map((l) => ({ id: l.id, op: Number(l.op.toFixed(3)), tx: Math.round(l.tx) })) : [],
    leftoverHalfFaded: leftovers.length,
    revealedSolid: revealed.length > 0 && revealed.every((l) => l.op >= 0.99 && Math.abs(l.tx) < 0.5),
    maxTranslatePx: Number(maxTx.toFixed(1)),
  };
}

function sheetOpen({ t0, frames }: { t0: number; frames: Frame[] }) {
  const after = frames.filter((f) => f.t >= t0 && f.sheet);
  if (!after.length) return { visibleMs: null };
  const finalTop = after[after.length - 1].sheet!.top;
  const startTop = after[0].sheet!.top;
  const travel = Math.max(1, startTop - finalTop);
  const at95 = after.find((f) => f.sheet!.top - finalTop <= travel * 0.05);
  let settled = after[after.length - 1];
  for (let i = after.length - 1; i > 0; i--) {
    if (Math.abs(after[i - 1].sheet!.top - finalTop) > 0.5) break;
    settled = after[i - 1];
  }
  const minOp = Math.min(...after.map((f) => f.sheet!.op));
  return {
    visibleMs: Math.round(after[0].t - t0),
    travelPx: Math.round(startTop - finalTop),
    p95Ms: at95 ? Math.round(at95.t - t0) : null,
    settledMs: Math.round(settled.t - t0),
    sheetMinOpacity: Number(minOp.toFixed(3)),
  };
}

// ─── the run ─────────────────────────────────────────────────────────────────

test('feel: navigation and screen transitions (read-only)', async ({ browser }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  const reuse = fs.existsSync(STATE);
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: REDUCED ? 'reduce' : 'no-preference',
    storageState: reuse ? STATE : undefined,
  });
  const blocked: string[] = [];
  await guardWrites(ctx, blocked);
  await ctx.addInitScript(SAMPLER);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);

  if (reuse) {
    await page.goto('/');
    await expect(page.getByTestId('nav-slot-feed')).toBeVisible({ timeout: 60_000 });
    await dismissFirstRunSheets(page);
  } else {
    await signInWithSeedUser(page);
    await ctx.storageState({ path: STATE });
  }
  const cold = await page.evaluate(() => (window as unknown as { __feel: { cold: unknown } }).__feel.cold);
  await throttle(cdp);
  await page.waitForTimeout(1500);

  const result: Record<string, unknown> = { run: RUN_ID, viewport: `${VW}x${VH}`, reducedMotion: REDUCED, cpu: CPU, cold, coldStartReusedSession: reuse };

  // F4 — tab switches: three first visits, then a warm round.
  const tabs: ReturnType<typeof tabSwitch>[] = [];
  for (const slot of ['discover', 'messages', 'you', 'feed', 'discover', 'messages', 'you', 'feed']) {
    const s = await sample(page, async () => {
      await page.getByTestId(`nav-slot-${slot}`).tap();
      await expect(page).toHaveURL(new RegExp(`/${slot}$`), { timeout: 20_000 });
    });
    tabs.push(tabSwitch(slot, s));
    await page.waitForTimeout(600);
  }
  result.tabs = tabs;

  // F3 — push / pop inside a tab stack (You → Settings), and a root push
  // (Discover → Notifications). Opening a screen is read-only; nothing in it
  // is tapped.
  await page.getByTestId('nav-slot-you').tap();
  await expect(page.getByTestId('you-row-settings')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const pushSettings = await sample(page, async () => {
    await page.getByTestId('you-row-settings').tap();
    await expect(page).toHaveURL(/\/settings$/, { timeout: 20_000 });
  });
  const popSettings = await sample(page, async () => {
    await page.evaluate(() => (window as unknown as { __feel: { t0: number } }).__feel.t0 = performance.now());
    await page.goBack();
    await expect(page).toHaveURL(/\/you$/, { timeout: 20_000 });
  });
  await page.waitForTimeout(800);
  // Back at ~100 ms into the push: the screen must turn around, nothing left half-faded.
  const interrupt = await sample(page, async () => {
    await page.getByTestId('you-row-settings').tap();
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      (window as unknown as { __feel: { backAt: number } }).__feel.backAt = performance.now();
      history.back();
    });
  }, 1600);
  const backAt = await page.evaluate(() => (window as unknown as { __feel: { backAt: number } }).__feel.backAt);
  await expect(page).toHaveURL(/\/you$/, { timeout: 20_000 });
  await page.waitForTimeout(800);

  await page.getByTestId('nav-slot-discover').tap();
  await expect(page.getByTestId('discover-notifications')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const pushNotif = await sample(page, async () => {
    await page.getByTestId('discover-notifications').tap();
    await expect(page).toHaveURL(/\/notifications$/, { timeout: 20_000 });
  });
  const popNotif = await sample(page, async () => {
    await page.evaluate(() => (window as unknown as { __feel: { t0: number } }).__feel.t0 = performance.now());
    await page.goBack();
    await expect(page).toHaveURL(/\/discover$/, { timeout: 20_000 });
  });
  result.push = {
    settings: push(pushSettings),
    settingsBack: pop(popSettings),
    interrupt: { push: push(interrupt), back: pop(interrupt, backAt), backAtMs: Math.round(backAt - interrupt.t0) },
    notifications: push(pushNotif),
    notificationsBack: pop(popNotif),
  };
  if (process.env.FEEL_DUMP === '1') {
    fs.writeFileSync(path.join(OUT, `frames-${RUN_ID}.json`), JSON.stringify({ pushSettings, popSettings, interrupt, pushNotif, popNotif }));
  }

  // F5 (Create): open, then close with its × (read-only: nothing is chosen).
  await page.waitForTimeout(800);
  const openCreate = await sample(page, async () => {
    await page.getByTestId('nav-slot-create').tap();
    await expect(page.getByTestId('create-sheet')).toBeVisible({ timeout: 15_000 });
  });
  await page.getByTestId('create-sheet').getByLabel('Close').tap();
  await expect(page.getByTestId('create-sheet')).toBeHidden({ timeout: 15_000 });
  result.create = { open: sheetOpen(openCreate) };

  // Frames for the vision check (separate pass: the screencast costs frames).
  if (SHOTS) {
    await page.getByTestId('nav-slot-you').tap();
    await expect(page.getByTestId('you-row-settings')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await screencast(cdp, 'push-settings', () => page.getByTestId('you-row-settings').tap());
    await screencast(cdp, 'pop-settings', () => page.goBack().then(() => undefined));
    await page.waitForTimeout(600);
    await screencast(cdp, 'tab-discover', () => page.getByTestId('nav-slot-discover').tap());
    await page.waitForTimeout(600);
    await screencast(cdp, 'tab-feed', () => page.getByTestId('nav-slot-feed').tap());
    await page.waitForTimeout(600);
    await screencast(cdp, 'create-open', () => page.getByTestId('nav-slot-create').tap());
    await page.getByTestId('create-sheet').getByLabel('Close').tap();
  }

  result.blockedWrites = blocked;
  fs.appendFileSync(path.join(OUT, 'runs.jsonl'), `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify(result, null, 1));
  await ctx.close();

  // ── budgets (soft: report every miss) ──
  const frameMs = 1000 / 60;
  // `blocked` lists the app's own background writes the guard aborted (daily
  // check-in, seen posts…): they never left the page. Recorded, not a budget.
  if (reuse) {
    expect.soft((cold as { pendingAt: number | null }).pendingAt, 'F6/#6: no "Membership pending" shell on a cold start').toBeNull();
  }
  for (const t of tabs) {
    expect.soft(t.barShiftPx, `F4 ${t.slot}: the bar never moves`).toBe(0);
    expect.soft(t.firstOpacity ?? 1, `F4 ${t.slot}: ground in the first frame (content not yet in)`).toBeLessThanOrEqual(REDUCED ? 1 : 0.5);
    if (REDUCED) {
      expect.soft(t.fadeMs ?? 0, `F12 ${t.slot}: opacity change <= 120 ms`).toBeLessThanOrEqual(120 + 2 * frameMs);
      expect.soft(t.pillMinScale ?? 1, `F12 ${t.slot}: the pill does not scale`).toBeGreaterThanOrEqual(0.999);
    } else {
      expect.soft(t.rampFrames, `F4 ${t.slot}: content fades over >= 2 frames`).toBeGreaterThanOrEqual(2);
      expect.soft(t.fadeMs ?? 999, `F4 ${t.slot}: content faded in <= 200 ms`).toBeLessThanOrEqual(200);
      expect.soft(t.pillSettleMs ?? 999, `F4 ${t.slot}: pill settles <= 250 ms`).toBeLessThanOrEqual(250);
    }
  }
  const pushes = result.push as Record<string, Record<string, unknown>>;
  for (const name of ['settings', 'notifications']) {
    const p = pushes[name];
    expect.soft(p.firstFrameShowsMove, `F3 ${name}: the first frame shows the transition`).toBe(true);
    expect.soft(p.coveredVisibleInFirstFrame, `F3 ${name}: the covered screen is still there (no blank)`).toBe(true);
    if (REDUCED) {
      expect.soft(p.maxTranslatePx, `F12 ${name}: nothing moves`).toBeLessThanOrEqual(0.5);
      expect.soft(p.opacityRampMs ?? 0, `F12 ${name}: fade <= 120 ms`).toBeLessThanOrEqual(120 + 2 * frameMs);
    } else {
      expect.soft(p.transitionMs as number, `F3 ${name}: settles in >= 200 ms`).toBeGreaterThanOrEqual(200 - frameMs);
      expect.soft(p.transitionMs as number, `F3 ${name}: settles in <= 400 ms`).toBeLessThanOrEqual(400);
    }
  }
  for (const name of ['settingsBack', 'notificationsBack']) {
    const p = pushes[name];
    expect.soft(p.leftoverHalfFaded, `F3 ${name}: nothing left half-faded`).toBe(0);
    expect.soft(p.revealedSolid, `F3 ${name}: the revealed screen is solid`).toBe(true);
    if (!REDUCED) expect.soft(p.exitAnimatedFrames as number, `F3 ${name}: the pop is not a jump cut`).toBeGreaterThanOrEqual(2);
  }
  const intr = pushes.interrupt as unknown as { back: ReturnType<typeof pop> };
  expect.soft(intr.back.reversesFromCurrent, 'F3 interrupt: turns around from where it is').toBe(true);
  expect.soft(intr.back.leftoverHalfFaded, 'F3 interrupt: nothing left half-faded').toBe(0);
  expect.soft(intr.back.revealedSolid, 'F3 interrupt: ends on the old screen, solid').toBe(true);
});
