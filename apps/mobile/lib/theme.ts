export type Theme = 'light' | 'dark';

/**
 * Roxy v2 token set (design direction v2, approved by Nicole 2026-10-21).
 *
 * Source of truth: `polish/design-direction.md` › Color, and the key-by-key map
 * in `polish/proposed-tokens-v2.md`. Light is the default theme and the design
 * reference; dark ships the same roles. The feed stage is dark in both themes
 * (`stage`, see `components/feed/stageColors.ts`).
 *
 * Two rules run through the whole table and explain every name in it:
 *
 * 1. **A colour is either a fill or an ink, never both.** `pink` is what the one
 *    primary button is painted with; `pinkInk` is pink as text. In light they
 *    happen to be the same value (#C8126A carries white at 5.60:1 AND reads as
 *    text at 5.07:1 on `ground`); in dark they differ.
 * 2. **Colour carries meaning or identity, never decoration.** Warm neutrals
 *    for grounds, one pink for the action and the selected state (`pinkContainer`
 *    does the area work), identity colours for communities and events,
 *    semantics for state, butter for Premium only. Violet, indigo and lilac are
 *    banned (v0's violet-black ground and lilac secondary are gone).
 *
 * **Legacy keys.** About a thousand call sites read the v0 names (`background`,
 * `textPrimary`, `primary`, `surfaceLight`…). Each one is kept as an alias that
 * IS the v2 role which took over its job, and `__tests__/lib/themeV2.test.ts`
 * asserts the alias equals the role, so the two cannot drift. New code reads
 * the v2 names. Every value stays a `#RRGGBB` hex because call sites append
 * alpha pairs (`colors.primary + '20'`).
 *
 * The contrast ratios live in `__tests__/theme.contrast.test.ts`, which fails
 * the build instead of ageing quietly in a comment.
 *
 * src: polish/design-direction.md · v2 › Color · 2026-10-21
 * src: polish/proposed-tokens-v2.md · Colour (light / dark) · 2026-10-21
 */
export type ThemeColors = {
  // — v2 roles: surfaces, back to front ————————————————————————
  /** The page. */
  ground: string;
  /** Cards, sheets, other people's chat bubbles. */
  surface: string;
  /** Inputs, chips at rest, quiet buttons, skeletons. */
  raised: string;
  /** Rules inside settings cards and inputs only. Never a text ground. */
  line: string;
  /** Outlined controls, switch-off outline, radio rings (non-text, 3:1). */
  control: string;

  // — v2 roles: ink steps ————————————————————————————————————————
  ink: string;
  ink2: string;
  ink3: string;

  // — v2 roles: the one pink ————————————————————————————————————
  /** The action: the one primary button, Create, switch on, unread dot. */
  pink: string;
  /** Label on `pink`. White in light, dark ink in dark. */
  onPink: string;
  /** Pink as text and links. */
  pinkInk: string;
  /** The 3 dp lip under the primary button. */
  pinkLip: string;
  /** Selection and her own things: nav pill, selected chip, reaction disc, her bubbles. */
  pinkContainer: string;
  /** Ink on `pinkContainer`. Never `pink` text on it (4.35:1, fails). */
  onPinkContainer: string;
  /** The hot brand pink as a field ("You're in") and the Roxy O ring on the stage. */
  brandPink: string;
  /** Ink on `brandPink` and on every identity fill. */
  onBrandPink: string;

  // — v2 roles: inverse, premium, semantic ——————————————————————
  /** Snackbars. */
  inverse: string;
  onInverse: string;
  /** The snackbar's Undo. */
  inversePink: string;
  /** The Premium tag and lock badge only. */
  premium: string;
  onPremium: string;
  /** Warning, also the streak. A fill. */
  warning: string;
  warningInk: string;
  success: string;
  successInk: string;
  danger: string;
  dangerInk: string;
  /** Sister — the private vent space. Cool, quiet, never gamified. */
  sister: string;
  sisterInk: string;
  /** The LIVE dot. Always shown with the word. */
  live: string;
  /** The feed stage, always dark. */
  stage: string;
  /** Raised on the stage: the active nav pill on the Feed. */
  stageRaised: string;

  // — legacy keys (aliases of the v2 roles above) ——————————————————
  /** = `ground`. */
  background: string;
  /**
   * RETIRED (v2 has one ground) = `ground`.
   * Origin: Roxy 3.0 token slice (`--bg2`, docs/handoff/roxy-3.0). Superseded
   * by v2 2026-10-21; remove once no call site reads it (22 today).
   */
  backgroundAlt: string;
  /** = `raised`. ~200 call sites say `surfaceLight`. */
  surfaceLight: string;
  /** = `control`. */
  lineStrong: string;
  /** = `ink`. */
  textPrimary: string;
  /** = `ink2`. */
  textSecondary: string;
  /** = `ink3`. */
  textMuted: string;
  /** = `pink`. */
  primary: string;
  /** = `pinkInk`. */
  primaryInk: string;
  /**
   * RETIRED (lilac; violet is banned) = `ink2`: social-not-romantic UI uses
   * ink/ink2. Origin: Roxy 3.0 token slice (`--li`). Superseded by v2
   * 2026-10-21; remove once its ~20 call sites move to `ink2`.
   */
  secondary: string;
  /** RETIRED with `secondary` = `ink2`. */
  secondaryInk: string;
  /** = `warning` (the 3.0 name for the streak role). */
  gold: string;
  /** = `warningInk`. */
  goldInk: string;
  /** = `danger`. */
  error: string;
  /** = `dangerInk`. */
  errorInk: string;
  /**
   * = `pinkInk`. Legacy `roxy` call sites paint text and icon tints (nav
   * labels, links), so the alias is the pink that holds AA as text in both
   * themes. The Roxy O ring itself reads `pink` (`brandPink` on the stage).
   */
  roxy: string;
  /** The `__DEV__` panel handle. Not a product colour. */
  devPanel: string;
};

