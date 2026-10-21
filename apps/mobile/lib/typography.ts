import type { TextStyle } from 'react-native';

/**
 * Roxy v2 type system (design direction v2, approved by Nicole 2026-10-21).
 *
 * Three families, strict roles:
 *  - **Geologica** 700/800 is display: titles, headlines, text posts, moments.
 *  - **Commissioner** 400/500/600 is text: every label, body and control.
 *  - **IBM Plex Mono** 500 is for codes only (invite, ticket, member numbers).
 * Chosen partly for script coverage: Geologica and Commissioner keep one voice
 * across Latin, Vietnamese, Cyrillic and Greek, where v0's Outfit + Figtree fell
 * back glyph by glyph to the system face.
 *
 * The scale is a closed set; `__tests__/typography.test.ts` asserts it by name,
 * so a tenth step is a decision someone makes on purpose, not by typing `14`.
 * At most four steps on one screen. Sentence case; no tracked capitals.
 *
 * **v0 names.** `micro` and `caption` merged into `meta`, `bodyLg` into `body`;
 * `title`, `headline` and `display` keep their names with v2 values. The
 * aliases keep ~450 call sites compiling and move them with the scale.
 *
 * The string values are the family names `expo-font` registers (the export
 * names from `@expo-google-fonts/*`). `hooks/useAppFonts.ts` owns loading them;
 * if that load fails the app still renders in the system face.
 *
 * src: polish/design-direction.md · v2 › Typography · 2026-10-21
 * src: @expo-google-fonts/geologica 0.4.2 · commissioner 0.4.1 · ibm-plex-mono 0.4.1
 */

export const FONTS = {
  /** Geologica. Titles, headlines, text posts, moments. v2 has no 600 display face. */
  display: {
    /** v0 key (Outfit 600). v2 has no display 600, so it is the 700 face. */
    semibold: 'Geologica_700Bold',
    bold: 'Geologica_700Bold',
    extrabold: 'Geologica_800ExtraBold',
  },
  /** Commissioner. Everything else. */
  text: {
    regular: 'Commissioner_400Regular',
    medium: 'Commissioner_500Medium',
    semibold: 'Commissioner_600SemiBold',
    /** v0 key (Figtree 700). v2 text tops out at 600 (the emphasized weight). */
    bold: 'Commissioner_600SemiBold',
  },
  /** IBM Plex Mono. Codes only. */
  mono: {
    medium: 'IBMPlexMono_500Medium',
  },
} as const;

/** Every family the app is allowed to name, de-duplicated — used by the loader. */
export const FONT_FAMILIES: readonly string[] = Array.from(
  new Set<string>([
    ...Object.values(FONTS.display),
    ...Object.values(FONTS.text),
    ...Object.values(FONTS.mono),
  ]),
);

/**
 * SUPERSEDED families (v0 Roxy 3.0: Outfit display, Figtree text). No caller
 * names them any more, so the loader no longer downloads them; the packages
 * stay installed so a rollback is one line. Origin: Roxy 3.0 type slice
 * (`git log -S Outfit_600SemiBold`). Remove the packages once v2 has shipped.
 */
export const LEGACY_FONT_FAMILIES = [
  'Outfit_600SemiBold',
  'Outfit_700Bold',
  'Outfit_800ExtraBold',
  'Figtree_400Regular',
  'Figtree_500Medium',
  'Figtree_600SemiBold',
  'Figtree_700Bold',
] as const;

export type TypeStep = {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  letterSpacing?: number;
  fontVariant?: TextStyle['fontVariant'];
};

/** Tabular figures for every number that updates (counts, times, prices). */
export const TABULAR: { fontVariant: NonNullable<TextStyle['fontVariant']> } = {
  fontVariant: ['tabular-nums'],
};

const META: TypeStep = {
  fontSize: 12,
  lineHeight: 16,
  fontFamily: FONTS.text.medium,
  fontVariant: TABULAR.fontVariant,
};
const BODY: TypeStep = { fontSize: 15, lineHeight: 22, fontFamily: FONTS.text.regular };
const TITLE: TypeStep = {
  fontSize: 20,
  lineHeight: 24,
  fontFamily: FONTS.display.bold,
  letterSpacing: -0.2,
};
const HEADLINE: TypeStep = {
  fontSize: 28,
  lineHeight: 32,
  fontFamily: FONTS.display.extrabold,
  letterSpacing: -0.4,
};
const DISPLAY: TypeStep = {
  fontSize: 40,
  lineHeight: 42,
  fontFamily: FONTS.display.extrabold,
  letterSpacing: -0.8,
};

export type TypeStepName =
  | 'meta'
  | 'body'
  | 'label'
  | 'button'
  | 'title'
  | 'headline'
  | 'display'
  | 'moment'
  | 'mono'
  | 'micro'
  | 'caption'
  | 'bodyLg';

/**
 * The v2 steps (dp). Sizes are the direction's, which React Native reads as
 * dp one-for-one.
 */
export const TYPE: Record<TypeStepName, TypeStep> = {
  /** Timestamps, counts, helper text; the floor. Tabular figures. */
  meta: META,
  /** Captions, messages, rows. The feed body (v0: 13). */
  body: BODY,
  /** Row titles and chips. */
  label: { fontSize: 15, lineHeight: 20, fontFamily: FONTS.text.semibold },
  /** Button labels. */
  button: { fontSize: 16, lineHeight: 20, fontFamily: FONTS.text.semibold },
  /** Screen, sheet and card titles. */
  title: TITLE,
  /** Discover / Messages / You titles, Roxy AI's greeting, long text posts. */
  headline: HEADLINE,
  /** Text posts of 30-80 characters, small poster titles. */
  display: DISPLAY,
  /** Text posts under 30 characters, "You're in", poster titles. */
  moment: {
    fontSize: 56,
    lineHeight: 56,
    fontFamily: FONTS.display.extrabold,
    letterSpacing: -1.4,
  },
  /** Codes only. */
  mono: { fontSize: 13, lineHeight: 18, fontFamily: FONTS.mono.medium, letterSpacing: 0.5 },

  /** v0 `micro` (10, tracked) — merged into `meta`. */
  micro: META,
  /** v0 `caption` (12) — merged into `meta`. */
  caption: META,
  /** v0 `bodyLg` (15/22) — merged into `body`. */
  bodyLg: BODY,
};

/** One weight up within the step's own family. */
const HEAVIER: Record<string, string> = {
  [FONTS.text.regular]: FONTS.text.semibold,
  [FONTS.text.medium]: FONTS.text.semibold,
  [FONTS.display.bold]: FONTS.display.extrabold,
};

/**
 * The emphasized twin of a step (M3 Expressive): one weight up, same size.
 * Use it for state, not decoration — unread rows, the selected chip and nav
 * label, button labels, her own reaction count. At most one per row.
 */
export function emphasized(name: TypeStepName): TypeStep {
  const step = TYPE[name];
  return { ...step, fontFamily: HEAVIER[step.fontFamily] ?? step.fontFamily };
}
