import { Ionicons } from '@expo/vector-icons';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

/**
 * The brand ramp, re-exported so the shell's call sites keep reading in the
 * shell's own vocabulary. The array itself now lives in `lib/theme.ts` — the
 * consolidation this comment used to ask for, done by the 3.0 token slice. The
 * values changed with it: the ramp is `#FF5A2E → #F22481 → #E0189A`.
 */
export { BRAND_GRADIENT } from '../../lib/theme';

/**
 * Every interactive element in the shell is measured, not padded by hitSlop.
 *
 * The rule, the numbers and their sources now live in `lib/touchTargets.ts`,
 * because a doctrine stated in one directory and unheard in another is how the
 * feed shipped fifteen `hitSlop` props under a comment banning them. This alias
 * stays so the shell's call sites read in the shell's own vocabulary.
 *
 * It is 48, not the 44 this file used to declare. The 44 was cited to Google's
 * Accessibility Test Framework, and ATF's `TouchTargetSizeCheck` hardcodes 48;
 * 44 is Apple's HIG figure and WCAG's Level AAA SC 2.5.5 figure. See
 * `lib/touchTargets.ts` for the primary sources.
 */
export const TAB_MIN_TOUCH = MIN_TOUCH_TARGET;

/**
 * The floating pill never sits flush with the screen edge — it is inset on all
 * three sides so it reads as an object over the app rather than a bar welded to
 * the chassis. Netflix and Discord both do this; a full-width bar was the thing
 * the peg study argued against.
 */
export const PILL_INSET = 14;

/** Minimum gap under the pill when the device reports no bottom inset at all. */
export const PILL_MIN_BOTTOM = 12;

/**
 * Alpha, as a hex pair, for the tint behind the active slot.
 *
 * It is not a decorative number. The active label is `colors.roxy` at 11pt, so
 * it needs 4.5:1 against whatever it ends up sitting on — and the tint lightens
 * that surface toward `roxy` itself, which *reduces* the ratio. At `1F` the
 * light theme measures 4.42:1 and fails; at `14` it measures 4.69:1 (dark:
 * 4.97:1). `__tests__/components/nav/FloatingTabBar.test.tsx` composites the
 * tint over both themes and holds the result to the bar.
 *
 * src: https://www.w3.org/TR/WCAG22/#contrast-minimum · SC 1.4.3 · 2026-08-07
 */
export const ACTIVE_TINT_ALPHA = '14';

type IoniconName = keyof typeof Ionicons.glyphMap;

export type NavSlot =
  | {
      kind: 'route';
      /** The Expo Router folder this slot drives. */
      routeName: string;
      label: string;
      icon: IoniconName;
      iconInactive: IoniconName;
    }
  | { kind: 'action'; key: string; label: string; icon: IoniconName };

/*
 * `NAV_SLOTS` and `HOME_CATEGORIES` used to live here.
 *
 * NAV_SLOTS described the five-tab bar (Home · Rooms · ⊕ · Inbox · You) and
 * still named a `profile` route that had already been renamed to `you`. It had
 * zero consumers — `FloatingTabBar` reads `NAV_SLOTS_3` — so it was a list of
 * three dead routes that nothing would ever have caught.
 *
 * HOME_CATEGORIES was the pill row at the top of the Grow tab, and three of its
 * four hrefs pointed into `connect` and `build`. Its only renderer was
 * `grow/index.tsx`. Both are gone with the tabs they described; the shape lives
 * on as `NAV_SLOTS_3` in `navSlots3.ts`, whose test asserts every route name
 * against the filesystem so this class of rot cannot come back silently.
 */

/**
 * How long the active-slot indicator takes to cross-fade. Zero under Reduce
 * Motion, which makes the indicator appear instantly rather than not at all —
 * the state still has to be visible, only the transition goes away.
 */
export function indicatorFadeDuration(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 160;
}
