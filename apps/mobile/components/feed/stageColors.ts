import { THEMES, type ThemeColors } from '../../lib/theme';

/**
 * The feed pager is a cinema, and a cinema is dark in both themes.
 *
 * Every full-bleed surface here — the pager stage, the cells, the chrome, the
 * placeholders — is painted on `THEMES.dark.background` regardless of the
 * viewer's theme, because letterboxing a portrait video against a pale surface
 * reads as a rendering fault rather than a design.
 *
 * The trap that follows is subtle and shipped: the ground is forced dark, but
 * anything calling `useThemeColors()` gets the *active* theme's ink. In light
 * mode that put `textMuted` (#735D97) on `#14082A` — 3.4:1, below the 4.5:1
 * this repo enforces everywhere else — on the feed's own empty state.
 *
 * So: anything drawn on the stage takes its ink from here, not from
 * `useThemeColors()`. One import, one rule, nothing for a call site to remember.
 * `__tests__/components/feedStageContrast.test.ts` holds the pairs to AA.
 */
export const STAGE: ThemeColors = THEMES.dark;

/** The ground every stage surface paints, including placeholders. */
export const STAGE_BG = THEMES.dark.background;
