import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import type { NavIconName } from './NavIcons';

/**
 * The brand ramp, re-exported for any shell caller still reading it from here.
 * v2 narrows the gradient to the wordmark and the app icon: the Create key is
 * a flat `pink` key now and no longer reads this.
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
 * The M3 Expressive flexible navigation bar (design direction v2 ›
 * Navigation): docked full width, no shadow, 64 dp plus the bottom inset.
 */
export const NAV_HEIGHT = 64;

/** Bottom padding when the device reports no inset (web, button-nav Android). */
export const NAV_MIN_BOTTOM = 12;

/**
 * The active indicator: a 56 × 32 pill (`pinkContainer`; `stageRaised` on the
 * Feed) that grows from 32 dp wide on selection — shape morph #2.
 */
export const NAV_INDICATOR = { width: 56, height: 32, from: 32 } as const;

/** The Create key: a 52 × 40 `pink` key at the press radius (12). */
export const CREATE_KEY = { width: 52, height: 40, radius: 12 } as const;

/** The unread mark: an 8 dp `pink` dot. */
export const UNREAD_DOT = 8;

/**
 * The Roxy AI button's lane (design direction v2 › The Roxy AI button): an
 * 88 × 88 dp square at the bottom end corner, directly above the bar. At rest
 * nothing readable or tappable sits inside it: lists end `FAB_LANE` higher
 * (bottom padding), the Feed rail starts at its top and captions keep an end
 * margin of `FAB_LANE`. `feedChromeTokens.ts` mirrors the 88; keep them equal.
 */
export const FAB_LANE = 88;

/** The Roxy O at rest: a 56 dp circle. */
export const FAB_SIZE = 56;

/** The Roxy O tucked while a list scrolls down: 40 dp, centred on the edge. */
export const FAB_TUCKED = 40;

/** The button's distance from the end edge and from the top of the bar. */
export const FAB_MARGIN = 16;

/**
 * The tucked button's hit area: 28 dp of it shows inside the screen (20 of the
 * O plus 8), 48 dp tall so it stays a real target.
 */
export const FAB_TUCKED_HIT = { width: 28, height: 48 } as const;

/**
 * RETIRED with the floating pill (v2: the bar is docked full width, so there
 * is no inset). Kept exported for any caller still reading it. Origin: the
 * Roxy 3.0 shell (`git log -S PILL_INSET`). Superseded 2026-10-21; remove once
 * nothing imports it.
 */
export const PILL_INSET = 0;

/** RETIRED (v2): see `NAV_MIN_BOTTOM`, which took its job. */
export const PILL_MIN_BOTTOM = NAV_MIN_BOTTOM;

/**
 * RETIRED (v2): the active slot is no longer a translucent tint of `roxy`
 * behind the label; it is a solid `pinkContainer` pill behind the icon, whose
 * pairs `__tests__/theme.contrast.test.ts` holds directly. Kept exported for
 * any caller still reading it. Superseded 2026-10-21.
 */
export const ACTIVE_TINT_ALPHA = '14';

export type NavSlot =
  | {
      kind: 'route';
      /** The Expo Router folder this slot drives. */
      routeName: string;
      label: string;
      icon: NavIconName;
    }
  | { kind: 'action'; key: string; label: string };

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
 * Whether the active-slot indicator jumps instead of springing. Reduce Motion
 * still has to show the selected slot — only the motion goes away.
 */
export function indicatorSnapsInstantly(reducedMotion: boolean): boolean {
  return reducedMotion;
}
