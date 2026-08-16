/**
 * The type contract, executable.
 *
 * A token package that ships colour and no type scale is how an app ends up
 * with sixteen font sizes: nothing stops the next author typing `14`. These
 * assertions are the stop. The step *count* is asserted deliberately — adding
 * an eighth step should require editing this file, which is a decision, not a
 * typo.
 */
import { FONTS, FONT_FAMILIES, TYPE, type TypeStepName } from '../lib/typography';

/** The order the scale is meant to be read in, smallest to largest. */
const ORDER: TypeStepName[] = [
  'micro',
  'caption',
  'body',
  'bodyLg',
  'title',
  'headline',
  'display',
];

describe('the scale is closed', () => {
  it('has exactly seven steps', () => {
    expect(Object.keys(TYPE)).toHaveLength(7);
  });

  it('names every step exactly once, in ascending order', () => {
    expect(ORDER.slice().sort()).toEqual(Object.keys(TYPE).slice().sort());
  });

  it('sizes ascend strictly — two steps at the same size are one step', () => {
    const sizes = ORDER.map((name) => TYPE[name].fontSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it('bottoms out at 10dp — the prototype floor, and the smallest readable label', () => {
    for (const name of ORDER) {
      expect(TYPE[name].fontSize).toBeGreaterThanOrEqual(10);
    }
  });

  it('gives every step a line height with room in it', () => {
    for (const name of ORDER) {
      // 1.2 is the tightest the display numerals want; prose sits well above it.
      expect(TYPE[name].lineHeight).toBeGreaterThanOrEqual(TYPE[name].fontSize * 1.15);
    }
  });
});

describe('the families are closed', () => {
  it('exposes three Outfit weights and four Figtree weights', () => {
    expect(Object.values(FONTS.display)).toHaveLength(3);
    expect(Object.values(FONTS.text)).toHaveLength(4);
    expect(FONT_FAMILIES).toHaveLength(7);
  });

  it('names only families the loader registers', () => {
    for (const name of ORDER) {
      expect(FONT_FAMILIES).toContain(TYPE[name].fontFamily);
    }
  });

  it('uses Outfit for display steps and Figtree for text steps', () => {
    const outfit = Object.values(FONTS.display) as string[];
    const figtree = Object.values(FONTS.text) as string[];
    for (const name of ['micro', 'caption', 'body', 'bodyLg'] as TypeStepName[]) {
      expect(figtree).toContain(TYPE[name].fontFamily);
    }
    for (const name of ['title', 'headline', 'display'] as TypeStepName[]) {
      expect(outfit).toContain(TYPE[name].fontFamily);
    }
  });

  it('keeps Outfit at 600–800 and Figtree at 400–700, per the handoff', () => {
    const weightOf = (family: string) => Number(/_(\d{3})/.exec(family)?.[1]);
    for (const family of Object.values(FONTS.display)) {
      expect(weightOf(family)).toBeGreaterThanOrEqual(600);
      expect(weightOf(family)).toBeLessThanOrEqual(800);
    }
    for (const family of Object.values(FONTS.text)) {
      expect(weightOf(family)).toBeGreaterThanOrEqual(400);
      expect(weightOf(family)).toBeLessThanOrEqual(700);
    }
  });
});
