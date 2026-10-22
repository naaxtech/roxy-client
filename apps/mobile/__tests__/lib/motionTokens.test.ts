/**
 * Wave 3 "Feel" token additions (polish/motion-spec.md §3.2) and the two
 * gesture helpers every drag in the app shares (§1.3 rule 3).
 */
import {
  CROSS_DISSOLVE_MS,
  ENTER,
  GESTURE,
  REDUCED,
  REST,
  SKELETON,
  SPRING,
  WAIT,
  projectRelease,
  rubberBand,
  springTo,
} from '../../lib/motion';

describe('§3.2 token additions', () => {
  it('Reduce Motion turns effects into 120 ms fades', () => {
    expect(REDUCED).toEqual({ fadeMs: 120 });
  });

  it('waits follow the M3 loading indicator: nothing < 200 ms, then >= 400 ms, determinate after 5 s', () => {
    expect(WAIT).toEqual({ showAfterMs: 200, minShowMs: 400, determinateAfterMs: 5000 });
  });

  it('skeletons pulse to 0.55 on one 700 ms half-cycle clock', () => {
    expect(SKELETON).toEqual({ low: 0.55, halfMs: 700 });
  });

  it('entrances: push 32 dp, modal rise 48 dp, message rise 8 dp', () => {
    expect(ENTER).toEqual({ pushDp: 32, modalRiseDp: 48, messageRiseDp: 8 });
  });

  it('gesture constants: WWDC18 projection, rubber band, sheet dismiss, long-press, refresh threshold', () => {
    expect(GESTURE).toEqual({
      decelerationRate: 0.998,
      rubberBand: 0.55,
      dismissFraction: 0.35,
      flingDpPerS: 800,
      longPressMs: 300,
      refreshThresholdDp: 72,
    });
  });

  it('rest thresholds and the image cross-dissolve', () => {
    expect(REST).toEqual({ unit: 0.001, px: 0.5 });
    expect(CROSS_DISSOLVE_MS).toBe(150);
  });

  it('keeps SPRING exactly as it was (seven tokens)', () => {
    expect(Object.keys(SPRING)).toHaveLength(7);
    expect(SPRING.spatial).toEqual({ mass: 1, stiffness: 380, damping: 31.2 });
  });
});

describe('projectRelease (WWDC18: x + v/1000 · r/(1 − r))', () => {
  it('projects where a flick would come to rest', () => {
    // r/(1 − r) = 499 at r = 0.998, so 1000 px/s travels another 499 px.
    expect(projectRelease(100, 1000)).toBeCloseTo(100 + 499, 6);
    expect(projectRelease(100, -1000)).toBeCloseTo(100 - 499, 6);
  });

  it('a release with no velocity lands where the finger lifted', () => {
    expect(projectRelease(42, 0)).toBe(42);
  });
});

describe('rubberBand ((1 − 1/(x·c/d + 1))·d)', () => {
  it('is 0 at 0 and follows the finger closely at first', () => {
    expect(rubberBand(0, 300)).toBe(0);
    const small = rubberBand(10, 300);
    expect(small).toBeGreaterThan(5);
    expect(small).toBeLessThan(10);
  });

  it('resists more the further it goes and never passes the dimension', () => {
    expect(rubberBand(600, 300)).toBeLessThan(300);
    expect(rubberBand(600, 300) - rubberBand(300, 300)).toBeLessThan(rubberBand(300, 300));
    expect(rubberBand(1e9, 300)).toBeLessThanOrEqual(300);
  });

  it('keeps the sign of the overshoot', () => {
    expect(rubberBand(-50, 300)).toBeCloseTo(-rubberBand(50, 300), 9);
  });
});

describe('springTo (reanimated config for a token)', () => {
  it('carries the token physics and the pixel rest threshold for pixel values', () => {
    expect(springTo('spatial', { px: true, velocity: 900 })).toEqual({
      ...SPRING.spatial,
      velocity: 900,
      restDisplacementThreshold: REST.px,
      restSpeedThreshold: REST.px,
      reduceMotion: 'never',
    });
  });

  it('owns Reduce Motion itself (reanimated reads the OS setting only at launch)', () => {
    expect(springTo('fastSpatial').reduceMotion).toBe('never');
    expect(springTo('fastSpatial')).not.toHaveProperty('restDisplacementThreshold');
    expect(springTo('fastSpatial')).not.toHaveProperty('dampingRatio');
  });
});
