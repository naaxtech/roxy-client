import type { DailyCall, DailyCallFactory, DailyCallStaticUtils } from '@daily-co/daily-js';

/**
 * daily-js supports exactly ONE call object per page and its factory THROWS
 * `Duplicate DailyIframe instances are not allowed` when a second is created
 * while the first is still alive.
 *
 * In a Next.js client component that constraint is easy to violate without
 * noticing, because nothing about it is per-component:
 *   - React 18 StrictMode double-invokes effects in development, so the mount
 *     that creates the call object runs twice back to back;
 *   - `destroy()` is asynchronous, so a route change to another room starts the
 *     next join before the previous teardown has settled;
 *   - a component that unmounted mid-teardown leaves the instance registered
 *     with the module, and then EVERY later join fails until a full page reload.
 *
 * The barrier therefore has to be module-scoped — a ref or a per-component
 * promise is invisible to the next mount, which is the one that fails.
 *
 * src: https://docs.daily.co/reference/daily-js/factory-methods/create-call-object · daily-js 0.89.1 · 2026-08-02
 * src: https://docs.daily.co/reference/daily-js/static-methods/get-call-instance · daily-js 0.89.1 · 2026-08-02
 */
let pendingTeardown: Promise<void> = Promise.resolve();

type DailyModule = DailyCallFactory & DailyCallStaticUtils;

/**
 * Release whatever call object is still registered with daily-js, whoever
 * created it, then wait for any teardown already in flight.
 */
async function releaseLiveCall(Daily: DailyModule): Promise<void> {
  await pendingTeardown.catch(() => {});

  const existing = Daily.getCallInstance();
  if (!existing) return;
  if (existing.isDestroyed()) return;
  await existing.destroy().catch(() => {});
}

/**
 * Load daily-js and hand back a call object that is guaranteed to be the only
 * live one. The import stays dynamic because daily-js touches browser globals
 * at module scope and must never be pulled into a server render.
 */
export async function acquireCallObject(): Promise<DailyCall> {
  const mod = await import('@daily-co/daily-js');
  // Interop: the bundled CJS build exposes the factory as `.default`, the ESM
  // build as the namespace itself. Neither shape is guaranteed across bundlers.
  const Daily = ((mod as { default?: DailyModule }).default ?? mod) as DailyModule;

  await releaseLiveCall(Daily);
  return Daily.createCallObject();
}

/**
 * Fire-and-forget by contract — this is called from effect cleanup, where a
 * rejected promise has nobody to catch it. The teardown is still sequenced
 * (leave settles before destroy) and recorded in `pendingTeardown`, so the next
 * acquireCallObject() waits for it instead of racing it.
 */
export function releaseCallObject(call: DailyCall | null): void {
  if (!call) return;

  pendingTeardown = (async () => {
    try {
      if (call.isDestroyed()) return;
      await call.leave().catch(() => {});
      await call.destroy();
    } catch {
      // Swallowed deliberately: an unmount has no error surface. If the
      // instance survived, releaseLiveCall() reclaims it on the next acquire.
    }
  })();
}
