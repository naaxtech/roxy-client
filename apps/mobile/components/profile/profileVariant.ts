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
  | 'posts' | 'shop' | 'events' | 'rooms' | 'games' | 'about' | 'saved'
  // Storefront-only. The design names six tabs, but a real shop also carries a
  // photo wall and its shipping and returns terms — and folding policies into
  // About would bury the one section a buyer reads before she pays.
  | 'photos' | 'policies';

/**
 * Whether each tab has anything to put inside it.
 *
 * The storefront-only pair is optional: a woman's profile has no policies and
 * should not have to declare that it does not. An absent key is falsy, which is
 * the same answer `visibleTabs` gives an explicit `false`.
 */
export type StorefrontTab = 'photos' | 'policies';
export type PopulatedTabs =
  Record<Exclude<ProfileTab, StorefrontTab>, boolean>
  & Partial<Record<StorefrontTab, boolean>>;

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
  seller: ['posts', 'shop', 'photos', 'events', 'rooms', 'games', 'about', 'policies'],
  community: ['posts', 'rooms', 'events', 'games', 'about'],
  self: ['posts', 'saved', 'shop', 'events', 'rooms', 'games', 'about'],
};

/** Human labels for the strip. One spelling, so no two screens disagree. */
export const TAB_LABELS: Record<ProfileTab, string> = {
  posts: 'Posts',
  photos: 'Photos',
  policies: 'Policies',
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

const XP_PER_LEVEL = 20;

/**
 * The lightning number the prototype paints on the avatar (`⚡12`).
 *
 * Schema still only has `gamification_points`. Twenty points per level is the
 * smallest integer that makes the mock's 240-point Bloom land on 12 — the
 * number the design already taught people to look for — without inventing a
 * second score.
 */
export function profileXpLevel(points: number | null | undefined): number {
  const score = typeof points === 'number' && Number.isFinite(points) ? Math.max(0, points) : 0;
  return Math.max(1, Math.floor(score / XP_PER_LEVEL));
}

/** The XP pill next to Edit: label plus 0–1 fill inside the current band. */
export function profileXpBar(points: number | null | undefined): { label: string; progress: number } {
  const score = typeof points === 'number' && Number.isFinite(points) ? Math.max(0, points) : 0;
  const into = score % XP_PER_LEVEL;
  const progress = score === 0 ? 0 : (into === 0 ? 1 : into / XP_PER_LEVEL);
  return {
    label: `${score.toLocaleString('en-US')} XP`,
    progress,
  };
}

export type BadgePreviewSource = {
  earned_at: string | null;
  badges: { emoji?: string | null } | null;
};

/**
 * The header chip (`🌸🔥💎🎙️ +2`). Locked rows do not count: showing a
 * badge she has not earned is the same lie as a Shop tab on an unvetted seller.
 */
export function badgePreviewFromEarned(
  badges: readonly BadgePreviewSource[],
): { emojis: string; extra: number } | null {
  const earned = badges.filter((b) => b.earned_at);
  if (earned.length === 0) return null;
  const shown = earned.slice(0, 4);
  const extra = Math.max(0, earned.length - shown.length);
  const emojis = shown.map((b) => b.badges?.emoji ?? '🏅').join('');
  return { emojis, extra };
}
