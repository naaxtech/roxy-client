/**
 * Web springs (jank audit #7; motion spec §3.2 "on web… the M3 curve
 * stand-ins" — here the exact curves): reanimated runs on the web's main
 * thread, and its frame step is clamped, so a tab's fade or the nav pill
 * stretched to 300-480 ms whenever the destination's render made frames long
 * (measured at 4x CPU). A WAAPI animation with the SPRING token's own curve as
 * a CSS `linear()` easing runs on the compositor and keeps its timing.
 */
import { SPRING } from '../../../lib/motion';
import {
  springProgress, springSettleMs, springEasing, startWebSpring,
} from '../../../components/motion/webSpring';

describe('springProgress (0 → 1 from rest, the SPRING token physics)', () => {
  it('starts at 0 and ends at 1', () => {
    for (const token of Object.values(SPRING)) {
      expect(springProgress(token, 0)).toBe(0);
      expect(springProgress(token, 2)).toBeCloseTo(1, 4);
    }
  });

  it('effects tokens never overshoot (colour and opacity)', () => {
    for (const name of ['fastEffects', 'effects', 'slowEffects'] as const) {
      const peak = Math.max(...Array.from({ length: 400 }, (_, i) => springProgress(SPRING[name], i / 400)));
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  it('fastSpatial overshoots ~9.4% (spec §3.2), spatial and calm about 1.5% at most', () => {
    const peak = (name: keyof typeof SPRING) =>
      Math.max(...Array.from({ length: 1000 }, (_, i) => springProgress(SPRING[name], i / 1000)));
    expect(peak('fastSpatial')).toBeGreaterThan(1.09);
    expect(peak('fastSpatial')).toBeLessThan(1.1);
    expect(peak('spatial')).toBeLessThan(1.016);
    expect(peak('calm')).toBeLessThan(1.016);
  });
});

describe('springSettleMs', () => {
  it('matches the spec table for opacity to within 1% (effects 168 ms, fastEffects 109 ms)', () => {
    expect(springSettleMs(SPRING.effects, 0.01)).toBeGreaterThan(155);
    expect(springSettleMs(SPRING.effects, 0.01)).toBeLessThan(180);
    expect(springSettleMs(SPRING.fastEffects, 0.01)).toBeGreaterThan(98);
    expect(springSettleMs(SPRING.fastEffects, 0.01)).toBeLessThan(120);
  });

  it('settles the nav pill (24 dp of travel, 0.5 px) inside F4\'s 250 ms on fastSpatial', () => {
    expect(springSettleMs(SPRING.fastSpatial, 0.5 / 24)).toBeLessThanOrEqual(250);
  });
});

describe('springEasing', () => {
  it('is a CSS linear() curve from 0 to 1 sampled over the settle time', () => {
    const { easing, durationMs } = springEasing(SPRING.effects);
    expect(easing.startsWith('linear(0, ')).toBe(true);
    expect(easing.endsWith(', 1)')).toBe(true);
    expect(durationMs).toBe(springSettleMs(SPRING.effects, 0.001));
  });

  it('carries the overshoot of a spatial token', () => {
    const values = springEasing(SPRING.fastSpatial).easing.slice(7, -1).split(', ').map(Number);
    expect(Math.max(...values)).toBeGreaterThan(1.05);
  });
});

describe('startWebSpring', () => {
  it('runs a WAAPI animation with the token curve and returns it', () => {
    const anim = { cancel: jest.fn() };
    const el = { animate: jest.fn(() => anim), getAnimations: () => [] };
    const out = startWebSpring(el as never, [{ opacity: 0 }, { opacity: 1 }], SPRING.effects);
    expect(out).toBe(anim);
    expect(el.animate).toHaveBeenCalledWith(
      [{ opacity: 0 }, { opacity: 1 }],
      expect.objectContaining({ duration: springEasing(SPRING.effects).durationMs, easing: springEasing(SPRING.effects).easing }),
    );
  });

  it('cancels what the element was running first (a new move replaces the old one)', () => {
    const old = { cancel: jest.fn() };
    const el = { animate: jest.fn(() => ({})), getAnimations: () => [old] };
    startWebSpring(el as never, [{ opacity: 0 }, { opacity: 1 }], SPRING.effects);
    expect(old.cancel).toHaveBeenCalled();
  });

  it('does nothing where WAAPI is missing', () => {
    expect(startWebSpring({} as never, [{ opacity: 0 }, { opacity: 1 }], SPRING.effects)).toBeNull();
    expect(startWebSpring(null, [{ opacity: 0 }, { opacity: 1 }], SPRING.effects)).toBeNull();
  });
});
