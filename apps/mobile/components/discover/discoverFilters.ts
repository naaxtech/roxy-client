/**
 * What Discover shows, as arithmetic.
 *
 * Discover is seven rails and three independent chip rows, which is exactly the
 * shape that turns into a screen full of `&&` conditions nobody can read and
 * nobody can test. So the visibility rules live here as pure functions with no
 * React and no I/O, and the screen asks them questions.
 *
 * The three chip rows are deliberately independent: the top row decides which
 * rails exist, and the two in-rail rows decide what is inside a rail that
 * already exists. Collapsing them into one state was the first thing tried and
 * it made "Events → In person" silently hide the Shops rail.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html lines 1466–1494 · 2026-08-16
 */

/** The top row: which rails are on screen at all. */
export type DiscoverChip = 'all' | 'archive' | 'events' | 'shops' | 'live' | 'comms' | 'games';

export const DISCOVER_CHIPS: { key: DiscoverChip; label: string }[] = [
  { key: 'all', label: 'All' },
  // Second, right after All. The Archive is the one surface a pending member
  // can use, so it must be reachable before she has joined anything.
  { key: 'archive', label: 'Archive' },
  { key: 'events', label: 'Events' },
  { key: 'shops', label: 'Shops' },
  { key: 'live', label: 'Live' },
  { key: 'comms', label: 'Communities' },
  { key: 'games', label: 'Games' },
];

export type DiscoverRail = 'qotd' | 'hero' | 'top10' | 'archive' | 'live' | 'events' | 'economy' | 'communities' | 'games';

/**
 * Which rails a given top chip shows.
 *
 * `qotd` leads the all-view and appears nowhere else — a question of the day
 * is a today thing, and a today thing sitting below a browse rail is a today
 * thing nobody scrolls far enough to answer. `hero` rides with Events because
 * the hero IS an event in the prototype, and `top10` is an all-view thing — a
 * "top 10 of one category" is a list, not a chart, and it stops meaning
 * anything once the category is already chosen.
 */
const RAILS_BY_CHIP: Record<DiscoverChip, DiscoverRail[]> = {
  all: ['qotd', 'hero', 'top10', 'archive', 'live', 'events', 'economy', 'communities', 'games'],
  archive: ['archive'],
  events: ['hero', 'events'],
  shops: ['economy'],
  live: ['live'],
  comms: ['communities'],
  games: ['games'],
};

export function visibleRails(chip: DiscoverChip): DiscoverRail[] {
  return RAILS_BY_CHIP[chip];
}

export function railVisible(chip: DiscoverChip, rail: DiscoverRail): boolean {
  return RAILS_BY_CHIP[chip].includes(rail);
}

/** The Events rail's own chips. Maps to `events.event_type` in the schema. */
export type EventFilter = 'all' | 'online' | 'in_person';

export const EVENT_FILTERS: { key: EventFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'online', label: 'Online' },
  { key: 'in_person', label: 'In person' },
];

/**
 * A hybrid event is genuinely both, so it survives either filter. Answering
 * "which of the two is it really" is not this function's job and guessing would
 * hide an event from someone who could have gone to it.
 */
export function eventMatchesFilter(
  eventType: 'online' | 'in_person' | 'hybrid',
  filter: EventFilter,
): boolean {
  if (filter === 'all') return true;
  if (eventType === 'hybrid') return true;
  return eventType === filter;
}

/** The WLW-economy rail's chips. */
export type EconomyFilter = 'all' | 'saved' | 'wlw' | 'impact' | 'support';

export const ECONOMY_FILTERS: { key: EconomyFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'saved', label: 'Saved' },
  { key: 'wlw', label: '✿ WLW only' },
  { key: 'impact', label: 'Impact' },
  { key: 'support', label: 'Support' },
];

/**
 * What the economy rail is *made of*, which is not the same question as what it
 * is filtered to.
 *
 * All / Saved / WLW-only are three filters over one dataset — shops. Impact and
 * Support are different datasets entirely (`impact_projects`, and the
 * feature-vote edge function), with different cards and different actions. A
 * rail that "filtered" its way from a product to a donation would be lying about
 * what the chips do.
 */
export type EconomyKind = 'shops' | 'impact' | 'support';

export function economyKind(filter: EconomyFilter): EconomyKind {
  if (filter === 'impact') return 'impact';
  if (filter === 'support') return 'support';
  return 'shops';
}

/** Whether the shop query should ask for WLW-owned businesses only. */
export function economyWlwOnly(filter: EconomyFilter): boolean {
  return filter === 'wlw';
}

/** Whether the shop list should be narrowed to what she has bookmarked. */
export function economySavedOnly(filter: EconomyFilter): boolean {
  return filter === 'saved';
}
