import { THEMES, type ThemeColors } from '../../lib/theme';

/**
 * The feed pager is a cinema, and a cinema is dark in both themes.
 *
 * Every full-bleed surface here — the pager stage, the cells, the chrome, the
 * placeholders — is painted on the v2 `stage` (#0B0A0A) regardless of the
 * viewer's theme, because letterboxing a portrait video against a pale surface
 * reads as a rendering fault rather than a design.
 *
 * The trap that follows is subtle and shipped once: the ground is forced dark,
 * but anything calling `useThemeColors()` gets the *active* theme's ink. In
 * light mode that put the light `textMuted` on the dark stage — below the 4.5:1
 * this repo enforces everywhere else — on the feed's own empty state.
 *
 * So: anything drawn on the stage takes its ink from here, not from
 * `useThemeColors()`. One import, one rule, nothing for a call site to remember.
 * `STAGE` is the dark theme's roles with its grounds swapped for `stage`.
 * `__tests__/components/feedStageContrast.test.ts` holds the pairs to AA.
 *
 * src: polish/design-direction.md · v2 › Color (the always-dark feed stage) · 2026-10-21
 */
export const STAGE: ThemeColors = {
  ...THEMES.dark,
  ground: THEMES.dark.stage,
  background: THEMES.dark.stage,
  backgroundAlt: THEMES.dark.stage,
};

/** The ground every stage surface paints, including placeholders. */
export const STAGE_BG = THEMES.dark.stage;

/** Raised on the stage: the active nav pill on the Feed. */
export const STAGE_RAISED = THEMES.dark.stageRaised;
