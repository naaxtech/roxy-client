export type Theme = 'light' | 'dark';

/**
 * Roxy 3.0 token set.
 *
 * Two rules run through the whole table and explain every name in it:
 *
 * 1. **A colour is either a fill or an ink, never both.** `primary` is what a
 *    button is painted with; `primaryInk` is what that colour looks like as
 *    text on a page. They are different luminances because they have different
 *    jobs, and the pair is what lets the brand pink stay `#F22481` while small
 *    text still clears WCAG AA. The handoff prototype ships the same split
 *    (`--pk` / `--pkT`); these are those values.
 * 2. **Hue and saturation are the brand and are not negotiable; luminance is
 *    arithmetic and is.** Where a handoff value could not clear 4.5:1 as body
 *    text on every surface of its own theme, it was re-solved at the same H/S
 *    for a luminance that does, and the deviation is named in a comment.
 *
 * There are deliberately no `// 4.9:1 on white ✓` notes here. One of those was
 * how `textMuted` shipped at 3.5:1 as body copy: the note was accurate for the
 * size it was written about and silently wrong for the size it got used at.
 * The ratios live in `__tests__/theme.contrast.test.ts`, which fails the build
 * instead of ageing quietly.
 *
 * src: docs/handoff/roxy-3.0/README.md · Roxy 3.0 handoff · 2026-08-16
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · `.rxa` / `.rxa.lt` custom properties
 */
export type ThemeColors = {
  // — surfaces, back to front ————————————————————————————————
  /** Page ground. `--bg`. */
  background: string;
  /** The second ground the prototype washes headers and full-bleed media over. `--bg2`. */
  backgroundAlt: string;
  /** Cards, sheets, rails. `--sf`. */
  surface: string;
  /**
   * Raised chrome inside a card — chips, tracks, inline rows. `--sf2`.
   * Named `surfaceLight` rather than `elevated` because ~200 call sites already
   * say `surfaceLight`; `elevated` is exported below as the 3.0 alias.
   */
  surfaceLight: string;
  /** Hairlines and dividers. Never a text ground. `--ln`. */
  line: string;
  /** The divider that has to be seen — focus rings, active borders. `--ln2`. */
  lineStrong: string;

  // — ink ————————————————————————————————————————————————————
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // — brand and semantic pairs (fill / ink) ——————————————————
  /** Action pink. A fill: buttons, active chips, the reaction burst. `--pk`. */
  primary: string;
  /** The same pink as small text. `--pkT`. */
  primaryInk: string;
  /** Lilac. Everything social that is deliberately *not* romantic. `--li`. */
  secondary: string;
  secondaryInk: string;
  /** Streaks, levels, achievements. The 3.0 name for this role is "gold". `--gd`. */
  gold: string;
  goldInk: string;
  /**
   * Alias of `gold`, kept because existing call sites say `warning`.
   * The contrast test asserts the two are equal, so they cannot drift apart.
   */
  warning: string;
  success: string;
  successInk: string;
  error: string;
  errorInk: string;
  /** Sister — the private vent space. Cool, quiet, never gamified. `--si`. */
  sister: string;
  sisterInk: string;
  /** Roxy the wingwoman. Warm. Distinct from `sister` at a glance, by contract. */
  roxy: string;
  /** The `__DEV__` panel handle. Not a product colour. */
  devPanel: string;
};

/**
 * Ink for anything that sits ON a brand fill — gradient icon plates, the
 * companion FAB, chips whose background is a brand colour.
 *
 * White is the reflex and it is wrong here: `#FFFFFF` on `#FF5A2E` is 2.9:1,
 * which fails even the 3:1 bar SC 1.4.11 sets for icons. The brand ramp is
 * light, so the legible ink is dark. `#1A0A2E` is `THEMES.dark.backgroundAlt`
 * — already in the palette, so the fix costs no new colour.
 *
 * The handoff prototype paints `--onpk:#FFF8FB` on the pink fill instead, which
 * measures 3.75:1 and does not clear AA for a button label. `inkOn()` is the
 * shipped rule and it wins; this is the one place the build deliberately does
 * not match the prototype.
 *
 * src: https://www.w3.org/TR/WCAG22/#contrast-minimum · SC 1.4.3 / 1.4.11 · 2026-08-06
 */
export const BRAND_INK = '#1A0A2E';

/** The other half of the pair. `inkOn` picks between the two. */
export const BRAND_INK_INVERSE = '#FFFFFF';

