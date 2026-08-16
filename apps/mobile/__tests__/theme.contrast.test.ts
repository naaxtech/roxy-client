/**
 * The contrast contract, executable.
 *
 * This file exists because `lib/theme.ts` used to carry the rule in a comment:
 * `textMuted: '#8B7AA8', // soft purple — design text-3 (AA Large ✓)`. That
 * comment was true — 3.6:1 clears the 3:1 large-text bar — and useless, because
 * the token was then used as 12px body copy on eight surfaces of one screen. A
 * comment cannot enforce a usage rule. A test can.
 *
 * Every pair below is a pairing that actually renders, with the file that
 * renders it. The maths is re-implemented here rather than imported from
 * `lib/theme.ts`, so a bug in the shipped helper cannot make the gate pass.
 *
 * src: https://www.w3.org/TR/WCAG22/#contrast-minimum · SC 1.4.3, 1.4.11 · read 2026-08-06
 * src: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance · read 2026-08-06
 */
import {
  THEMES,
  BRAND_INK,
  BRAND_GRADIENT,
  LIVE_GRADIENT,
  COMMUNITY_CHIP_COLORS,
  inkOn,
  relativeLuminance as shippedLuminance,
  type Theme,
  type ThemeColors,
} from '../lib/theme';

/** SC 1.4.3 — text below 18.66px bold / 24px regular. */
const AA_TEXT = 4.5;
/** SC 1.4.3 large text and SC 1.4.11 non-text (icons, meters, focus rings). */
const AA_LARGE_OR_NON_TEXT = 3;

// ---------------------------------------------------------------------------
// WCAG 2.2 arithmetic — independent of the implementation under test.
// ---------------------------------------------------------------------------

function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  const linear = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Asserts through a string so the failure message names the pair and the
 * measured ratio, the way the audit reported it — `toBeGreaterThanOrEqual`
 * would only ever tell you that 3.61 is not 4.5.
 */
function expectContrast(fg: string, bg: string, min: number): void {
  const measured = (Math.round(ratio(fg, bg) * 100) / 100).toFixed(2);
  const verdict = ratio(fg, bg) >= min ? 'pass' : `FAIL at ${measured}:1, needs ${min}:1`;
  expect(`${fg} on ${bg} — ${verdict}`).toBe(`${fg} on ${bg} — pass`);
}

// ---------------------------------------------------------------------------
// What is painted on what.
// ---------------------------------------------------------------------------

type InkKey = keyof ThemeColors;

/**
 * Every ground a screen paints text on. `line` and `lineStrong` are absent on
 * purpose: they are hairlines, never a fill behind a label. In light,
 * `backgroundAlt` and `surface` are the same colour — the duplicate assertion
 * is free and survives them diverging later.
 */
const SURFACES = ['background', 'backgroundAlt', 'surface', 'surfaceLight'] as const;

const THEME_NAMES: Theme[] = ['light', 'dark'];

/**
 * General-purpose text ink. These three are the ramp every screen reaches for,
 * so they are licensed on every surface and must hold AA on all of them —
 * no per-token usage rule to remember, and none to get wrong.
 */
const BODY_INK: InkKey[] = ['textPrimary', 'textSecondary', 'textMuted'];

/**
 * The ink half of each fill/ink pair, plus `roxy`, which is one colour doing
 * both jobs and clears AA either way. These are what new 3.0 code writes when
 * it wants a brand or semantic colour *as text*. All licensed on every surface.
 */
const SEMANTIC_INK_AT_AA: InkKey[] = [
  'primaryInk',
  'secondaryInk',
  'goldInk',
  'successInk',
  'errorInk',
  'sisterInk',
  'roxy',
];

/**
 * The fill half. These are painted under something — a button, a dot, a meter,
 * a LIVE pill — so they answer to SC 1.4.11's 3:1 non-text floor against every
 * surface they can sit on, not to the 4.5:1 text bar.
 */
const SEMANTIC_FILLS: InkKey[] = [
  'primary',
  'secondary',
  'gold',
  'success',
  'error',
  'sister',
];

