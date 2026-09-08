import { easeOutCubic, PAGE_GLIDE_MS } from '../../lib/feedPagerWeb';

/**
 * The web feed used to change pages with `scroller.scrollTop = offset` — an
 * instant teleport. The post changed without the screen ever appearing to move,
 * which is both unsatisfying and genuinely confusing: nothing tells you whether
 * you went up or down.
 */

describe('easeOutCubic', () => {
  it('starts at the start and ends at the end', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('is fast off the mark and settles gently — that is the whole feel', () => {
    // Past the halfway point by the time a quarter of the duration has gone.
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.5);
    // And barely moving at the end, so it lands rather than stops.
    expect(easeOutCubic(1) - easeOutCubic(0.9)).toBeLessThan(0.05);
  });

  it('never overshoots, so a page cannot glide past its own top', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('clamps a progress value outside 0..1 rather than extrapolating', () => {
    // A dropped frame can hand this a value past 1.
    expect(easeOutCubic(1.4)).toBe(1);
    expect(easeOutCubic(-0.3)).toBe(0);
  });

  it('rises monotonically — a page must never appear to go backwards', () => {
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe('PAGE_GLIDE_MS', () => {
  it('finishes inside the gesture lock, so no two glides overlap', () => {
    // createFeedPagerWebController locks for 420ms after a page change. An
    // animation longer than that could still be running when the next swipe
    // starts one, and two glides on one element fight to a stop between posts.
    expect(PAGE_GLIDE_MS).toBeLessThan(420);
    // And long enough to read as movement rather than as a jump.
    expect(PAGE_GLIDE_MS).toBeGreaterThan(150);
  });
});
