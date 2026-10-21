/**
 * Design direction v2 (approved by Nicole 2026-10-21), executable.
 *
 * `polish/design-direction.md` › Color and `polish/proposed-tokens-v2.md` are
 * the source for every value below. The old key names stay working for the
 * ~1,000 call sites that read them, so each one is asserted to BE the v2 role
 * that replaced it: an alias can never drift away from its role unnoticed.
 */
import {
  THEMES,
  RADII,
  SPACE,
  MARGIN,
  IDENTITY,
  COMMUNITY_CHIP_COLORS,
  LIVE_GRADIENT,
  BRAND_GRADIENT,
  BRAND_INK,
  BRAND_INK_DEEP,
  inkOn,
  type ThemeColors,
} from '../../lib/theme';

type Key = keyof ThemeColors;

/** Direction v2 › Color, light (default) then dark. */
const V2: Record<'light' | 'dark', Partial<Record<Key, string>>> = {
  light: {
    ground: '#F6F3F2',
    surface: '#FFFDFD',
    raised: '#ECE7E6',
    line: '#E0D9D8',
    control: '#8C8186',
    ink: '#1A1216',
    ink2: '#544A4F',
    ink3: '#675C61',
    pink: '#C8126A',
    onPink: '#FFFFFF',
    pinkInk: '#C8126A',
    pinkLip: '#8E0C4A',
    pinkContainer: '#FFD9E7',
    onPinkContainer: '#5C0A31',
    brandPink: '#F22481',
    onBrandPink: '#17080F',
    inverse: '#2B2427',
    onInverse: '#F7F2F4',
    inversePink: '#FF9EC3',
    premium: '#F2C94C',
    onPremium: '#1A1216',
    warning: '#B07A10',
    warningInk: '#8A5E06',
    success: '#177A47',
    successInk: '#13703F',
    danger: '#C8262C',
    dangerInk: '#B21F25',
    sister: '#4F6B7C',
    sisterInk: '#3E5868',
    live: '#E8481E',
    stage: '#0B0A0A',
    stageRaised: '#262124',
  },
  dark: {
    ground: '#141113',
    surface: '#1E1A1C',
    raised: '#2A2528',
    line: '#3A3337',
    control: '#6E6469',
    ink: '#F7F2F4',
    ink2: '#C3B8BD',
    ink3: '#A1959B',
    pink: '#F22481',
    onPink: '#17080F',
    pinkInk: '#FF6FA6',
    pinkLip: '#A5145A',
    pinkContainer: '#5A1236',
    onPinkContainer: '#FFD9E7',
    brandPink: '#F22481',
    onBrandPink: '#17080F',
    inverse: '#F1ECEA',
    onInverse: '#1A1216',
    inversePink: '#C8126A',
    premium: '#F2C94C',
    onPremium: '#1A1216',
    warning: '#F2B33D',
    warningInk: '#F6C766',
    success: '#3CCB86',
    successInk: '#62DBA0',
    danger: '#FF5D5D',
    dangerInk: '#FF7B7B',
    sister: '#9FB6C4',
    sisterInk: '#B9CBD6',
    live: '#FF5A2E',
    stage: '#0B0A0A',
    stageRaised: '#262124',
  },
};

/** Old key → the v2 role that took its job (proposed-tokens-v2 › "Replaces"). */
const ALIASES: [Key, Key][] = [
  ['background', 'ground'],
  ['backgroundAlt', 'ground'],
  ['surfaceLight', 'raised'],
  ['lineStrong', 'control'],
  ['textPrimary', 'ink'],
  ['textSecondary', 'ink2'],
  ['textMuted', 'ink3'],
  ['primary', 'pink'],
  ['primaryInk', 'pinkInk'],
  ['secondary', 'ink2'],
  ['secondaryInk', 'ink2'],
  ['gold', 'warning'],
  ['goldInk', 'warningInk'],
  ['error', 'danger'],
  ['errorInk', 'dangerInk'],
  ['roxy', 'pinkInk'],
];

function hue(hex: string): { h: number; s: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s };
}

