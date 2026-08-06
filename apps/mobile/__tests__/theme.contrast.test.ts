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

const SURFACES = ['background', 'surface', 'surfaceLight'] as const;
type SurfaceKey = (typeof SURFACES)[number];

const THEME_NAMES: Theme[] = ['light', 'dark'];

/**
 * General-purpose text ink. These three are the ramp every screen reaches for,
 * so they are licensed on every surface and must hold AA on all of them —
 * no per-token usage rule to remember, and none to get wrong.
 *
 * textMuted lands on `surface` in `app/(tabs)/grow/index.tsx` (sisterSub,
 * emptyState, sectionHint) and on `surfaceLight` in
 * `app/(tabs)/profile/feedback.tsx` (segmentText, categoryChipText).
 */
const BODY_INK: InkKey[] = ['textPrimary', 'textSecondary', 'textMuted'];

/**
 * Semantic and brand ink that renders as small text on the theme surfaces.
 *
 * light: `primary` (chipText, rsvpBtnText, registerFooterLink …), `secondary`
 * (orientationChipText, levelBadgeText, resourceUrl), `roxy` (pointsChipText,
 * railLink, featureBadge …), `success`/`warning`/`error` (hintGood, metaPaid,
 * errorBannerText …).
 *
 * dark carries `roxy`, `success` and `warning` at AA; see the documented gap
 * below for the three dark tokens that do not.
 */
const SEMANTIC_INK_AT_AA: Record<Theme, InkKey[]> = {
  light: ['primary', 'secondary', 'roxy', 'success', 'warning', 'error'],
  dark: ['roxy', 'success', 'warning'],
};

/**
 * Documented gap, not a licence.
 *
 * In the dark theme `primary` (#C4476A), `secondary` (#8B5CF6) and `error`
 * (#EF4444) are used as small text on `background` and `surface` and land
 * between 3:1 and 4.5:1. They cannot simply be lightened: `primary` is also a
 * button fill carrying white labels, so raising its luminance breaks the other
 * half of its job. Closing this needs a separate ink-variant token
 * (`primaryInk` / `secondaryInk` / `errorInk`) wired through ~250 call sites —
 * its own slice.
 *
 * Until then they are pinned at the SC 1.4.11 floor: they may not get worse,
 * and the day one of them is fixed it moves up into SEMANTIC_INK_AT_AA.
 */
const DARK_INK_BELOW_AA: InkKey[] = ['primary', 'secondary', 'error'];
/** Those three never land on `surfaceLight`, which is borders and tracks in dark. */
const DARK_GAP_SURFACES: SurfaceKey[] = ['background', 'surface'];

/**
 * Fills that carry `BRAND_INK` — gradient icon plates and solid brand chips.
 * Every one of these used to carry `#fff`, which is why the audit found
 * 1.8:1 and 2.9:1 on three screens.
 */
const BRAND_FILLS: { fill: string; where: string }[] = [
  { fill: '#FF6A2E', where: 'BRAND_GRADIENT stop 1 — Roxy hero ring, Ask Roxy CTA, Support plate' },
  { fill: '#FF2F71', where: 'BRAND_GRADIENT stop 2 — same plates, MiniWins "attend" plate' },
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
 * cadence chips. `roxy` inverts between themes — #C24A85 wants white, #E879A6
 * wants ink — which is the whole reason `inkOn` exists.
 */
const THEME_FILLS: { theme: Theme; key: InkKey }[] = [
  { theme: 'light', key: 'primary' },
  { theme: 'light', key: 'roxy' },
  { theme: 'dark', key: 'primary' },
  { theme: 'dark', key: 'roxy' },
];

/**
 * The one brand stop that carries no ink at AA: white reaches 4.21:1 and
 * BRAND_INK reaches 4.43:1, so there is no correct answer for small text on it.
 * It is the tail of a gradient, never a flat fill, and it sits under icons and
 * the one 14px CTA label. Pinned at the non-text floor and asserted to be
 * genuinely below AA, so the exception cannot outlive the problem.
 */
const NO_INK_AT_AA = '#E81C8E';

// ---------------------------------------------------------------------------

describe('WCAG arithmetic', () => {
  it('agrees with the published anchors', () => {
    expect(ratio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(ratio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(ratio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('matches the helper shipped in lib/theme.ts', () => {
    for (const hex of ['#000000', '#FFFFFF', '#8B7AA8', '#FFF5F7', BRAND_INK]) {
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

  describe.each(SEMANTIC_INK_AT_AA[theme])('%s — semantic ink', (ink) => {
    it.each(SURFACES)(`on %s clears AA small text (${AA_TEXT}:1)`, (surface) => {
      expectContrast(colors[ink], colors[surface], AA_TEXT);
    });
  });
});

describe('dark theme — documented gap: primary, secondary and error are ink AND fill, so they sit below AA until an ink-variant token exists', () => {
  it.each(DARK_INK_BELOW_AA)(
    `%s holds the SC 1.4.11 floor (${AA_LARGE_OR_NON_TEXT}:1) on background and surface`,
    (ink) => {
      for (const surface of DARK_GAP_SURFACES) {
        expectContrast(THEMES.dark[ink], THEMES.dark[surface], AA_LARGE_OR_NON_TEXT);
      }
    }
  );

  it('is still a gap — if one of these reaches AA, move it into SEMANTIC_INK_AT_AA', () => {
    const stillBelowAA = DARK_INK_BELOW_AA.filter((ink) =>
      DARK_GAP_SURFACES.some((surface) => ratio(THEMES.dark[ink], THEMES.dark[surface]) < AA_TEXT)
    );
    expect(stillBelowAA).toEqual(DARK_INK_BELOW_AA);
  });
});

describe('brand fills carry BRAND_INK, not white', () => {
  it.each(BRAND_FILLS)(
    `$fill ($where) clears AA small text (${AA_TEXT}:1) with the ink inkOn() picks`,
    ({ fill }) => {
      expectContrast(inkOn(fill), fill, AA_TEXT);
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
    for (const { fill } of BRAND_FILLS) {
      const chosen = inkOn(fill);
      const rejected = chosen === BRAND_INK ? '#FFFFFF' : BRAND_INK;
      expect(ratio(chosen, fill)).toBeGreaterThanOrEqual(ratio(rejected, fill));
    }
  });
});

describe(`${NO_INK_AT_AA} — the deepest brand stop takes no ink at AA: icons and large text only (SC 1.4.11 / 1.4.3 large)`, () => {
  it(`clears the ${AA_LARGE_OR_NON_TEXT}:1 non-text floor with BRAND_INK`, () => {
    expectContrast(BRAND_INK, NO_INK_AT_AA, AA_LARGE_OR_NON_TEXT);
  });

  it('genuinely carries neither ink at AA — delete this block the day that changes', () => {
    expect(ratio(BRAND_INK, NO_INK_AT_AA)).toBeLessThan(AA_TEXT);
    expect(ratio('#FFFFFF', NO_INK_AT_AA)).toBeLessThan(AA_TEXT);
  });

  it('is still better served by BRAND_INK than by white', () => {
    expect(inkOn(NO_INK_AT_AA)).toBe(BRAND_INK);
  });
});
