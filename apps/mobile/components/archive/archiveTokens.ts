import { THEMES, type ThemeColors } from '../../lib/theme';
import type { ScoreTone } from '../../lib/archive';

/**
 * The Archive's visual vocabulary, derived from theme tokens rather than pasted
 * from the prototype's CSS.
 *
 * The prototype writes its colours as literals — `scoreBg` is a hard-coded
 * `linear-gradient(120deg,#178A4C,#2FC97E)`, `--pkBg` is a hard-coded
 * `rgba(242,36,129,.16)`. Those exact values already exist in `lib/theme.ts`
 * under names, so copying the hexes would create a second place the brand
 * lives, and the two would drift the first time a token moved. Everything here
 * is computed from `ThemeColors`.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · behaviour 1978–2010 · 2026-09-01
 */

/** The prototype's `scoreIc`: ✿ at ≥75, ❋ at ≥50, 🥀 below. */
export const SCORE_ICON = {
  good: '✿',
  mixed: '❋',
  poor: '🥀',
} as const satisfies Record<Exclude<ScoreTone, 'none'>, string>;

/**
 * The two-stop ramp behind a score pill.
 *
 * For each band the prototype's two stops happen to BE the light and dark
 * values of one role — `#178A4C` → `#2FC97E` is `success` in both themes. So
 * the gradient is that role read from both palettes, which keeps the ramp
 * identical to the design while leaving one place to change it.
 */
export const SCORE_GRADIENT = {
  good: [THEMES.light.success, THEMES.dark.success],
  mixed: [THEMES.light.gold, THEMES.dark.gold],
  poor: [THEMES.light.primary, THEMES.dark.primary],
} as const satisfies Record<Exclude<ScoreTone, 'none'>, readonly [string, string]>;

/** No icon below the gate: an unscored entry has no verdict to illustrate. */
export function scoreIcon(tone: ScoreTone): string | null {
  return tone === 'none' ? null : SCORE_ICON[tone];
}

export function scoreGradient(tone: ScoreTone): readonly [string, string] | null {
  return tone === 'none' ? null : SCORE_GRADIENT[tone];
}

/**
 * The ring's stroke, resolved INSIDE the active theme.
 *
 * The prototype's `enRing` is `c('#2FC97E','#178A4C')` — one role, picked per
 * theme, not a ramp across both. A ring painted with the other theme's value of
 * the same role is a real and easy mistake: it still looks like "the green one"
 * in isolation and fails contrast against the surface it is actually on.
 */
export function scoreRingColor(tone: ScoreTone, colors: ThemeColors): string {
  if (tone === 'good') return colors.success;
  if (tone === 'mixed') return colors.gold;
  if (tone === 'poor') return colors.primary;
  // Below the gate there is no score to draw, so the ring is just the stroke
  // the rest of the card uses.
  return colors.line;
}

// ── Ring maths ───────────────────────────────────────────────────────────────

/** `enDeg: Math.round(ea.pct*3.6)+'deg'` — a full turn is 100%. */
export const RING_DEGREES_PER_PERCENT = 3.6;

export function ringSweepDegrees(percent: number): number {
  return percent * RING_DEGREES_PER_PERCENT;
}

/**
 * The same sweep as an SVG dash pair.
 *
 * React Native has no conic gradient, so the prototype's `conic-gradient(... Ndeg ...)`
 * becomes a stroked circle whose dash is `[filled, remainder]`. Returning the
 * pair rather than a single length keeps the caller from having to know the
 * circumference, which is where an off-by-one ring comes from.
 */
export function ringDash(percent: number, radius: number): [number, number] {
  const circumference = 2 * Math.PI * radius;
  const on = (percent / 100) * circumference;
  return [on, circumference - on];
}

// ── Tints ────────────────────────────────────────────────────────────────────

/**
 * Which palette is in play, asked of the palette itself.
 *
 * Deliberately not `useThemeStore()`: these helpers are pure and get called
 * from tests and from render alike, and a tint that reads a store is a tint
 * that cannot be checked against both themes in one test run.
 */
export function isDarkTheme(colors: ThemeColors): boolean {
  return colors.background === THEMES.dark.background;
}

function parseHex(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  // Throwing beats returning a default: a mistyped token would otherwise emit
  // `rgba(NaN, NaN, NaN, 0.16)`, which most renderers draw as transparent — an
  // invisible chip that looks like a layout bug rather than a colour bug.
  if (!match) throw new Error(`archiveTokens: expected a #rrggbb colour, got "${hex}"`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Dark tints sit heavier than light ones — the prototype's .16 vs .09. */
const FILL_ALPHA = { dark: 0.16, light: 0.09 } as const;
const LINE_ALPHA = { dark: 0.4, light: 0.3 } as const;

/** `--pkBg` / `--liBg`: a wash of the role behind a chip. */
export function tintFill(colors: ThemeColors, role: string): string {
  return withAlpha(role, isDarkTheme(colors) ? FILL_ALPHA.dark : FILL_ALPHA.light);
}

/** `--pkLn` / `--liLn`: the same role as a hairline. */
export function tintLine(colors: ThemeColors, role: string): string {
  return withAlpha(role, isDarkTheme(colors) ? LINE_ALPHA.dark : LINE_ALPHA.light);
}

// ── Content notes ────────────────────────────────────────────────────────────

export const NOTE_PALETTE_SLOTS = 3;

export type NotePaletteEntry = { bg: string; line: string; ink: string };

/**
 * The prototype's `cwPal` rotation — pink, lilac, neutral — with agreement
 * overriding it.
 *
 * A note she has agreed with is pink whatever slot it landed in, because the
 * rotation is decoration and the agreement is state. Letting position win would
 * mean the same note looked different depending on how many notes sat above it,
 * which is the one thing a colour that means something must not do.
 */
export function notePalette(
  colors: ThemeColors,
  index: number,
  agreed: boolean
): NotePaletteEntry {
  if (agreed) {
    return {
      bg: tintFill(colors, colors.primary),
      line: tintLine(colors, colors.primaryInk),
      ink: colors.primaryInk,
    };
  }

  const slot = ((index % NOTE_PALETTE_SLOTS) + NOTE_PALETTE_SLOTS) % NOTE_PALETTE_SLOTS;
  if (slot === 0) {
    return {
      bg: tintFill(colors, colors.primary),
      line: tintLine(colors, colors.primaryInk),
      ink: colors.primaryInk,
    };
  }
  if (slot === 1) {
    return {
      bg: tintFill(colors, colors.secondary),
      line: tintLine(colors, colors.secondaryInk),
      ink: colors.secondaryInk,
    };
  }
  return { bg: colors.surfaceLight, line: colors.line, ink: colors.textSecondary };
}
