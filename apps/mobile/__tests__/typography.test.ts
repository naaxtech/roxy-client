/**
 * The type contract, executable — design direction v2 (Nicole, 2026-10-21).
 *
 * A token package that ships colour and no type scale is how an app ends up
 * with sixteen font sizes: nothing stops the next author typing `14`. These
 * assertions are the stop. The v2 step set is asserted by name and count —
 * adding a step should require editing this file, which is a decision, not a
 * typo.
 *
 * v2 replaced v0's seven steps (micro 10 … display 28; Outfit + Figtree) with
 * Geologica (display) + Commissioner (text) + IBM Plex Mono (codes), chosen
 * for Cyrillic, Greek and Vietnamese coverage, and a scale whose body is 15.
 * The v0 step names stay as aliases of the v2 step that replaced them, so the
 * ~450 call sites keep compiling and change with the scale.
 *
 * src: polish/design-direction.md · v2 › Typography › Scale · 2026-10-21
 */
import {
  FONTS,
  FONT_FAMILIES,
  TYPE,
  TABULAR,
  emphasized,
  type TypeStepName,
} from '../lib/typography';

/** The v2 steps (direction › Scale), smallest to largest by size. */
const V2_STEPS = [
  'meta',
  'body',
  'label',
  'button',
  'title',
  'headline',
  'display',
  'moment',
  'mono',
] as const;

/** The size ladder: steps that differ by SIZE, not by weight or family. */
const LADDER: TypeStepName[] = ['meta', 'body', 'title', 'headline', 'display', 'moment'];

/** v0 name → the v2 step that took its job (proposed-tokens-v2 › Type). */
const LEGACY: [TypeStepName, TypeStepName][] = [
  ['micro', 'meta'],
  ['caption', 'meta'],
  ['bodyLg', 'body'],
];

const weightOf = (family: string) => Number(/_(\d{3})/.exec(family)?.[1]);

