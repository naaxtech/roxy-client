import { THEMES } from '../../../lib/theme';
import { formatScore, scoreTone } from '../../../lib/archive';
import {
  SCORE_GRADIENT, SCORE_ICON, scoreGradient, scoreIcon, scoreRingColor,
  isDarkTheme, withAlpha, tintFill, tintLine, notePalette, NOTE_PALETTE_SLOTS,
  RING_DEGREES_PER_PERCENT, ringSweepDegrees, ringDash,
} from '../../../components/archive/archiveTokens';

describe('score bands', () => {
  it('maps the prototype thresholds onto the three tones', () => {
    // scoreIc = v>=75 ? ✿ : v>=50 ? ❋ : 🥀  (behaviour line 1979)
    const at = (up: number, total: number) => scoreTone(formatScore(up, total));
    expect(at(75, 100)).toBe('good');
    expect(at(74, 100)).toBe('mixed');
    expect(at(50, 100)).toBe('mixed');
    expect(at(49, 100)).toBe('poor');
  });

  it('gives every tone the prototype icon, and none below the gate', () => {
    expect(SCORE_ICON.good).toBe('✿');
    expect(SCORE_ICON.mixed).toBe('❋');
    expect(SCORE_ICON.poor).toBe('🥀');
    expect(scoreIcon('good')).toBe('✿');
    expect(scoreIcon('none')).toBeNull();
  });

  it('builds every score gradient out of theme tokens, never a literal', () => {
    // The prototype paints the same two-stop ramp in both themes, and for the
    // first two bands those two stops ARE the light and dark values of one role.
    expect(SCORE_GRADIENT.good).toEqual([THEMES.light.success, THEMES.dark.success]);
    expect(SCORE_GRADIENT.mixed).toEqual([THEMES.light.gold, THEMES.dark.gold]);
    expect(SCORE_GRADIENT.poor).toEqual([THEMES.light.primary, THEMES.dark.primary]);
    expect(scoreGradient('none')).toBeNull();
  });

  it('resolves the ring colour inside the active theme, not across both', () => {
    // enRing: c('#2FC97E','#178A4C') — the SAME role, picked per theme. A ring
    // painted with the other theme's value is the bug this asserts against.
    expect(scoreRingColor('good', THEMES.dark)).toBe(THEMES.dark.success);
    expect(scoreRingColor('good', THEMES.light)).toBe(THEMES.light.success);
    expect(scoreRingColor('mixed', THEMES.light)).toBe(THEMES.light.gold);
    expect(scoreRingColor('poor', THEMES.dark)).toBe(THEMES.dark.primary);
    expect(scoreRingColor('none', THEMES.dark)).toBe(THEMES.dark.line);
  });
});

describe('ring maths', () => {
  it('sweeps 3.6 degrees per percent, exactly as the prototype', () => {
    expect(RING_DEGREES_PER_PERCENT).toBe(3.6);
    expect(ringSweepDegrees(84)).toBeCloseTo(302.4, 5);
    expect(ringSweepDegrees(0)).toBe(0);
    expect(ringSweepDegrees(100)).toBeCloseTo(360, 5);
  });

  it('turns that sweep into a dash pair whose filled share is the percentage', () => {
    const r = 26;
    const circumference = 2 * Math.PI * r;
    const [on, off] = ringDash(84, r);
    expect(on + off).toBeCloseTo(circumference, 5);
    expect(on / circumference).toBeCloseTo(0.84, 5);
    // A zero score must draw nothing, not a stub cap.
    expect(ringDash(0, r)[0]).toBe(0);
  });
});

describe('tints', () => {
  it('senses the theme from its own background rather than a store', () => {
    expect(isDarkTheme(THEMES.dark)).toBe(true);
    expect(isDarkTheme(THEMES.light)).toBe(false);
  });

  it('reproduces --pkBg from the primary token', () => {
    // dark  --pkBg: rgba(242,36,129,.16)   → primary #F22481 at .16
    // light --pkBg: rgba(216,19,104,.09)   → primary #D81368 at .09
    expect(withAlpha(THEMES.dark.primary, 0.16)).toBe('rgba(242, 36, 129, 0.16)');
    expect(tintFill(THEMES.dark, THEMES.dark.primary)).toBe('rgba(242, 36, 129, 0.16)');
    expect(tintFill(THEMES.light, THEMES.light.primary)).toBe('rgba(216, 19, 104, 0.09)');
  });

  it('reproduces --pkLn from the primary ink token', () => {
    // dark --pkLn: rgba(255,122,181,.4) → primaryInk #FF7AB5 at .4
    expect(tintLine(THEMES.dark, THEMES.dark.primaryInk)).toBe('rgba(255, 122, 181, 0.4)');
    expect(tintLine(THEMES.light, THEMES.light.primaryInk)).toBe('rgba(193, 16, 96, 0.3)');
  });

  it('refuses a colour it cannot parse instead of emitting rgba(NaN)', () => {
    expect(() => withAlpha('not-a-colour', 0.5)).toThrow();
  });
});

describe('content-note palette', () => {
  it('rotates through three slots', () => {
    expect(NOTE_PALETTE_SLOTS).toBe(3);
    const c = THEMES.dark;
    expect(notePalette(c, 0, false).ink).toBe(c.primaryInk);
    expect(notePalette(c, 1, false).ink).toBe(c.secondaryInk);
    expect(notePalette(c, 2, false).ink).toBe(c.textSecondary);
    expect(notePalette(c, 3, false).ink).toBe(c.primaryInk);
  });

  it('paints an agreed note pink whatever slot it landed in', () => {
    const c = THEMES.dark;
    expect(notePalette(c, 2, true)).toEqual(notePalette(c, 0, true));
    expect(notePalette(c, 2, true).ink).toBe(c.primaryInk);
  });

  it('resolves in light as well as dark', () => {
    const c = THEMES.light;
    expect(notePalette(c, 1, false).ink).toBe(c.secondaryInk);
    expect(notePalette(c, 2, false).bg).toBe(c.surfaceLight);
  });
});