/**
 * Documented gap, not a licence.
 *
 * Pre-3.0 call sites use the *fill* token as small text: `color: colors.primary`
 * appears 124 times, `colors.success` 10, `colors.secondary` 7, and dark
 * `colors.error` 23. The fix is the `*Ink` token beside each one, and moving
 * those call sites is phase 1–6 of the redesign, not phase 0.
 *
 * Until then each is pinned at the SC 1.4.11 floor by SEMANTIC_FILLS above:
 * it may not get worse. The "is still a gap" test below asserts each entry is
 * genuinely still below AA somewhere, so an entry cannot outlive its problem —
 * the day one clears AA on every surface, delete it from this list.
 */
const INK_BELOW_AA: Record<Theme, InkKey[]> = {
  dark: ['primary', 'error'],
  light: ['primary', 'secondary', 'success'],
};

/**
 * Fills that carry `BRAND_INK` — gradient icon plates and solid brand chips.
 * Every one of these used to carry `#fff`, which is why the audit found
 * 1.8:1 and 2.9:1 on three screens.
 */
const BRAND_FILLS: { fill: string; where: string }[] = [
  { fill: '#FF5A2E', where: 'BRAND_GRADIENT stop 1 — logo, ＋ create button, Roxy FAB' },
  { fill: '#F22481', where: 'BRAND_GRADIENT stop 2 — same plates; also THEMES.dark.primary' },
  { fill: '#FF5C3D', where: 'LIVE_GRADIENT stop 1 — LIVE pills, on-air rooms' },
  { fill: '#8E7CF7', where: 'Sister plate stop 1 — grow/index.tsx, sister-button/index.tsx' },
  { fill: '#C86DD7', where: 'Sister plate stop 2 — grow/index.tsx, sister-button/index.tsx' },
  { fill: '#F7B42C', where: 'Badges plate stop 1 — grow/index.tsx' },
  { fill: '#FC575E', where: 'Badges plate stop 2 — grow/index.tsx' },
  { fill: '#2BB673', where: 'MiniWins completed plate stop 1 — components/grow/MiniWinsCard.tsx' },
  { fill: '#1E9E62', where: 'MiniWins completed plate stop 2 — components/grow/MiniWinsCard.tsx' },
  { fill: '#FF1493', where: 'THEMES.*.devPanel — the __DEV__ FAB in components/dev/DevPanel.tsx' },
];

/**
 * Theme tokens used as a solid fill under a label: `primary` on the onboarding
 * and report buttons, `roxy` on the feedback submit button and the donation
 * cadence chips. `roxy` inverts between themes — #AF3B74 wants white, #E879A6
 * wants ink — which is the whole reason `inkOn` exists.
 */
const THEME_FILLS: { theme: Theme; key: InkKey }[] = [
  { theme: 'light', key: 'primary' },
  { theme: 'light', key: 'roxy' },
  { theme: 'dark', key: 'primary' },
  { theme: 'dark', key: 'roxy' },
];

/**
 * The one brand stop that carries no ink at AA: white reaches 4.41:1 and
 * BRAND_INK reaches 4.23:1, so there is no correct answer for small text on it.
 * It is the tail of a gradient, never a flat fill, and it sits under icons and
 * the one 14px CTA label. Pinned at the non-text floor and asserted to be
 * genuinely below AA, so the exception cannot outlive the problem.
 */
const NO_INK_AT_AA = '#E0189A';

// ---------------------------------------------------------------------------