/**
 * The logo ramp. Reserved for identity — the wordmark, the ＋ create button,
 * the Roxy FAB. Not decoration: a gradient anywhere else reads as "live".
 *
 * `linear-gradient(120°, …)` in the prototype; pass `start`/`end` to
 * `LinearGradient` to get the same angle in React Native.
 */
export const BRAND_GRADIENT = ['#FF5A2E', '#F22481', '#E0189A'] as const;

/** Live and urgent only — LIVE pills, a room that is on air, a timer running out. */
export const LIVE_GRADIENT = ['#FF5C3D', '#F22481'] as const;

/**
 * Corner radii. The prototype uses five steps and no others; a sixth value in a
 * StyleSheet is a bug, not a nuance.
 */
export const RADII = {
  /** Pills and chips. */
  pill: 999,
  /** Inline controls, inputs, small tiles. */
  sm: 10,
  /** The default card. */
  md: 15,
  /** Feature cards, media tiles. */
  lg: 18,
  /** Bottom sheets — top corners only. */
  sheet: 26,
} as const;

/**
 * Motion. Two durations and one curve; anything else is improvisation.
 *
 * `bezier` is `cubic-bezier(.32,.72,0,1)` from the prototype — spread it into
 * `Easing.bezier(...MOTION.bezier)`.
 */
export const MOTION = {
  /** Chips, toggles, reaction burst. */
  fast: 160,
  /** Screen-level fades, rail scrolls. */
  base: 220,
  /** Sheets in and out. */
  sheet: 320,
  /** The live pulse. */
  pulse: 1400,
  bezier: [0.32, 0.72, 0, 1] as const,
} as const;

