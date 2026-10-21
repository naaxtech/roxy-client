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
 * Every ground a screen paints text on (v2: one ground, one surface, one
 * raised step). `line` and `control` are absent on purpose: they are hairlines
 * and outlines, never a fill behind a label. The legacy names (`background`,
 * `backgroundAlt`, `surfaceLight`) are asserted to BE these roles in
 * `__tests__/lib/themeV2.test.ts`, so they are covered here too.
 */
const SURFACES = ['ground', 'surface', 'raised'] as const;

const THEME_NAMES: Theme[] = ['light', 'dark'];

/**
 * General-purpose text ink. These three are the ramp every screen reaches for,
 * so they are licensed on every surface and must hold AA on all of them —
 * no per-token usage rule to remember, and none to get wrong.
 */
const BODY_INK: InkKey[] = ['ink', 'ink2', 'ink3'];

/**
 * The ink half of each fill/ink pair, plus legacy `roxy` (an alias of
 * `pinkInk` in v2). These are what new code writes when it wants a brand or
 * semantic colour *as text*. All licensed on every surface.
 */
const SEMANTIC_INK_AT_AA: InkKey[] = [
  'pinkInk',
  'warningInk',
  'successInk',
  'dangerInk',
  'sisterInk',
  'roxy',
];

/**
 * The fill half. These are painted under something — a button, a dot, a meter,
 * the LIVE dot — so they answer to SC 1.4.11's 3:1 non-text floor against every
 * surface they can sit on, not to the 4.5:1 text bar.
 */
const SEMANTIC_FILLS: InkKey[] = [
  'pink',
  'warning',
  'success',
  'danger',
  'sister',
  'live',
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
  // v2: dark `pink` (#F22481) is 4.38:1 on `surface` and 3.83:1 on `raised`;
  // text call sites move to `pinkInk`. Light `primary` (#C8126A), the retired
  // lilac `secondary` (now `ink2`) and dark `error` (now `danger`) all clear AA
  // in v2, so they left this list with the v2 palette (2026-10-21).
  dark: ['primary'],
  // Light `success` (#177A47) is 4.38:1 on `raised`; text uses `successInk`.
  light: ['success'],
};

/**
 * Fills that carry `BRAND_INK` (= `onBrandPink`, #17080F) or white, whichever
 * `inkOn` picks: the brand field, the wordmark ramp, the identity fields, the
 * Premium tag and the dev handle. v0's gradient icon plates (Sister lilac,
 * Badges, MiniWins green ramps) are flat tokens in v2 and left this list.
 */
const BRAND_FILLS: { fill: string; where: string }[] = [
  { fill: '#FF5A2E', where: 'BRAND_GRADIENT stop 1 — the wordmark and app icon only' },
  { fill: '#F22481', where: 'brandPink — "You\'re in" field, the Roxy O ring on the stage; dark pink' },
  { fill: '#C8126A', where: 'light pink — the one primary button, the Create key' },
  { fill: '#FF7A45', where: 'identity tangerine' },
  { fill: '#F2C94C', where: 'identity butter; also `premium`' },
  { fill: '#8FC4A0', where: 'identity sage' },
  { fill: '#8FB8DE', where: 'identity sky' },
  { fill: '#E8A0BF', where: 'identity rose' },
  { fill: '#E8481E', where: 'LIVE_GRADIENT (retired, flat live dot)' },
  { fill: '#FF1493', where: 'THEMES.*.devPanel — the __DEV__ FAB in components/dev/DevPanel.tsx' },
];

/**
 * Theme tokens used as a solid fill under a label: `pink` on the primary
 * button and Create key, legacy `roxy` on the feedback submit button and the
 * donation cadence chips. Both invert between themes — light wants white,
 * dark wants ink — which is the whole reason `inkOn` exists.
 */
const THEME_FILLS: { theme: Theme; key: InkKey }[] = [
  { theme: 'light', key: 'pink' },
  { theme: 'light', key: 'roxy' },
  { theme: 'dark', key: 'pink' },
  { theme: 'dark', key: 'roxy' },
];

/**
 * The key pairs from the direction's measured table (light first, then dark,
 * then the always-dark stage). `fail: true` rows are RULES, asserted to fail
 * so nobody "fixes" them by using the pair: never `pink` text on
 * `pinkContainer`, never white on the brand pink.
 *
 * src: polish/design-direction.md · v2 › Color › Measured contrast · 2026-10-21
 */