describe('WCAG arithmetic', () => {
  it('agrees with the published anchors', () => {
    expect(ratio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(ratio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(ratio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('matches the helper shipped in lib/theme.ts', () => {
    for (const hex of ['#000000', '#FFFFFF', '#8B7AA8', '#FAF2F6', BRAND_INK]) {
      expect(shippedLuminance(hex)).toBeCloseTo(luminance(hex), 10);
    }
  });

  it('rejects a value that is not a hex colour instead of returning NaN', () => {
    expect(() => shippedLuminance('rebeccapurple')).toThrow(/not a hex colour/);
  });
});

describe.each(THEME_NAMES)('%s theme', (theme) => {
  const colors = THEMES[theme];

  describe.each(BODY_INK)('%s — body text, licensed on every surface', (ink) => {
    it.each(SURFACES)(`on %s clears AA small text (${AA_TEXT}:1)`, (surface) => {
      expectContrast(colors[ink], colors[surface], AA_TEXT);
    });
  });

  describe.each(SEMANTIC_INK_AT_AA)('%s — semantic ink', (ink) => {
    it.each(SURFACES)(`on %s clears AA small text (${AA_TEXT}:1)`, (surface) => {
      expectContrast(colors[ink], colors[surface], AA_TEXT);
    });
  });

  describe.each(SEMANTIC_FILLS)('%s — fill, not ink', (fill) => {
    it.each(SURFACES)(
      `on %s clears the SC 1.4.11 non-text floor (${AA_LARGE_OR_NON_TEXT}:1)`,
      (surface) => {
        expectContrast(colors[fill], colors[surface], AA_LARGE_OR_NON_TEXT);
      }
    );
  });

  it('gold and warning are the same token under two names', () => {
    expect(colors.warning).toBe(colors.gold);
  });
});

describe('documented gap: pre-3.0 call sites paint fill tokens as small text', () => {
  it.each(THEME_NAMES)(
    '%s — every entry is still genuinely below AA; when one clears, delete it from INK_BELOW_AA',
    (theme) => {
      const stillBelowAA = INK_BELOW_AA[theme].filter((ink) =>
        SURFACES.some((surface) => ratio(THEMES[theme][ink], THEMES[theme][surface]) < AA_TEXT)
      );
      expect(stillBelowAA).toEqual(INK_BELOW_AA[theme]);
    }
  );
});

describe('brand fills carry BRAND_INK, not white', () => {
  it.each(BRAND_FILLS)(
    `$fill ($where) clears AA small text (${AA_TEXT}:1) with the ink inkOn() picks`,
    ({ fill }) => {
      expectContrast(inkOn(fill), fill, AA_TEXT);
    }
  );

  it.each([...BRAND_GRADIENT, ...LIVE_GRADIENT])(
    `gradient stop %s carries an icon at the non-text floor (${AA_LARGE_OR_NON_TEXT}:1)`,
    (stop) => {
      expectContrast(inkOn(stop), stop, AA_LARGE_OR_NON_TEXT);
    }
  );

  it.each(THEME_FILLS)(
    `THEMES[$theme] $key as a button fill clears AA small text (${AA_TEXT}:1) with inkOn()`,
    ({ theme, key }) => {
      const fill = THEMES[theme][key];
      expectContrast(inkOn(fill), fill, AA_TEXT);
    }
  );

  it.each(COMMUNITY_CHIP_COLORS)(
    `community chip %s carries its initial at AA small text (${AA_TEXT}:1) with inkOn()`,
    (fill) => {
      expectContrast(inkOn(fill), fill, AA_TEXT);
    }
  );

  it('inkOn always returns the higher-contrast of the two inks', () => {
    for (const { fill } of [...BRAND_FILLS, { fill: NO_INK_AT_AA }]) {
      const chosen = inkOn(fill);
      const rejected = chosen === BRAND_INK ? '#FFFFFF' : BRAND_INK;
      expect(ratio(chosen, fill)).toBeGreaterThanOrEqual(ratio(rejected, fill));
    }
  });
});

describe(`${NO_INK_AT_AA} — the deepest brand stop takes no ink at AA: icons and large text only (SC 1.4.11 / 1.4.3 large)`, () => {
  it(`clears the ${AA_LARGE_OR_NON_TEXT}:1 non-text floor with the ink inkOn() picks`, () => {
    expectContrast(inkOn(NO_INK_AT_AA), NO_INK_AT_AA, AA_LARGE_OR_NON_TEXT);
  });

  it('genuinely carries neither ink at AA — delete this block the day that changes', () => {
    expect(ratio(BRAND_INK, NO_INK_AT_AA)).toBeLessThan(AA_TEXT);
    expect(ratio('#FFFFFF', NO_INK_AT_AA)).toBeLessThan(AA_TEXT);
  });

  it('is the last stop of BRAND_GRADIENT — if the ramp changes, so does this block', () => {
    expect(BRAND_GRADIENT[BRAND_GRADIENT.length - 1]).toBe(NO_INK_AT_AA);
  });
});
