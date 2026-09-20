/**
 * Roxy 3.0 type system.
 *
 * A design system that ships only colour is how an app ends up with sixteen
 * distinct font sizes across nine screens: every author picks a plausible
 * number because there is nothing to pick *from*. So the scale is a closed set
 * of seven steps, and `__tests__/typography.test.ts` asserts the count — adding
 * an eighth is a decision someone has to make on purpose, not by typing `14`.
 *
 * Two families, per the handoff:
 *  - **Outfit** (600–800) is display: titles, numerals, anything wordmark-ish.
 *  - **Figtree** (400–700) is text: every label, body and control in the UI.
 *
 * The string values are the family names `expo-font` registers, which are the
 * export names from `@expo-google-fonts/*`. `hooks/useAppFonts.ts` owns loading
 * them; if that load fails the app still renders and React Native falls back to
 * the system face, so a font CDN hiccup degrades type rather than blanking the
 * screen.
 *
 * src: docs/handoff/roxy-3.0/README.md · Roxy 3.0 handoff · 2026-08-16
 * src: https://github.com/expo/google-fonts/tree/master/font-packages/outfit · @expo-google-fonts/outfit 0.4.3 · 2026-08-16
 * src: https://github.com/expo/google-fonts/tree/master/font-packages/figtree · @expo-google-fonts/figtree 0.4.1 · 2026-08-16
 */

export const FONTS = {
  /** Outfit. Titles, numerals, the streak count, rank digits. */
  display: {
    semibold: 'Outfit_600SemiBold',
    bold: 'Outfit_700Bold',
    extrabold: 'Outfit_800ExtraBold',
  },
  /** Figtree. Everything else. */
  text: {
    regular: 'Figtree_400Regular',
    medium: 'Figtree_500Medium',
    semibold: 'Figtree_600SemiBold',
    bold: 'Figtree_700Bold',
  },
} as const;

/** Every family the app is allowed to name, flattened — used by the loader. */
export const FONT_FAMILIES = [
  ...Object.values(FONTS.display),
  ...Object.values(FONTS.text),
] as const;

export type TypeStep = {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  letterSpacing?: number;
};

/**
 * The seven steps. Sizes are the prototype's px on a 412pt-wide frame, which
 * React Native reads as dp one-for-one.
 *
 * Nothing here is smaller than 10: below that the label stops being readable at
 * arm's length, and the prototype's own floor is 10 for the same reason. Touch
 * targets are a separate rule (≥44pt) and live with the components.
 */
export const TYPE = {
  /** LIVE pills, counters, rank labels, the ✿ count under a react. */
  micro: {
    fontSize: 10,
    lineHeight: 13,
    fontFamily: FONTS.text.semibold,
    letterSpacing: 0.4,
  },
  /** Timestamps, attribution, chip labels, helper text. */
  caption: { fontSize: 12, lineHeight: 16, fontFamily: FONTS.text.medium },
  /** Feed body and dense list rows — the densest thing that is still prose. */
  body: { fontSize: 13, lineHeight: 19, fontFamily: FONTS.text.regular },
  /** Primary body: message bubbles, sheet copy, settings rows. */
  bodyLg: { fontSize: 15, lineHeight: 22, fontFamily: FONTS.text.regular },
  /** Card titles and rail headers. */
  title: { fontSize: 17, lineHeight: 22, fontFamily: FONTS.display.semibold },
  /** Screen titles and sheet headers. */
  headline: { fontSize: 21, lineHeight: 27, fontFamily: FONTS.display.bold },
  /** Hero numerals — streak count, Top 10 rank, price on a product sheet. */
  display: {
    fontSize: 28,
    lineHeight: 33,
    fontFamily: FONTS.display.extrabold,
    letterSpacing: -0.4,
  },
} as const satisfies Record<string, TypeStep>;

export type TypeStepName = keyof typeof TYPE;
