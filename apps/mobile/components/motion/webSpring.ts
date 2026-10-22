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

type RunningAnimation = {
  cancel: () => void;
  /** A KeyframeEffect in browsers (others have no keyframes to read). */
  effect?: unknown;
};
type Animatable = {
  animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation;
  getAnimations?: () => RunningAnimation[];
};

const NOT_PROPERTIES = new Set(['offset', 'easing', 'composite', 'computedOffset']);
const propertiesOf = (frames: Record<string, unknown>[]) =>
  new Set(frames.flatMap((f) => Object.keys(f).filter((k) => !NOT_PROPERTIES.has(k))));

/** Cancel what the element runs on the same properties (unknown effects too). */
function replaceRunning(el: Animatable, keyframes: Keyframe[]) {
  const mine = propertiesOf(keyframes as Record<string, unknown>[]);
  el.getAnimations?.().forEach((a) => {
    const effect = a.effect as { getKeyframes?: () => Record<string, unknown>[] } | null | undefined;
    const theirs = effect?.getKeyframes ? propertiesOf(effect.getKeyframes()) : null;
    if (!theirs || [...theirs].some((p) => mine.has(p))) a.cancel();
  });
}

/**
 * Start `keyframes` on a DOM element with a SPRING token's curve, replacing
 * whatever it was animating on the same properties (a slide and its fade run
 * side by side). Returns null where WAAPI is missing (native, old browsers):
 * the element simply shows its end state.
 */
export function startWebSpring(
  el: Animatable | null | undefined,
  keyframes: Keyframe[],
  token: SpringToken,
): Animation | null {
  if (!el || typeof el.animate !== 'function') return null;
  replaceRunning(el, keyframes);
  const { easing, durationMs } = springEasing(token);
  return el.animate(keyframes, { duration: durationMs, easing });
}

/** Reduce Motion's plain timed opacity change (motion spec §3.4: fades only). */
export function startWebFade(
  el: Animatable | null | undefined,
  from: number,
  to: number,
  durationMs: number,
): Animation | null {
  if (!el || typeof el.animate !== 'function') return null;
  const keyframes = [{ opacity: from }, { opacity: to }];
  replaceRunning(el, keyframes);
  return el.animate(keyframes, { duration: durationMs, easing: 'ease-in-out' });
}

/**
 * What the browser shows for the element while it is mid-animation, so a move
 * can turn around from where it is. Null at rest and off the DOM: at rest the
 * computed style is the rest style React has just committed for the NEW phase
 * (a closing screen already reads 32 dp out at opacity 0), not what is on
 * screen — reading it turned every pop from rest into a jump cut (feel run
 * 6b32c0f). The caller then starts from the previous phase's end.
 */
export function currentWebStyle(el: unknown): { opacity: string; transform: string } | null {
  const node = el as { nodeType?: number; getAnimations?: () => { playState: string }[] } | null;
  const g = globalThis as unknown as { getComputedStyle?: (e: unknown) => { opacity: string; transform: string } };
  if (!node || node.nodeType !== 1 || typeof g.getComputedStyle !== 'function') return null;
  if (typeof node.getAnimations === 'function' && !node.getAnimations().some((a) => a.playState === 'running')) {
    return null;
  }
  const cs = g.getComputedStyle(node);
  return { opacity: cs.opacity, transform: cs.transform };
}
