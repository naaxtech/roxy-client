/**
 * Run `fn` after the browser (or the native UI) has painted the current frame.
 *
 * A tap that both shows feedback and starts heavy work (a tab switch renders a
 * whole screen) used to batch the two into one synchronous render, so the
 * feedback appeared only after the work (jank audit #3: 0.3-1 s of a frozen
 * old screen with no pressed state). Painting first, then working, is the
 * "answer the finger, not the network" rule (motion spec §1.3 rule 1).
 *
 * `requestAnimationFrame` fires before the next paint; the `setTimeout` inside
 * it lands after that paint. Returns a cancel function.
 */
export function afterPaint(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const raf = requestAnimationFrame(() => {
    timer = setTimeout(fn, 0);
  });
  return () => {
    cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
  };
}
