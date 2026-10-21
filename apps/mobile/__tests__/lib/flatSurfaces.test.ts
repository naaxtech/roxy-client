/**
 * v2 (design direction › Bans; decisions 2026-10-21): the brand gradient
 * survives only on the wordmark and the app icon. Every other surface that
 * used a gradient takes a FLAT token. Call sites keep their LinearGradient
 * element (so no layout moves), fed two equal stops — which renders flat.
 *
 * This file holds the shared flat sources so a screen cannot drift back to a
 * ramp, and holds the identity fills to the direction's ink (`onBrandPink`
 * inks every identity fill).
 */
import {
  THEMES, IDENTITY, BRAND_GRADIENT, contrastRatio, flatFill, pinkFill, scrim,
} from '../../lib/theme';
import { AVATAR_GRADS, avatarGradient } from '../../lib/avatars';
import { coverGradientFor } from '../../lib/coverGradient';
import { TEXT_CARD_GRADIENT, TEXT_CARD_INK } from '../../lib/textCard';
import { FIELD } from '../../components/feed/feedChromeTokens';

const isFlat = (stops: readonly string[]) =>
  stops.length >= 2 && stops.every((s) => s.toUpperCase() === stops[0].toUpperCase());

/** Hue in degrees of a #RRGGBB colour (0 for greys). */
function hue(hex: string): { h: number; s: number } {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s };
}
const isViolet = (hex: string) => {
  const { h, s } = hue(hex);
  return s > 0.15 && h >= 235 && h <= 300;
};

describe('flat fills (v2: no gradient outside the wordmark)', () => {
  it('flatFill is two equal stops of one colour', () => {
    expect(flatFill('#123456')).toEqual(['#123456', '#123456']);
  });

  it.each(['light', 'dark'] as const)('pinkFill is the theme pink, flat (%s)', (theme) => {
    expect(pinkFill(THEMES[theme])).toEqual([THEMES[theme].pink, THEMES[theme].pink]);
  });

  it('keeps the brand ramp itself for the wordmark', () => {
    expect(BRAND_GRADIENT).toEqual(['#FF5A2E', '#F22481', '#E0189A']);
  });
});

describe('scrim (v2: warm-neutral black, no violet cast)', () => {
  it('is the stage black at the requested alpha', () => {
    expect(scrim(0.66)).toBe('rgba(11, 10, 10, 0.66)');
    expect(scrim(0.4)).toBe('rgba(11, 10, 10, 0.4)');
  });
});

describe('avatars (v2: one identity fill each, inked onBrandPink)', () => {
  it('every avatar pair is flat and drawn from the identity palette', () => {
    const identity = new Set(IDENTITY.map((c) => c.toUpperCase()));
    for (const pair of AVATAR_GRADS) {
      expect(isFlat(pair)).toBe(true);
      expect(identity.has(pair[0].toUpperCase())).toBe(true);
    }
  });

  it('carries the identity ink at 4.5:1 on every fill', () => {
    for (const pair of AVATAR_GRADS) {
      expect(contrastRatio(THEMES.light.onBrandPink, pair[0])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is stable per name and flat', () => {
    expect(avatarGradient('Nicole')).toEqual(avatarGradient('Nicole'));
    expect(isFlat(avatarGradient('Nicole'))).toBe(true);
  });
});

describe('archive covers (v2: identity fallback, flat)', () => {
  it('a stored cover is the entry art (content) and still paints as stored', () => {
    expect(coverGradientFor('linear-gradient(160deg,#111111,#222222)', 'carol')).toEqual(['#111111', '#222222']);
  });

  it('the fallback is an identity fill, flat', () => {
    const out = coverGradientFor(null, 'gentleman-jack');
    expect(isFlat(out)).toBe(true);
    expect(IDENTITY.map((c) => c.toUpperCase())).toContain(out[0].toUpperCase());
  });
});

describe('text card (v2: the text-post field, not the plum ramp)', () => {
  it('is the flat fieldInk with fieldPaper words', () => {
    expect(isFlat(TEXT_CARD_GRADIENT)).toBe(true);
    expect(TEXT_CARD_GRADIENT[0]).toBe(FIELD.ink);
    expect(TEXT_CARD_INK).toBe(FIELD.paper);
    expect(contrastRatio(TEXT_CARD_INK, TEXT_CARD_GRADIENT[0])).toBeGreaterThanOrEqual(4.5);
    expect(TEXT_CARD_GRADIENT.some(isViolet)).toBe(false);
  });
});