/**
 * `onBrandPink`: the ink for anything that sits ON a brand or identity fill.
 *
 * v0 used #1A0A2E here — a dark violet, banned in v2. #17080F is the v2 ink for
 * `brandPink` (4.96:1) and every identity field (≥ 4.96:1). White on #F22481 is
 * 3.93:1 and fails, which is why the hot brand pink carries dark ink.
 *
 * src: polish/design-direction.md · v2 › Color (identity fields) · 2026-10-21
 */
export const BRAND_INK = '#17080F';

/** The other half of the pair. `inkOn` picks between the two. */
export const BRAND_INK_INVERSE = '#FFFFFF';

/**
 * The logo ramp. v2 narrows its use to the wordmark and the app icon ONLY.
 * Create, the FAB, buttons, cards and pills are flat tokens now
 * (`pink`, `pinkContainer`, `raised`, identity fields).
 *
 * `linear-gradient(120°, …)` in the prototype; pass `start`/`end` to
 * `LinearGradient` to get the same angle in React Native.
 */
export const BRAND_GRADIENT = ['#FF5A2E', '#F22481', '#E0189A'] as const;

/** The LIVE dot, light value (the default theme). Dark reads `colors.live`. */
export const LIVE = '#E8481E';

/**
 * RETIRED: v2 shows LIVE as a flat dot plus the word, never a gradient pill.
 * Kept exported, both stops the flat `live` colour, so a call site that still
 * paints it renders flat. Origin: Roxy 3.0 token slice. Superseded 2026-10-21;
 * remove once no call site reads it.
 */
export const LIVE_GRADIENT = [LIVE, LIVE] as const;

/**
 * Identity fields: crests, posters, member initials, fallback covers; never
 * chrome. Each carries `onBrandPink` at ≥ 4.96:1. Pick by a stable id.
 */
export const IDENTITY = ['#F22481', '#FF7A45', '#F2C94C', '#8FC4A0', '#8FB8DE', '#E8A0BF'] as const;

/**
 * Corner radii: bimodal plus one press step (M3's corner scale trimmed).
 * `sm` 8 for inputs, code cells, small tiles and covers; `md` 20 for cards,
 * posters, bubbles and snackbars; `sheet` 28 for sheet tops; `pill` for buttons,
 * chips, the nav indicator and the FAB. `press` 12 exists only as the
 * press-morph target and the Create key. Nested radii step down 28 → 20 → 8.
 */
export const RADII = {
  pill: 999,
  sm: 8,
  /** The press-morph target and the Create key only. */
  press: 12,
  md: 20,
  /** RETIRED: merged into `md` (v2 has no 18). Kept so call sites compile. */
  lg: 20,
  /** Bottom sheets — top corners only. */
  sheet: 28,
} as const;

/** Base unit 4. Inside a group 8-12; between groups 24-32. */
export const SPACE = [4, 8, 12, 16, 20, 24, 32, 48, 64] as const;

/** Screen margin (20 on text posts). */
export const MARGIN = 16;

/**
 * Elevation, only on what floats (FAB, reaction picker, menus, snackbars:
 * `float`; sheets: `pop`). Nothing at rest has a shadow; cards separate from
 * the ground by one tone step. Shadow colours are the light ink and black.
 */