describe('the v2 scale', () => {
  it.each([
    ['meta', 12, 16, 500],
    ['body', 15, 22, 400],
    ['label', 15, 20, 600],
    ['button', 16, 20, 600],
    ['title', 20, 24, 700],
    ['headline', 28, 32, 800],
    ['display', 40, 42, 800],
    ['moment', 56, 56, 800],
    ['mono', 13, 18, 500],
  ] as const)('%s is %i/%i at weight %i', (name, size, leading, weight) => {
    expect(TYPE[name].fontSize).toBe(size);
    expect(TYPE[name].lineHeight).toBe(leading);
    expect(weightOf(TYPE[name].fontFamily)).toBe(weight);
  });

  it('tracks only the display steps, and only tighter (direction: -0.2 … -1.4), mono +0.5', () => {
    expect(TYPE.title.letterSpacing).toBe(-0.2);
    expect(TYPE.headline.letterSpacing).toBe(-0.4);
    expect(TYPE.display.letterSpacing).toBe(-0.8);
    expect(TYPE.moment.letterSpacing).toBe(-1.4);
    expect(TYPE.mono.letterSpacing).toBe(0.5);
    for (const name of ['meta', 'body', 'label', 'button'] as const) {
      expect(TYPE[name].letterSpacing ?? 0).toBe(0);
    }
  });

  it('has the nine v2 steps plus only the documented v0 aliases', () => {
    const legacyNames = ['micro', 'caption', 'body', 'bodyLg', 'title', 'headline', 'display'];
    const expected = new Set<string>([...V2_STEPS, ...legacyNames]);
    expect(new Set(Object.keys(TYPE))).toEqual(expected);
  });

  it.each(LEGACY)('v0 %s is the v2 step %s', (legacy, step) => {
    expect(TYPE[legacy]).toBe(TYPE[step]);
  });

  it('sizes ascend strictly along the ladder — two steps at the same size are one step', () => {
    const sizes = LADDER.map((name) => TYPE[name].fontSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it('bottoms out at 12 dp — meta is the floor (v0 micro 10 merged into it)', () => {
    for (const name of Object.keys(TYPE) as TypeStepName[]) {
      expect(TYPE[name].fontSize).toBeGreaterThanOrEqual(12);
    }
  });

  it('gives prose room to breathe and display steps at least solid leading', () => {
    for (const name of ['meta', 'body', 'label', 'button', 'mono'] as const) {
      expect(TYPE[name].lineHeight).toBeGreaterThanOrEqual(TYPE[name].fontSize * 1.2);
    }
    for (const name of ['title', 'headline', 'display', 'moment'] as const) {
      expect(TYPE[name].lineHeight).toBeGreaterThanOrEqual(TYPE[name].fontSize);
    }
  });

  it('puts tabular figures on meta, where counts and times live', () => {
    expect(TYPE.meta.fontVariant).toEqual(['tabular-nums']);
    expect(TABULAR.fontVariant).toEqual(['tabular-nums']);
  });

  it('the feed body moved 13 → 15 (v0 body)', () => {
    expect(TYPE.body.fontSize).toBe(15);
  });
});

describe('the families are closed', () => {
  it('display is Geologica 700/800, text Commissioner 400/500/600, mono Plex Mono 500', () => {
    for (const family of Object.values(FONTS.display)) expect(family).toMatch(/^Geologica_(700|800)/);
    for (const family of Object.values(FONTS.text)) expect(family).toMatch(/^Commissioner_(400|500|600)/);
    expect(FONTS.mono.medium).toBe('IBMPlexMono_500Medium');
    expect(FONTS.text.regular).toBe('Commissioner_400Regular');
  });

  it('loads exactly the six v2 faces', () => {
    expect([...FONT_FAMILIES].sort()).toEqual([
      'Commissioner_400Regular',
      'Commissioner_500Medium',
      'Commissioner_600SemiBold',
      'Geologica_700Bold',
      'Geologica_800ExtraBold',
      'IBMPlexMono_500Medium',
    ]);
  });

  it('names only families the loader registers', () => {
    for (const name of Object.keys(TYPE) as TypeStepName[]) {
      expect(FONT_FAMILIES).toContain(TYPE[name].fontFamily);
    }
  });

  it('uses Geologica for display steps, Commissioner for text steps, mono for codes', () => {
    const display = Object.values(FONTS.display) as string[];
    const text = Object.values(FONTS.text) as string[];
    for (const name of ['meta', 'body', 'label', 'button'] as const) {
      expect(text).toContain(TYPE[name].fontFamily);
    }
    for (const name of ['title', 'headline', 'display', 'moment'] as const) {
      expect(display).toContain(TYPE[name].fontFamily);
    }
    expect(TYPE.mono.fontFamily).toBe(FONTS.mono.medium);
  });

  it('keeps display at 700–800 and text at 400–600, per the direction', () => {
    for (const family of Object.values(FONTS.display)) {
      expect(weightOf(family)).toBeGreaterThanOrEqual(700);
      expect(weightOf(family)).toBeLessThanOrEqual(800);
    }
    for (const family of Object.values(FONTS.text)) {
      expect(weightOf(family)).toBeGreaterThanOrEqual(400);
      expect(weightOf(family)).toBeLessThanOrEqual(600);
    }
  });
});

describe('emphasized twins (M3 Expressive)', () => {
  it('raise one weight at the same size: meta 500 → 600, body 400 → 600, title 700 → 800', () => {
    expect(emphasized('meta')).toMatchObject({ fontSize: 12, fontFamily: FONTS.text.semibold });
    expect(emphasized('body')).toMatchObject({ fontSize: 15, fontFamily: FONTS.text.semibold });
    expect(emphasized('title')).toMatchObject({ fontSize: 20, fontFamily: FONTS.display.extrabold });
  });

  it('leaves a step already at its heaviest face where it is', () => {
    expect(emphasized('headline').fontFamily).toBe(FONTS.display.extrabold);
  });
});
