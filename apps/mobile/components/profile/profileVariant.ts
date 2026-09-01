/**
 * Which tabs a profile shows, and in what order.
 *
 * Four screens — a woman, a seller, a community and your own You tab — draw the
 * same header and the same tab strip with four different sets of tabs. Before
 * 3.0 each screen decided for itself, and each one drew a tab and then an empty
 * state inside it: a Shop with nothing in it, an Events tab reading "no events".
 * The prototype never does that. It computes the strip from what exists
 * (behaviour lines 1516–1572, `tabsFor`), so a quiet profile is short, not
 * broken.
 *
 * This module is the whole rule, and it is pure: no store, no React, no I/O. The
 * caller already knows whether each tab has rows — it just fetched them — and
 * whether the subject can sell, via `canSell(deriveSellerStatus(rows))` from
 * `lib/sellerStatus.ts`. Keeping the decision here means the four routes cannot
 * disagree about it, and the disagreement they could have is not cosmetic: a
 * Shop tab in front of an unapproved seller is a checkout in front of an account
 * that has not passed vetting.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · markup 434–633, behaviour 1516–1572 · 2026-09-01
 */

/**
 * Who the profile belongs to.
 *
 * `seller` is not a fifth kind of account — it is `user` plus an approved
 * `businesses` row. The route derives it once, so nothing downstream has to
 * re-ask whether she is allowed to take money.
 */
export type ProfileVariant = 'user' | 'seller' | 'community' | 'self';

export type ProfileTab =
  | 'posts' | 'shop' | 'events' | 'rooms' | 'games' | 'about' | 'saved';

/** Whether each tab has anything to put inside it. */
export type PopulatedTabs = Record<ProfileTab, boolean>;

/**
 * The tabs each variant is *allowed* to show, in prototype order.
 *
 * The array doubles as the permission list: a tab absent from a variant's row
 * can never be rendered for it, whatever the caller passes. That is why `shop`
 * is missing from `user` and `saved` is missing from everything but `self` —
 * expressing the two privacy rules as omissions rather than as `if`s means there
 * is no branch to forget.
 *
 * Orders come straight from the prototype's `tabsFor`: `wlw` is
 * Posts · Rooms · Events · Games · About, `maya` is Posts · Shop · Events, and
 * self is `['Posts','Saved']` with Shop appended once she is approved.
 */
const ALLOWED_TABS: Record<ProfileVariant, readonly ProfileTab[]> = {
  user: ['posts', 'events', 'rooms', 'games', 'about'],
  seller: ['posts', 'shop', 'events', 'rooms', 'games', 'about'],
  community: ['posts', 'rooms', 'events', 'games', 'about'],
  self: ['posts', 'saved', 'shop', 'events', 'rooms', 'games', 'about'],
};

/** Human labels for the strip. One spelling, so no two screens disagree. */
export const TAB_LABELS: Record<ProfileTab, string> = {
  posts: 'Posts',
  shop: 'Shop',
  events: 'Events',
  rooms: 'Rooms',
  games: 'Games',
  about: 'About',
  saved: 'Saved',
};

/**
 * The tabs to render, in order. An empty result is a real answer: it means this
 * profile has nothing yet, and the shell says so once instead of seven times.
 */
export function visibleTabs(variant: ProfileVariant, populated: PopulatedTabs): ProfileTab[] {
  return ALLOWED_TABS[variant].filter((tab) => populated[tab] === true);
}

/**
 * The tab to open on, given what is visible and what she last had selected.
 *
 * Selection has to survive a refetch that changes the strip — she taps Shop, a
 * slow rooms query lands, and the strip regrows underneath her. Falling back to
 * the first visible tab (never a hardcoded `'posts'`, which may not be there) is
 * what the prototype does: `tabs.indexOf(s.ptab) > -1 ? s.ptab : 'Posts'`.
 */
export function resolveActiveTab(
  tabs: readonly ProfileTab[],
  selected: ProfileTab | null,
): ProfileTab | null {
  if (selected && tabs.includes(selected)) return selected;
  return tabs[0] ?? null;
}

/** A gamification band: what the avatar badge says. */
export type ProfileLevel = { label: string; emoji: string };

/**
 * Points banded into the three levels `ProfileCard` already shipped.
 *
 * Kept rather than replaced. The prototype's badge is a level NUMBER (⚡12) on
 * top of an XP bar, and Roxy's schema has neither — `profiles.gamification_points`
 * is the only score there is. Inventing a level curve to match a mockup would
 * put a number on a woman's avatar that nothing else in the product could
 * explain; the three bands are already earned, already named, and already shown
 * on the About tab.
 *
 * Defensive about the input on purpose: `gamification_points` is nullable in
 * flight (a fresh row, a partial select), and a crash on the avatar badge would
 * take the whole header with it.
 */
export function profileLevel(points: number | null | undefined): ProfileLevel {
  const score = typeof points === 'number' && Number.isFinite(points) ? points : 0;
  if (score >= 500) return { label: 'Radiant', emoji: '✨' };
  if (score >= 100) return { label: 'Bloom', emoji: '🌸' };
  return { label: 'Seedling', emoji: '🌱' };
}