export const ELEVATION = {
  float: {
    light: { shadowColor: '#1A1216', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.16, shadowRadius: 28, elevation: 8 },
    dark: { shadowColor: '#000000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 28, elevation: 8 },
  },
  pop: {
    light: { shadowColor: '#1A1216', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 },
    dark: { shadowColor: '#000000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4 },
  },
} as const;

/** The primary button's hard lip, in dp (no blur). */
export const LIP = 3;

/**
 * Motion durations for the few places that still time a property (rail
 * scrolls, spin). Presses, sheets and pops use the M3 Expressive springs in
 * `lib/motion.ts` (`SPRING`). `pulse` is the LIVE dot only.
 *
 * `bezier` is `cubic-bezier(.32,.72,0,1)` — spread it into
 * `Easing.bezier(...MOTION.bezier)` where a CSS-style curve is unavoidable.
 */
export const MOTION = {
  /** Superseded by `SPRING.fastSpatial` for presses and chips. */
  fast: 160,
  /** Superseded by `SPRING.fastEffects` for colour changes. */
  base: 220,
  /** Superseded by `SPRING.spatial` for sheets. */
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
 * on anything whose background is a brand colour or a theme token.
 *
 * v2: it answers WHITE on the light action pink #C8126A (5.60:1) and the dark
 * ink `onBrandPink` on the dark-theme pink #F22481 (4.96:1) and on every
 * identity field — the same answers as the `onPink` token in each theme.
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
 * A deeper ink for text that sits on a gradient rather than a fill.
 *
 * Neither `BRAND_INK` (4.42:1) nor white (3.11:1 on the orange end) clears
 * 4.5:1 across all three brand stops, so the answer is a darker ink. v0's value
 * was a violet near-black (#0B0314); v2 takes the stage's warm hue, deepened
 * until it clears #E0189A (4.60:1). With the gradient narrowed to the wordmark,
 * its remaining job is the dark veil behind celebration overlays.
 */
export const BRAND_INK_DEEP = '#060505';

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
 * The rotating fills behind a community's initial on the community chips: the
 * v2 identity fields (v0's list carried a violet). Lives here so the
 * contrast gate imports the real array — every entry carries `inkOn()` at 4.5:1.
 */
export const COMMUNITY_CHIP_COLORS = IDENTITY;

/** The identity field for a stable id (community, event, archive entry). */
export function identityFor(id: string | null | undefined): string {
  const key = id ?? '';
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return IDENTITY[Math.abs(hash) % IDENTITY.length];
}

const LIGHT_ROLES = {
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
  live: LIVE,
  stage: '#0B0A0A',
  stageRaised: '#262124',
  devPanel: '#FF1493',
} as const;

const DARK_ROLES = {
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
  devPanel: '#FF1493',
} as const;

type Roles = typeof LIGHT_ROLES | typeof DARK_ROLES;

/** Legacy key → the v2 role that took its job. */
function withLegacyAliases(r: Roles): ThemeColors {
  return {
    ...r,
    background: r.ground,
    backgroundAlt: r.ground,
    surfaceLight: r.raised,
    lineStrong: r.control,
    textPrimary: r.ink,
    textSecondary: r.ink2,
    textMuted: r.ink3,
    primary: r.pink,
    primaryInk: r.pinkInk,
    secondary: r.ink2,
    secondaryInk: r.ink2,
    gold: r.warning,
    goldInk: r.warningInk,
    error: r.danger,
    errorInk: r.dangerInk,
    roxy: r.pinkInk,
  };
}

export const THEMES: Record<Theme, ThemeColors> = {
  light: withLegacyAliases(LIGHT_ROLES),
  dark: withLegacyAliases(DARK_ROLES),
};

/**
 * The 3.0 name for `surfaceLight`, which v2 calls `raised`. New code reads
 * `colors.raised`; this stays for the call sites that already use it.
 */
export function elevated(colors: ThemeColors): string {
  return colors.raised;
}

/** The v2 `float` elevation for the active theme. */
export function floatElevation(colors: ThemeColors) {
  return colors.ground === THEMES.dark.ground ? ELEVATION.float.dark : ELEVATION.float.light;
}

/** The v2 `pop` elevation (sheets) for the active theme. */
export function popElevation(colors: ThemeColors) {
  return colors.ground === THEMES.dark.ground ? ELEVATION.pop.dark : ELEVATION.pop.light;
}

/**
 * v2: the brand gradient survives only on the wordmark and the app icon. A
 * surface that used a ramp takes one flat colour; returned as two equal stops
 * so an existing LinearGradient call site renders flat with no layout change.
 */
export function flatFill(color: string): readonly [string, string] {
  return [color, color];
}

/** The flat `pink` fill that replaces BRAND_GRADIENT on action surfaces. Ink: `onPink`. */
export function pinkFill(colors: ThemeColors): readonly [string, string] {
  return flatFill(colors.pink);
}

/**
 * Backdrops and veils: the stage's warm-neutral black at an alpha. Replaces
 * v0's violet-black literals (rgba(8,3,18,…), rgba(13,5,32,…),
 * rgba(26,10,46,…), rgba(20,8,42,…)).
 */
export function scrim(alpha: number): string {
  return `rgba(11, 10, 10, ${alpha})`;
}
