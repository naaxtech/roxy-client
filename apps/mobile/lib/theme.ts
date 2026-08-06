export type Theme = 'light' | 'dark';

export type ThemeColors = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceLight: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  success: string;
  warning: string;
  error: string;
  roxy: string;
  devPanel: string;
};

/**
 * Ink for anything that sits ON a brand fill — gradient icon plates, the
 * companion FAB, chips whose background is a brand colour.
 *
 * White is the reflex and it is wrong here: `#FFFFFF` on `#FF6A2E` is 2.86:1,
 * which fails even the 3:1 bar SC 1.4.11 sets for icons. The brand ramp is
 * light, so the legible ink is dark. `#1A0A2E` is `THEMES.dark.background` —
 * already in the palette, so the fix costs no new colour.
 *
 * src: https://www.w3.org/TR/WCAG22/#contrast-minimum · SC 1.4.3 / 1.4.11 · 2026-08-06
 */
export const BRAND_INK = '#1A0A2E';

/** The other half of the pair. `inkOn` picks between the two. */
export const BRAND_INK_INVERSE = '#FFFFFF';

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
 * `#B83E7A` in light and `#E879A6` in dark, and those two want opposite inks.
 *
 * It does not promise 4.5:1: a mid-luminance fill such as `#E81C8E` carries no
 * ink at AA. `__tests__/theme.contrast.test.ts` names every fill that falls in
 * that band and holds it to icons and large text only.
 */
export function inkOn(fill: string): string {
  return contrastRatio(BRAND_INK, fill) >= contrastRatio(BRAND_INK_INVERSE, fill)
    ? BRAND_INK
    : BRAND_INK_INVERSE;
}

/**
 * The rotating fills behind a community's initial on the Grow chips. Lives here
 * rather than inline in the screen so the contrast gate can import the real
 * array instead of a copy of it — every entry has to carry `inkOn()` at 4.5:1.
 *
 * The violet and the rose track `light.secondary` and `light.primary`; they were
 * `#8B5CF6` and `#C4476A`, which carry neither ink at AA.
 */
export const COMMUNITY_CHIP_COLORS = [
  '#FF6A2E', '#7B45F5', '#FF2F71', '#F472B6', '#BD3D60', '#FF8A3D',
] as const;

/**
 * Hues are the brand and are not negotiable; luminance is arithmetic and is.
 * Every value below was chosen by holding H and S and solving for a relative
 * luminance that clears 4.5:1 against all three surfaces of its own theme.
 *
 * There are deliberately no `// 4.9:1 on white ✓` comments here any more. One
 * of those was how `textMuted` shipped at 3.5:1 as body copy: the note was
 * accurate for the size it was written about and silently wrong for the size it
 * got used at. The ratios live in `__tests__/theme.contrast.test.ts`, which
 * fails the build instead of ageing quietly.
 */
export const THEMES: Record<Theme, ThemeColors> = {
  dark: {
    primary: '#C4476A',
    secondary: '#8B5CF6',
    accent: '#F472B6',
    background: '#1a0a2e',
    surface: '#2d1b4e',
    surfaceLight: '#3d2b5e',
    textPrimary: '#FFFFFF',
    // Was #8B7AA8 (L 0.2224) — 3.95:1 on surface, 3.19:1 on surfaceLight, i.e.
    // failing on every card in the app's default theme. Same hue (262°), same
    // saturation, lifted to L 0.3452 for 4.63:1 at the worst surface.
    textMuted: '#A699BC',
    textSecondary: '#C4B5D4',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    roxy: '#E879A6',
    devPanel: '#FF1493',
  },
  light: {
    // Was #C4476A (L 0.1728) — 4.41:1 on background, 4.27:1 on surfaceLight.
    primary: '#BD3D60',
    // Was #8B5CF6 (L 0.1980) — 4.23:1 even on plain white.
    secondary: '#7B45F5',
    accent: '#F472B6',
    background: '#FFF5F7',
    surface: '#FFFFFF',
    surfaceLight: '#FFF0F3',
    textPrimary: '#1A0A2E',
    // Was #8B7AA8 (L 0.2224) — 3.61:1 on background, and the token the audit
    // found eight times on one screen. L 0.1222 gives 5.52:1 at the worst.
    textMuted: '#6B5A88',
    textSecondary: '#6B4C6B',
    success: '#047857',
    warning: '#B45309',
    error: '#B91C1C',
    // Was #C24A85 (L 0.1806) — 4.26:1 on background, 4.12:1 on surfaceLight.
    roxy: '#B83E7A',
    devPanel: '#FF1493',
  },
};