const HEX = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function linearise(component: number): number {
  const c = component / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * WCAG 2.2 relative luminance. Twelve lines of arithmetic beat a dependency,
 * and `__tests__/theme.contrast.test.ts` re-implements the same maths
 * independently — a bug in here cannot make the gate pass.
 *
 * src: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance · 2026-08-06
 */
export function relativeLuminance(hex: string): number {
  if (!HEX.test(hex)) throw new Error(`relativeLuminance: not a hex colour: ${hex}`);
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  const [r, g, b] = [0, 2, 4].map((i) => linearise(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, 1:1 … 21:1. Order of arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The legible ink for a given fill. Use this instead of hardcoding `'#fff'`
 * on anything whose background is a brand colour or a theme token — `roxy` is
 * `#AF3B74` in light and `#E879A6` in dark, and those two want opposite inks.
 *
 * It does not promise 4.5:1: a mid-luminance fill such as `#E0189A` carries no
 * ink at AA. `__tests__/theme.contrast.test.ts` names every fill that falls in
 * that band and holds it to icons and large text only.
 */
export function inkOn(fill: string): string {
  return contrastRatio(BRAND_INK, fill) >= contrastRatio(BRAND_INK_INVERSE, fill)
    ? BRAND_INK
    : BRAND_INK_INVERSE;
}

/**
 * A deeper brand ink, for text that sits on a gradient rather than a fill.
 *
 * `BRAND_INK` is `#1A0A2E` and answers 4.74:1 on the ramp's middle stop — which
 * is why measuring against that stop feels safe and is not. On `#E0189A` at the
 * end of the ramp the same ink measures 4.23:1, and the trailing glyphs of a
 * centred label land there. Neither brand ink clears 4.5:1 across all three
 * stops (white is worse: 3.11:1 on the orange end), so the answer is a darker
 * ink rather than a choice between the two.
 *
 * Luminance only — the hue and saturation of `BRAND_INK` are held, the same
 * departure this file already documents for `textMuted` and `roxy` in light.
 * It measures 6.51 / 5.15 / 4.60 across the ramp.
 */
export const BRAND_INK_DEEP = '#0B0314';

/** Every ink `inkOnGradient` may answer with, darkest last. */
const GRADIENT_INKS = [BRAND_INK_INVERSE, BRAND_INK, BRAND_INK_DEEP] as const;

/**
 * The contrast a colour achieves against the WORST stop of a gradient.
 *
 * The only number that matters for a label on a ramp: a glyph does not get to
 * choose which stop it lands on.
 */
export function worstContrast(ink: string, stops: readonly string[]): number {
  return stops.reduce((worst, stop) => Math.min(worst, contrastRatio(ink, stop)), Infinity);
}

/**
 * Ink for text drawn over a multi-stop gradient.
 *
 * Returns the LIGHTEST ink that clears `threshold` against every stop, so a
 * design is never darkened further than its contrast requires. `threshold`
 * defaults to 4.5 (SC 1.4.3, text); pass 3 for an icon or other non-text mark
 * (SC 1.4.11).
 *
 * When nothing clears the bar it returns the best available ink rather than
 * throwing. A palette that cannot be made accessible is a design problem, and
 * the contrast test suite is where it should fail — not at runtime, in a woman's
 * hand, as a blank screen where a button used to be.
 *
 * src: https://www.w3.org/TR/WCAG22/#contrast-minimum · SC 1.4.3 · 2026-08-19
 * src: https://www.w3.org/TR/WCAG22/#non-text-contrast · SC 1.4.11 · 2026-08-19
 */
export function inkOnGradient(stops: readonly string[], threshold = 4.5): string {
  const clears = GRADIENT_INKS.find((ink) => worstContrast(ink, stops) >= threshold);
  if (clears) return clears;

  return GRADIENT_INKS.reduce((best, ink) =>
    worstContrast(ink, stops) > worstContrast(best, stops) ? ink : best
  );
}

/**
 * The rotating fills behind a community's initial on the community chips. Lives
 * here rather than inline in the screen so the contrast gate can import the real
 * array instead of a copy of it — every entry has to carry `inkOn()` at 4.5:1.
 */
export const COMMUNITY_CHIP_COLORS = [
  '#FF6A2E', '#7B45F5', '#FF2F71', '#F472B6', '#BD3D60', '#FF8A3D',
] as const;

export const THEMES: Record<Theme, ThemeColors> = {
  dark: {
    background: '#14082A',
    backgroundAlt: '#1A0A2E',
    surface: '#211039',
    surfaceLight: '#2D1B4E',
    line: '#3D2B5E',
    lineStrong: '#55407F',

    textPrimary: '#F7F3FC',
    textSecondary: '#C6B5E4',
    textMuted: '#9C89C2',

    primary: '#F22481',
    primaryInk: '#FF7AB5',
    secondary: '#A78BFA',
    secondaryInk: '#C9B9F5',
    gold: '#F5B73D',
    goldInk: '#FFD37E',
    warning: '#F5B73D',
    success: '#2FC97E',
    successInk: '#7CE0AC',
    error: '#EF4444',
    // Handoff names no error colour, so this pair is ours. `#EF4444` is the
    // shipped fill; the ink is the same hue lifted from L 60% to L 65% to clear
    // 4.5:1 on `surfaceLight`, where the fill measures 3.98:1.
    errorInk: '#F15B5B',
    sister: '#8E9BFF',
    sisterInk: '#BCC5FF',
    roxy: '#E879A6',
    devPanel: '#FF1493',
  },
  light: {
    background: '#FAF2F6',
    backgroundAlt: '#FFFDFE',
    surface: '#FFFDFE',
    surfaceLight: '#F6EAF2',
    line: '#EBDAE7',
    lineStrong: '#D9C2D6',

    textPrimary: '#241234',
    textSecondary: '#5D4980',
    // Handoff value is #8672A8 (L 55%), which measures 3.69:1 on `surfaceLight`
    // and 4.22:1 on `surface` — below AA on the two grounds body copy most
    // often lands on. Same hue (262°) and saturation (24%), re-solved at L 48%.
    textMuted: '#735D97',

    primary: '#D81368',
    primaryInk: '#C11060',
    secondary: '#7C5CE0',
    secondaryInk: '#6547C8',
    gold: '#B07A10',
    goldInk: '#8A5E06',
    warning: '#B07A10',
    success: '#178A4C',
    successInk: '#0E7A40',
    error: '#B91C1C',
    errorInk: '#B91C1C',
    sister: '#6474E8',
    sisterInk: '#4D5BD0',
    // Was #B83E7A, which measures exactly 4.50:1 on the new `surfaceLight` —
    // a value that rounds either side of the bar depending on the arithmetic.
    // Same hue (330°), re-solved at L 46% for margin.
    roxy: '#AF3B74',
    devPanel: '#FF1493',
  },
};

/**
 * The 3.0 name for `surfaceLight`. New code should read `elevated(colors)`;
 * the key stays `surfaceLight` until the last call site moves.
 */
export function elevated(colors: ThemeColors): string {
  return colors.surfaceLight;
}