/** Violet, indigo and lilac live between ~235° and ~300°; v2 bans them all. */
function isViolet(hex: string): boolean {
  const { h, s } = hue(hex);
  return s > 0.15 && h >= 235 && h <= 300;
}

describe.each(['light', 'dark'] as const)('v2 palette — %s', (theme) => {
  const colors = THEMES[theme];

  it.each(Object.entries(V2[theme]) as [Key, string][])('%s is %s', (key, value) => {
    expect(colors[key]).toBe(value);
  });

  it.each(ALIASES)('legacy %s is the v2 role %s', (legacy, role) => {
    expect(colors[legacy]).toBe(colors[role]);
  });

  it('keeps every value a #RRGGBB hex, because call sites append alpha pairs', () => {
    for (const [key, value] of Object.entries(colors)) {
      expect(`${key}=${value}`).toMatch(/=#[0-9A-F]{6}$/i);
    }
  });

  it('carries no violet, indigo or lilac anywhere', () => {
    const violet = Object.entries(colors)
      .filter(([key]) => key !== 'devPanel')
      .filter(([, value]) => isViolet(value));
    expect(violet).toEqual([]);
  });
});

describe('v2 constants', () => {
  it('identity fields are the six from the direction, and the chip rotation uses them', () => {
    expect([...IDENTITY]).toEqual(['#F22481', '#FF7A45', '#F2C94C', '#8FC4A0', '#8FB8DE', '#E8A0BF']);
    expect([...COMMUNITY_CHIP_COLORS]).toEqual([...IDENTITY]);
  });

  it('no exported colour constant is violet', () => {
    for (const hex of [...IDENTITY, ...LIVE_GRADIENT, ...BRAND_GRADIENT, BRAND_INK, BRAND_INK_DEEP]) {
      expect(`${hex}:${isViolet(hex)}`).toBe(`${hex}:false`);
    }
  });

  it('the brand gradient value is kept (wordmark and app icon only)', () => {
    expect([...BRAND_GRADIENT]).toEqual(['#FF5A2E', '#F22481', '#E0189A']);
  });

  it('LIVE_GRADIENT is retired to the flat live dot', () => {
    expect(LIVE_GRADIENT[0]).toBe(LIVE_GRADIENT[1]);
    expect(LIVE_GRADIENT[0]).toBe(THEMES.light.live);
  });

  it('BRAND_INK is onBrandPink, the ink every identity fill carries', () => {
    expect(BRAND_INK).toBe('#17080F');
  });

  it('radii are bimodal plus the press step: 8 / 12 / 20 / 28 / pill', () => {
    expect(RADII.sm).toBe(8);
    expect(RADII.press).toBe(12);
    expect(RADII.md).toBe(20);
    expect(RADII.lg).toBe(RADII.md);
    expect(RADII.sheet).toBe(28);
    expect(RADII.pill).toBe(999);
  });

  it('spacing is the base-4 scale with a 16 dp margin', () => {
    expect([...SPACE]).toEqual([4, 8, 12, 16, 20, 24, 32, 48, 64]);
    for (const step of SPACE) expect(step % 4).toBe(0);
    expect(MARGIN).toBe(16);
  });
});

describe('inkOn for v2', () => {
  it('puts WHITE on the light action pink (#C8126A, 5.60:1)', () => {
    expect(inkOn(THEMES.light.pink).toUpperCase()).toBe('#FFFFFF');
    expect(THEMES.light.onPink).toBe('#FFFFFF');
  });

  it('puts the dark ink on the dark action pink (#F22481, 4.96:1)', () => {
    expect(inkOn(THEMES.dark.pink)).toBe(THEMES.dark.onPink);
  });

  it('agrees with onPink in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(inkOn(THEMES[theme].pink).toUpperCase()).toBe(THEMES[theme].onPink.toUpperCase());
    }
  });

  it('inks every identity fill with onBrandPink', () => {
    for (const fill of IDENTITY) expect(inkOn(fill)).toBe(THEMES.light.onBrandPink);
  });
});
