/**
 * SPRING tokens as web animations (jank audit #7; motion spec §3.2).
 *
 * On the web reanimated runs on the main thread and clamps its frame step, so
 * when a tab switch or a push makes frames long (the destination rendering at
 * 4x CPU) a 170 ms fade stretched to 300-480 ms. A Web Animations API (WAAPI)
 * animation of opacity or transform runs on the compositor and keeps its
 * timing; giving it the token's own curve as a CSS `linear()` easing keeps the
 * web's motion identical to the app's springs.
 */

export type SpringToken = { mass: number; stiffness: number; damping: number };

/** Progress 0 → 1 of a spring released from rest at 0 towards 1, after `t` seconds. */
export function springProgress({ mass, stiffness, damping }: SpringToken, t: number): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (Math.abs(zeta - 1) < 1e-4) {
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s);
  const r2 = -w0 * (zeta + s);
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/** Milliseconds until the spring stays within `epsilon` of its target. */
export function springSettleMs(token: SpringToken, epsilon = 0.001): number {
  let last = 0;
  for (let ms = 0; ms <= 3000; ms++) {
    if (Math.abs(1 - springProgress(token, ms / 1000)) > epsilon) last = ms;
  }
  return last + 1;
}

const easingCache = new Map<string, { easing: string; durationMs: number }>();

/** The token's curve as a CSS `linear()` easing, over its settle time (0.1%). */
export function springEasing(token: SpringToken, samples = 48): { easing: string; durationMs: number } {
  const key = `${token.mass}/${token.stiffness}/${token.damping}/${samples}`;
  const hit = easingCache.get(key);
  if (hit) return hit;
  const durationMs = springSettleMs(token, 0.001);
  const values: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = i === 0 ? 0 : i === samples ? 1 : springProgress(token, (durationMs * i) / samples / 1000);
    values.push(String(Number(p.toFixed(4))));
  }
  const out = { easing: `linear(${values.join(', ')})`, durationMs };
  easingCache.set(key, out);
  return out;
}

type Animatable = {
  animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation;
  getAnimations?: () => { cancel: () => void }[];
};

/**
 * Start `keyframes` on a DOM element with a SPRING token's curve, replacing
 * whatever it was animating. Returns null where WAAPI is missing (native, old
 * browsers): the element simply shows its end state.
 */
export function startWebSpring(
  el: Animatable | null | undefined,
  keyframes: Keyframe[],
  token: SpringToken,
): Animation | null {
  if (!el || typeof el.animate !== 'function') return null;
  el.getAnimations?.().forEach((a) => a.cancel());
  const { easing, durationMs } = springEasing(token);
  return el.animate(keyframes, { duration: durationMs, easing });
}
