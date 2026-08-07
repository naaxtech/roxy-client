import { Ionicons } from '@expo/vector-icons';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

/**
 * The brand ramp. It is duplicated here rather than imported because the two
 * places that already export it are `components/feed/feedChromeTokens.ts` (a
 * directory the navigation shell must not depend on) and nowhere else —
 * `lib/theme.ts` carries the inks but not the gradient. Six components hold a
 * private copy of this array today; consolidating them into `lib/theme.ts` is a
 * one-line move that belongs in whichever slice owns that file next.
 */
export const BRAND_GRADIENT = ['#FF6A2E', '#FF2F71', '#E81C8E'] as const;

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
      /** The Expo Router folder this slot drives. Deliberately unchanged: the
       *  redesign renames labels, not route directories. */
      routeName: string;
      label: string;
      icon: IoniconName;
      iconInactive: IoniconName;
    }
  | { kind: 'action'; key: string; label: string; icon: IoniconName };

/**
 * Five slots — Home · Rooms · ⊕ · Inbox · You.
 *
 * `Rooms` replaces `Discover` because on Roxy the destination is always a
 * community; discovery is a mode inside a room, not a peer of it. It points at
 * the existing `connect` route, which already owns communities, live rooms,
 * events and announcements behind its own sub-tabs.
 *
 * `Play` (the `discover` folder) and `Build` leave the bar and become category
 * pills at the top of Home — Netflix's move for giving Games first-class
 * placement without spending a navigation slot.
 */
export const NAV_SLOTS: readonly NavSlot[] = [
  { kind: 'route', routeName: 'grow', label: 'Home', icon: 'home', iconInactive: 'home-outline' },
  { kind: 'route', routeName: 'connect', label: 'Rooms', icon: 'people-circle', iconInactive: 'people-circle-outline' },
  { kind: 'action', key: 'create', label: 'Create', icon: 'add' },
  { kind: 'route', routeName: 'messages', label: 'Inbox', icon: 'chatbubble', iconInactive: 'chatbubble-outline' },
  { kind: 'route', routeName: 'profile', label: 'You', icon: 'person', iconInactive: 'person-outline' },
];

export type HomeCategory = {
  key: string;
  label: string;
  icon: IoniconName;
  /** A route that resolves today. A pill that goes nowhere is worse than one
   *  honestly absent, so this list only carries paths that already exist. */
  href: string;
};

/**
 * The row that keeps Events, Games, live rooms and Build reachable now that the
 * bar is down to five slots. Every href below is a path the app already serves;
 * nothing here opens a screen this slice invented.
 */
export const HOME_CATEGORIES: readonly HomeCategory[] = [
  { key: 'events', label: 'Events', icon: 'calendar', href: '/(tabs)/connect?tab=events' },
  { key: 'games', label: 'Games', icon: 'game-controller', href: '/(tabs)/discover' },
  { key: 'live', label: 'Live', icon: 'radio', href: '/(tabs)/connect?tab=rooms' },
  { key: 'build', label: 'Build', icon: 'storefront', href: '/(tabs)/build' },
];

/**
 * How long the active-slot indicator takes to cross-fade. Zero under Reduce
 * Motion, which makes the indicator appear instantly rather than not at all —
 * the state still has to be visible, only the transition goes away.
 */
export function indicatorFadeDuration(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 160;
}
