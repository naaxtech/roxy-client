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
/** A WAAPI animation the app started: compositor start, ms to come within REST of its end. */
type Waapi = { tid: string; elId: string; at: number; start: number | null; state: string; reach: number; dur: number; kf: string };
type Sample = { t0: number; frames: Frame[]; waapi?: Waapi[] };
type Frame = {
  t: number;
  url: string;
  layers: Layer[];
  fades: { id: string; op: number; as: number | null; an: number }[];
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
    frames: [], on: false, t0: 0, tapAt: null, cold: { pendingAt: null, loadingAt: null, navAt: null },
    // history.back() this many ms after a NEW screen layer first shows (in-page
    // timing: a Playwright wait under 4x CPU lands far too late).
    backArm: null, backAt: null, backLayerOp: null,
    start() { this.frames = []; this.on = true; requestAnimationFrame(tick); },
    stop() { this.on = false; return this.frames; },
    armBack(ms) {
      this.backAt = null; this.backLayerOp = null;
      this.backArm = { ms, seen: new Set(q('[data-testid="screen-transition"]').map((el) => el.id)) };
    },
  });
  addEventListener('pointerdown', () => { f.t0 = performance.now(); f.tapAt = performance.timeOrigin + f.t0; }, true);
  // Every WAAPI animation the app starts (web motion runs on the compositor).
  // A rAF read of computed style only sees the main thread's view, which
  // stalls while a destination renders; the compositor carries on. So for
  // these the harness also reports what the compositor showed: the
  // animation's resolved start time plus the time its own keyframes and
  // easing need to come within REST of the end (replayed on a hidden probe).
  const waapi = [];
  const animate0 = Element.prototype.animate;
  Element.prototype.animate = function (kf, opts) {
    const a = animate0.call(this, kf, opts);
    const host = this.closest ? this.closest('[data-testid]') : null;
    waapi.push({ tid: (host && host.getAttribute('data-testid')) || '', elId: this.id || '', kf, opts, a, at: performance.now() });
    return a;
  };
  const probeReach = (kf, opts) => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:56px;height:32px;';
    document.body.appendChild(probe);
    const dur = typeof opts === 'number' ? opts : (opts && opts.duration) || 0;
    const p = probe.animate(kf, { duration: dur, easing: (opts && opts.easing) || 'linear', fill: 'both' });
    p.pause();
    const read = () => { const cs = getComputedStyle(probe); const m = mx(probe); return { op: +cs.opacity, sx: m.a, tx: m.e, ty: m.f }; };
    p.currentTime = dur; const end = read();
    let reach = 0;
    for (let t = Math.ceil(dur); t >= 0; t--) {
      p.currentTime = t; const v = read();
      if (Math.abs(v.op - end.op) > 0.01 || Math.abs(v.sx - end.sx) > 0.5 / 56 || Math.abs(v.tx - end.tx) > 0.5 || Math.abs(v.ty - end.ty) > 0.5) { reach = t + 1; break; }
    }
    p.cancel(); probe.remove();
    return { reach, dur };
  };
  f.waapiSince = (t0) => waapi.filter((w) => w.at >= t0).map((w) => {
    const { reach, dur } = probeReach(w.kf, w.opts);
    return { tid: w.tid, elId: w.elId, at: w.at, start: w.a.startTime, state: w.a.playState, reach, dur,
      kf: JSON.stringify(w.kf).slice(0, 120) };
  });
  function tick() {
    const layers = q('[data-testid="screen-transition"]').filter(vis).map((el) => {
      const m = mx(el); const cs = getComputedStyle(el);
      return { id: el.id, op: +cs.opacity, tx: m.e, ty: m.f, pe: cs.pointerEvents };
    });
    if (f.backArm) {
      const fresh = layers.find((l) => !f.backArm.seen.has(l.id));
      if (fresh) {
        const { ms } = f.backArm; f.backArm = null;
        setTimeout(() => {
          const el = document.getElementById(fresh.id);
          f.backLayerOp = el ? +getComputedStyle(el).opacity : null;
          f.backAt = performance.now();
          history.back();
        }, ms);
      }
    }
    const fades = q('[data-testid^="tab-fade"][data-testid$="-content"]').filter(vis)
      .map((el) => {
        const anims = el.getAnimations ? el.getAnimations() : [];
        const st = anims.map((a) => a.startTime).filter((v) => v !== null);
        return { id: el.dataset.testid, op: +getComputedStyle(el).opacity, as: st.length ? Math.min(...st) : null, an: anims.length };
      });
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

async function sample(page: Page, act: () => Promise<void>, settleMs = 1400): Promise<Sample> {
  await page.evaluate(() => (window as unknown as { __feel: { start(): void } }).__feel.start());
  await page.waitForTimeout(80);
  await act();
  await page.waitForTimeout(settleMs);
  return page.evaluate(() => {
    const f = (window as unknown as { __feel: { stop(): Frame[]; t0: number; waapiSince(t0: number): Waapi[] } }).__feel;
    const frames = f.stop();
    return { frames, t0: f.t0, waapi: f.waapiSince(frames.length ? frames[0].t : 0) };
  });
}

/**
 * Optional per-frame screenshots (CDP screencast) for the vision check. The
 * screencast shows what the compositor drew, so it also times compositor
 * (WAAPI) animations that rAF sampling cannot see while the main thread is
 * busy. Files are named by ms since the action started (wall clock).
 */
async function screencast(page: Page, cdp: CDPSession, name: string, act: () => Promise<void>, ms = 1500) {
  if (!SHOTS) return;
  await page.evaluate(() => { (window as unknown as { __feel: { tapAt: number | null } }).__feel.tapAt = null; });
  const dir = path.join(OUT, 'frames', `${RUN_ID}-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const frames: { data: string; ts: number }[] = [];
  const onFrame = (p: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    frames.push({ data: p.data, ts: p.metadata.timestamp ?? 0 });
    void cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => undefined);
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, 300));
  const tAct = Date.now() / 1000;
  await act();
  await new Promise((r) => setTimeout(r, ms));
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', onFrame);
  // Name frames by ms since the tap as the page saw it (pointerdown, or the
  // in-page history.back()); the wall clock before the act is the fallback.
  const tapAt = await page.evaluate(() => (window as unknown as { __feel: { tapAt: number | null } }).__feel.tapAt);
  frames.forEach((fr, i) => {
    const rel = Math.round(tapAt ? fr.ts * 1000 - tapAt : (fr.ts - tAct) * 1000);
    fs.writeFileSync(path.join(dir, `${String(i).padStart(3, '0')}-${rel}ms.jpg`), Buffer.from(fr.data, 'base64'));
  });
}

// ─── analysis ────────────────────────────────────────────────────────────────

/** The last animation started on an element (by testID or element id) at or after t0. */
const waapiOn = (list: Waapi[] | undefined, t0: number, match: (w: Waapi) => boolean) =>
  (list ?? []).filter((w) => w.at >= t0 - 1 && match(w) && w.start !== null && w.state !== 'idle').pop();

function tabSwitch(slot: string, { t0, frames, waapi }: Sample) {
  const after = frames.filter((f) => f.t >= t0);
  const pillId = `nav-indicator-${slot}`;
  const fadeId = `tab-fade-${slot}-content`;
  const sel = after.find((f) => f.pills.some((p) => p.id === pillId));
  const vis = after.filter((f) => f.fades.some((x) => x.id === fadeId));
  const opOf = (f: Frame) => f.fades.find((x) => x.id === fadeId)?.op ?? NaN;
  const first = vis[0];
  const done = vis.find((f) => opOf(f) >= 0.99);
  const ramp = vis.filter((f) => opOf(f) > 0.01 && opOf(f) < 0.99).length;
  // The fade's own WAAPI start (web): when the compositor began the ramp.
  const animStart = vis.map((f) => f.fades.find((x) => x.id === fadeId)?.as).find((v) => v !== null && v !== undefined);
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
  // What the compositor showed (web): the fade and the pill grow are WAAPI.
  const fadeAnim = waapiOn(waapi, t0, (w) => w.tid === fadeId);
  const pillAnim = waapiOn(waapi, t0, (w) => w.tid === pillId);
  const fadeShown = fadeAnim ? Math.min(fadeAnim.start!, first ? first.t : fadeAnim.start!) : null;
  return {
    slot,
    fadeCompositorMs: fadeAnim ? Math.round(fadeAnim.start! + fadeAnim.reach - fadeShown!) : null,
    fadeCompositorFrames: fadeAnim ? Math.floor(fadeAnim.reach / (1000 / 60)) : null,
    pillCompositorMs: pillAnim ? Math.round(pillAnim.start! + pillAnim.reach - t0) : null,
    selPaintMs: sel ? Math.round(sel.t - t0) : null,
    firstVisibleMs: first ? Math.round(first.t - t0) : null,
    firstOpacity: first ? Number(opOf(first).toFixed(3)) : null,
    fadeMs: first && done ? Math.round(done.t - first.t) : null,
    fadeAnimStartMs: animStart != null ? Math.round(animStart - t0) : null,
    groundOnlyMs: animStart != null && first ? Math.max(0, Math.round(animStart - first.t)) : null,
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

function pop({ t0, frames, waapi }: Sample, startAt = t0) {
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
  // Frames that show the leaving screen mid-move (not at rest, not gone).
  const midMove = leaving.filter((f) => {
    const l = f.layers.find((x) => x.id === topId)!;
    return (l.op > 0.02 && l.op < 0.98) || (Math.abs(l.tx) > 0.5 && Math.abs(l.tx) < 31.5) || (Math.abs(l.ty) > 0.5 && Math.abs(l.ty) < 47.5);
  });
  // The exit as the compositor ran it (web: WAAPI on the leaving layer —
  // transform on calm and opacity on effects; the longer one ends the move).
  const exits = (waapi ?? []).filter((w) => w.at >= startAt - 1 && w.elId === topId && w.start !== null && w.state !== 'idle');
  return {
    exitCompositorMs: exits.length ? Math.round(Math.max(...exits.map((w) => w.reach))) : null,
    exitCompositorState: exits.length ? (exits.every((w) => w.state === 'finished') ? 'finished' : exits[0].state) : null,
    exitAnimatedFrames: midMove.length,
    leavingFrames: leaving.length,
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
  // Only frames where the sheet is on screen: RN-web's Modal keeps its first
  // (still off-screen) frame at opacity 0 while it mounts.
  const onScreen = after.filter((f) => f.sheet!.top < VH - 2);
  const minOp = onScreen.length ? Math.min(...onScreen.map((f) => f.sheet!.op)) : 1;
  const from = after[0].t;
  const opaque = onScreen.find((f) => f.sheet!.op >= 0.99);
  return {
    opacityRampMs: opaque && onScreen.length ? Math.round(opaque.t - onScreen[0].t) : null,
    visibleMs: Math.round(from - t0),
    travelPx: Math.round(startTop - finalTop),
    p95Ms: at95 ? Math.round(at95.t - from) : null,
    settledMs: Math.round(settled.t - from),
    sheetMinOpacity: Number(minOp.toFixed(3)),
  };
}

/** A scrim tap mid-open: the sheet turns around (no frame jumps > 1/3 of its height) and leaves. */
function sheetInterrupt({ frames }: { t0: number; frames: Frame[] }, sheetH: number) {
  const seen = frames.filter((f) => f.sheet);
  let maxJump = 0;
  for (let i = 1; i < seen.length; i++) maxJump = Math.max(maxJump, Math.abs(seen[i].sheet!.top - seen[i - 1].sheet!.top));
  const tops = seen.map((f) => f.sheet!.top);
  const minTop = tops.length ? Math.min(...tops) : null;
  const last = frames[frames.length - 1];
  return {
    framesSeen: seen.length,
    maxJumpPx: Math.round(maxJump),
    maxJumpFraction: sheetH > 0 ? Number((maxJump / sheetH).toFixed(3)) : null,
    turnedAroundAtTop: minTop !== null ? Math.round(minTop) : null,
    gone: !last.sheet,
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
  const tabSamples: { slot: string; t0: number; frames: Frame[] }[] = [];
  for (const slot of ['discover', 'messages', 'you', 'feed', 'discover', 'messages', 'you', 'feed']) {
    const s = await sample(page, async () => {
      await page.getByTestId(`nav-slot-${slot}`).tap();
      await expect(page).toHaveURL(new RegExp(`/${slot}$`), { timeout: 20_000 });
    });
    tabs.push(tabSwitch(slot, s));
    tabSamples.push({ slot, ...s });
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
  // Back 100 ms into the push (timed in the page from the new layer's first
  // frame): the screen must turn around, nothing left half-faded.
  await page.evaluate(() => (window as unknown as { __feel: { armBack(ms: number): void } }).__feel.armBack(100));
  const interrupt = await sample(page, async () => {
    await page.getByTestId('you-row-settings').tap();
  }, 1800);
  const { backAt, backLayerOp } = await page.evaluate(() => {
    const f = (window as unknown as { __feel: { backAt: number; backLayerOp: number | null } }).__feel;
    return { backAt: f.backAt, backLayerOp: f.backLayerOp };
  });
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
    interrupt: {
      push: push(interrupt), back: pop(interrupt, backAt),
      backAtMs: Math.round(backAt - interrupt.t0), backLayerOp: backLayerOp === null ? null : Number(backLayerOp.toFixed(3)),
    },
    notifications: push(pushNotif),
    notificationsBack: pop(popNotif),
  };
  if (process.env.FEEL_DUMP === '1') {
    fs.writeFileSync(path.join(OUT, `frames-${RUN_ID}.json`), JSON.stringify({ pushSettings, popSettings, interrupt, pushNotif, popNotif, tabSamples }));
  }

  // F5 (Create): open, then close with its × (read-only: nothing is chosen).
  await page.waitForTimeout(800);
  const openCreate = await sample(page, async () => {
    await page.getByTestId('nav-slot-create').tap();
    await expect(page.getByTestId('create-sheet')).toBeVisible({ timeout: 15_000 });
  });
  await page.getByTestId('create-sheet').getByLabel('Close').tap();
  await expect(page.getByTestId('create-sheet')).toBeHidden({ timeout: 15_000 });
  const open = sheetOpen(openCreate);
  const sheetFrames = openCreate.frames.filter((f) => f.sheet);
  const sheetH = sheetFrames.length ? VH - sheetFrames[sheetFrames.length - 1].sheet!.top : 0;
  // A scrim tap mid-open: it turns around from where it is.
  await page.waitForTimeout(800);
  const interruptCreate = await sample(page, async () => {
    await page.getByTestId('nav-slot-create').tap();
    await page.waitForTimeout(40);
    await page.touchscreen.tap(Math.round(VW / 2), 40);
  }, 1200);
  await expect(page.getByTestId('create-sheet')).toBeHidden({ timeout: 15_000 });
  result.create = { open, sheetH: Math.round(sheetH), scrimMidOpen: sheetInterrupt(interruptCreate, sheetH) };

  // Frames for the vision check (separate pass: the screencast costs frames).
  if (SHOTS) {
    const tab = (slot: string) => async () => {
      await page.getByTestId(`nav-slot-${slot}`).tap();
      await expect(page).toHaveURL(new RegExp(`/${slot}$`), { timeout: 20_000 });
    };
    await page.getByTestId('nav-slot-feed').tap();
    await expect(page).toHaveURL(/\/feed$/, { timeout: 20_000 });
    await page.waitForTimeout(1200);
    await screencast(page, cdp, 'tab-feed-to-discover', tab('discover'));
    await screencast(page, cdp, 'tab-discover-to-feed', tab('feed'));
    await screencast(page, cdp, 'tab-feed-to-messages', tab('messages'));
    await screencast(page, cdp, 'tab-messages-to-you', tab('you'));
    await expect(page.getByTestId('you-row-settings')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await screencast(page, cdp, 'push-settings', async () => {
      await page.getByTestId('you-row-settings').tap();
      await expect(page).toHaveURL(/\/settings$/, { timeout: 20_000 });
    });
    await screencast(page, cdp, 'pop-settings', async () => {
      await page.evaluate(() => {
        (window as unknown as { __feel: { tapAt: number } }).__feel.tapAt = performance.timeOrigin + performance.now();
        history.back();
      });
      await expect(page).toHaveURL(/\/you$/, { timeout: 20_000 });
    });
    await page.waitForTimeout(600);
    await screencast(page, cdp, 'tab-you-to-discover', tab('discover'));
    await expect(page.getByTestId('discover-notifications')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await screencast(page, cdp, 'push-notifications', async () => {
      await page.getByTestId('discover-notifications').tap();
      await expect(page).toHaveURL(/\/notifications$/, { timeout: 20_000 });
    });
    await screencast(page, cdp, 'pop-notifications', async () => {
      await page.evaluate(() => {
        (window as unknown as { __feel: { tapAt: number } }).__feel.tapAt = performance.timeOrigin + performance.now();
        history.back();
      });
      await expect(page).toHaveURL(/\/discover$/, { timeout: 20_000 });
    });
    await page.waitForTimeout(600);
    await screencast(page, cdp, 'create-open', async () => {
      await page.getByTestId('nav-slot-create').tap();
      await expect(page.getByTestId('create-sheet')).toBeVisible({ timeout: 15_000 });
    }, 900);
    await screencast(page, cdp, 'create-close', async () => {
      await page.getByTestId('create-sheet').getByLabel('Close').tap();
    }, 900);
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
      // Web motion is WAAPI on the compositor: judge what it showed, and fall
      // back to the rAF view where nothing was handed to the compositor.
      expect.soft(t.fadeCompositorFrames ?? t.rampFrames, `F4 ${t.slot}: content fades over >= 2 frames`).toBeGreaterThanOrEqual(2);
      expect.soft(t.fadeCompositorMs ?? t.fadeMs ?? 999, `F4 ${t.slot}: content faded in <= 200 ms`).toBeLessThanOrEqual(200);
      expect.soft(t.pillCompositorMs ?? t.pillSettleMs ?? 999, `F4 ${t.slot}: pill settles <= 250 ms`).toBeLessThanOrEqual(250);
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
    const exitFrames = p.exitCompositorState === 'finished' && typeof p.exitCompositorMs === 'number'
      ? Math.floor(p.exitCompositorMs / frameMs)
      : (p.exitAnimatedFrames as number);
    if (!REDUCED) expect.soft(exitFrames, `F3 ${name}: the pop is not a jump cut`).toBeGreaterThanOrEqual(2);
  }
  const intr = pushes.interrupt as unknown as { back: ReturnType<typeof pop>; backLayerOp: number | null };
  if (!REDUCED) expect.soft(intr.backLayerOp ?? 1, 'F3 interrupt: back pressed while the push was still moving').toBeLessThan(0.95);
  expect.soft(intr.back.reversesFromCurrent, 'F3 interrupt: turns around from where it is').toBe(true);
  expect.soft(intr.back.leftoverHalfFaded, 'F3 interrupt: nothing left half-faded').toBe(0);
  expect.soft(intr.back.revealedSolid, 'F3 interrupt: ends on the old screen, solid').toBe(true);

  const create = result.create as { open: ReturnType<typeof sheetOpen>; scrimMidOpen: ReturnType<typeof sheetInterrupt> };
  if (REDUCED) {
    // Reduce Motion: fades only (§3.4) — the sheet may fade, briefly.
    expect.soft(create.open.opacityRampMs ?? 0, 'F12 Create: the sheet\'s fade <= 120 ms').toBeLessThanOrEqual(120 + 2 * frameMs);
    expect.soft(create.open.settledMs ?? 999, 'F12 Create: the sheet is simply there (no travel)').toBeLessThanOrEqual(2 * frameMs);
  } else {
    expect.soft(create.open.sheetMinOpacity ?? 0, 'F5 Create: the surface is never translucent').toBeGreaterThanOrEqual(0.99);
    expect.soft(create.open.p95Ms ?? 999, 'F5 Create: 95% of the travel <= 250 ms').toBeLessThanOrEqual(250);
    expect.soft(create.open.settledMs ?? 999, 'F5 Create: settled <= 450 ms').toBeLessThanOrEqual(450);
    expect.soft(create.scrimMidOpen.maxJumpFraction ?? 1, 'F5 Create: scrim tap mid-open, no frame jumps > 1/3 of the sheet').toBeLessThanOrEqual(1 / 3);
  }
  expect.soft(create.scrimMidOpen.gone, 'F5 Create: the scrim tap closes it').toBe(true);
});
