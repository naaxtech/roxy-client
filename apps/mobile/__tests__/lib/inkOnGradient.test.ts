import {
  BRAND_GRADIENT, LIVE_GRADIENT, BRAND_INK, BRAND_INK_INVERSE,
  contrastRatio, inkOn, inkOnGradient, worstContrast,
} from '../../lib/theme';

/**
 * Why `inkOn()` is not enough for a gradient.
 *
 * `inkOn(fill)` answers for ONE colour. A label on a three-stop ramp sits on all
 * of them, and the stop it is measured against decides whether the answer is
 * true. Picking the middle stop is the trap that shipped: `inkOn('#F22481')`
 * returns `#1A0A2E` at 4.74:1 and looks safe, while the same ink measures
 * 4.23:1 against `#E0189A` at the end of the ramp — the trailing glyphs of a
 * centred label land there and fail SC 1.4.3.
 *
 * Neither brand ink clears 4.5:1 across the whole brand ramp, so the answer is
 * not a choice between the two — it is a darker ink, luminance-only, hue and
 * saturation held, which is the same departure `theme.ts` already documents for
 * three of its tokens.
 */
describe('worstContrast', () => {
  it('reports the weakest stop, not the average or the first', () => {
    expect(worstContrast(BRAND_INK, BRAND_GRADIENT)).toBeCloseTo(4.23, 2);
    expect(worstContrast(BRAND_INK_INVERSE, BRAND_GRADIENT)).toBeCloseTo(3.11, 2);
  });

  it('agrees with contrastRatio for a single-stop "gradient"', () => {
    expect(worstContrast(BRAND_INK, ['#F22481'])).toBeCloseTo(
      contrastRatio(BRAND_INK, '#F22481'), 5
    );
  });
});

describe('inkOnGradient', () => {
  it('clears 4.5:1 on EVERY stop of the brand ramp', () => {
    const ink = inkOnGradient(BRAND_GRADIENT);
    for (const stop of BRAND_GRADIENT) {
      const r = contrastRatio(ink, stop);
      expect({ stop, r: Number(r.toFixed(2)) }).toEqual({ stop, r: expect.any(Number) });
      expect(r).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('clears 4.5:1 on every stop of the live ramp too', () => {
    const ink = inkOnGradient(LIVE_GRADIENT);
    for (const stop of LIVE_GRADIENT) {
      expect(contrastRatio(ink, stop)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('does not settle for the middle stop the way inkOn would', () => {
    // The regression guard, stated as the comparison rather than as a constant:
    // if someone reverts to `inkOn(BRAND_GRADIENT[1])` this is what changes.
    const naive = inkOn(BRAND_GRADIENT[1]);
    expect(worstContrast(naive, BRAND_GRADIENT)).toBeLessThan(4.5);
    expect(worstContrast(inkOnGradient(BRAND_GRADIENT), BRAND_GRADIENT)).toBeGreaterThanOrEqual(4.5);
  });

  it('honours a 3:1 threshold for a non-text mark', () => {
    // SC 1.4.11. An icon on the ramp needs 3:1, not 4.5:1, and a caller that
    // says so must not be handed ink darker than its design needs.
    const ink = inkOnGradient(BRAND_GRADIENT, 3);
    expect(worstContrast(ink, BRAND_GRADIENT)).toBeGreaterThanOrEqual(3);
  });

  it('returns the best available ink rather than throwing when nothing clears', () => {
    // A ramp of mid-greys where no ink can reach the bar. Returning the least
    // bad answer keeps a label rendered and lets the contrast suite fail loudly;
    // throwing would blank a screen at runtime over a design problem.
    const impossible = ['#767676', '#808080'] as const;
    const ink = inkOnGradient(impossible);
    expect(typeof ink).toBe('string');
    expect(worstContrast(ink, impossible)).toBeGreaterThan(1);
  });
});