type Pair = { name: string; fg: string; bg: string; min: number; fail?: boolean };
const L = THEMES.light;
const D = THEMES.dark;
const DIRECTION_PAIRS: Pair[] = [
  { name: 'light onPink label on pink fill', fg: L.onPink, bg: L.pink, min: AA_TEXT },
  { name: 'light pink as text on ground', fg: L.pink, bg: L.ground, min: AA_TEXT },
  { name: 'light pink as text on raised', fg: L.pink, bg: L.raised, min: AA_TEXT },
  { name: 'light onPinkContainer on pinkContainer', fg: L.onPinkContainer, bg: L.pinkContainer, min: AA_TEXT },
  { name: 'light ink on pinkContainer', fg: L.ink, bg: L.pinkContainer, min: AA_TEXT },
  { name: 'light ink2 on pinkContainer', fg: L.ink2, bg: L.pinkContainer, min: AA_TEXT },
  { name: 'light pink text on pinkContainer (rule: never)', fg: L.pink, bg: L.pinkContainer, min: AA_TEXT, fail: true },
  { name: 'light onBrandPink on brandPink', fg: L.onBrandPink, bg: L.brandPink, min: AA_TEXT },
  { name: 'light white on brandPink (rule: rejected)', fg: '#FFFFFF', bg: L.brandPink, min: AA_TEXT, fail: true },
  { name: 'light onInverse on inverse', fg: L.onInverse, bg: L.inverse, min: AA_TEXT },
  { name: 'light inversePink on inverse', fg: L.inversePink, bg: L.inverse, min: AA_TEXT },
  { name: 'light onPremium on premium', fg: L.onPremium, bg: L.premium, min: AA_TEXT },
  { name: 'light surface label on success fill', fg: L.surface, bg: L.success, min: AA_TEXT },
  { name: 'light surface label on danger fill', fg: L.surface, bg: L.danger, min: AA_TEXT },
  { name: 'light ink label on warning fill', fg: L.ink, bg: L.warning, min: AA_TEXT },
  { name: 'light live dot on ground', fg: L.live, bg: L.ground, min: AA_LARGE_OR_NON_TEXT },
  { name: 'light control outline on ground', fg: L.control, bg: L.ground, min: AA_LARGE_OR_NON_TEXT },
  { name: 'light control outline on surface', fg: L.control, bg: L.surface, min: AA_LARGE_OR_NON_TEXT },
  { name: 'light control thumb on raised track', fg: L.control, bg: L.raised, min: AA_LARGE_OR_NON_TEXT },
  { name: 'light primary lip vs ground', fg: L.pinkLip, bg: L.ground, min: AA_LARGE_OR_NON_TEXT },
  { name: 'light nav inactive label (ink2) on ground', fg: L.ink2, bg: L.ground, min: AA_TEXT },
  { name: 'dark onPink label on pink fill', fg: D.onPink, bg: D.pink, min: AA_TEXT },
  { name: 'dark white on pink (rule: rejected)', fg: '#FFFFFF', bg: D.pink, min: AA_TEXT, fail: true },
  { name: 'dark onPinkContainer on pinkContainer', fg: D.onPinkContainer, bg: D.pinkContainer, min: AA_TEXT },
  { name: 'dark pink fill as a mark on ground', fg: D.pink, bg: D.ground, min: AA_LARGE_OR_NON_TEXT },
  { name: 'dark onInverse on inverse', fg: D.onInverse, bg: D.inverse, min: AA_TEXT },
  { name: 'dark inversePink on inverse', fg: D.inversePink, bg: D.inverse, min: AA_TEXT },
  { name: 'dark ground label on success fill', fg: D.ground, bg: D.success, min: AA_TEXT },
  { name: 'dark ground label on danger fill', fg: D.ground, bg: D.danger, min: AA_TEXT },
  { name: 'dark live dot on ground', fg: D.live, bg: D.ground, min: AA_LARGE_OR_NON_TEXT },
  { name: 'dark control outline on ground', fg: D.control, bg: D.ground, min: AA_LARGE_OR_NON_TEXT },
  { name: 'dark control outline on surface', fg: D.control, bg: D.surface, min: AA_LARGE_OR_NON_TEXT },
  { name: 'dark onPremium on premium', fg: D.onPremium, bg: D.premium, min: AA_TEXT },
  { name: 'stage white on stage', fg: '#FFFFFF', bg: L.stage, min: AA_TEXT },
  { name: 'stage white on stageRaised (Feed nav pill)', fg: '#FFFFFF', bg: L.stageRaised, min: AA_TEXT },
  { name: 'stage brandPink FAB on stage', fg: L.brandPink, bg: L.stage, min: AA_LARGE_OR_NON_TEXT },
  { name: 'stage nav inactive label (dark ink2) on stage', fg: D.ink2, bg: L.stage, min: AA_TEXT },
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
    for (const hex of ['#000000', '#FFFFFF', '#8B7AA8', '#F7F5EE', BRAND_INK]) {
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

describe("the direction's measured pairs (v2, light first)", () => {
  it.each(DIRECTION_PAIRS.filter((p) => !p.fail))('$name clears $min:1', ({ fg, bg, min }) => {
    expectContrast(fg, bg, min);
  });

  it.each(DIRECTION_PAIRS.filter((p) => p.fail))(
    '$name stays below $min:1 — it is a rule, not a pairing to use',
    ({ fg, bg, min }) => {
      expect(ratio(fg, bg)).toBeLessThan(min);
    }
  );
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
