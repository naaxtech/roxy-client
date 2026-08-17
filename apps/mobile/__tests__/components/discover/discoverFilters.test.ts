/**
 * Discover's visibility rules, asserted away from React.
 *
 * Seven rails and three chip rows is the shape that becomes an unreadable pile
 * of `&&` in a screen body. Testing the rules here means the screen can only get
 * them wrong by not asking.
 */
import {
  DISCOVER_CHIPS,
  EVENT_FILTERS,
  ECONOMY_FILTERS,
  visibleRails,
  railVisible,
  eventMatchesFilter,
  economyKind,
  economyWlwOnly,
  economySavedOnly,
  type DiscoverChip,
  type DiscoverRail,
} from '../../../components/discover/discoverFilters';

const ALL_RAILS: DiscoverRail[] = [
  'hero', 'top10', 'live', 'events', 'economy', 'communities', 'games',
];

describe('the top chip row', () => {
  it('offers exactly the six the design names, All first', () => {
    expect(DISCOVER_CHIPS.map((c) => c.key)).toEqual([
      'all', 'events', 'shops', 'live', 'comms', 'games',
    ]);
  });

  it('shows every rail under All', () => {
    expect(visibleRails('all')).toEqual(ALL_RAILS);
  });

  it('never shows an empty screen — every chip keeps at least one rail', () => {
    for (const chip of DISCOVER_CHIPS) {
      expect(`${chip.key}: ${visibleRails(chip.key).length}`).not.toBe(`${chip.key}: 0`);
    }
  });

  it('keeps the hero with Events, because the hero is an event', () => {
    expect(railVisible('events', 'hero')).toBe(true);
    expect(railVisible('shops', 'hero')).toBe(false);
  });

  /**
   * A "top 10 of one category" is a list, not a chart. Once she has already
   * chosen the category the ranking stops carrying information.
   */
  it('shows Top 10 only in the all-view', () => {
    const withTop10 = DISCOVER_CHIPS
      .map((c) => c.key)
      .filter((k) => railVisible(k, 'top10'));
    expect(withTop10).toEqual(['all']);
  });

  it('narrows to a single rail for every specific chip', () => {
    const specific: DiscoverChip[] = ['shops', 'live', 'comms', 'games'];
    for (const chip of specific) {
      expect(visibleRails(chip)).toHaveLength(1);
    }
  });
});

describe('the Events chips', () => {
  it('maps to the event_type values the schema actually stores', () => {
    expect(EVENT_FILTERS.map((f) => f.key)).toEqual(['all', 'online', 'in_person']);
  });

  it('shows everything under All', () => {
    for (const type of ['online', 'in_person', 'hybrid'] as const) {
      expect(eventMatchesFilter(type, 'all')).toBe(true);
    }
  });

  it('separates online from in person', () => {
    expect(eventMatchesFilter('online', 'online')).toBe(true);
    expect(eventMatchesFilter('online', 'in_person')).toBe(false);
    expect(eventMatchesFilter('in_person', 'in_person')).toBe(true);
    expect(eventMatchesFilter('in_person', 'online')).toBe(false);
  });

  /**
   * The one that matters: a hybrid event is genuinely both, and picking a side
   * for her would hide an event she could have gone to.
   */
  it('keeps a hybrid event under both filters rather than guessing', () => {
    expect(eventMatchesFilter('hybrid', 'online')).toBe(true);
    expect(eventMatchesFilter('hybrid', 'in_person')).toBe(true);
  });
});

describe('the WLW-economy chips', () => {
  it('offers the five the design names', () => {
    expect(ECONOMY_FILTERS.map((f) => f.key)).toEqual([
      'all', 'saved', 'wlw', 'impact', 'support',
    ]);
  });

  /**
   * Impact and Support are different datasets with different cards and
   * different actions — they change what the rail IS, not what it shows. A rail
   * that "filtered" from a product to a donation would be lying.
   */
  it('swaps the dataset for Impact and Support, and only filters for the rest', () => {
    expect(economyKind('all')).toBe('shops');
    expect(economyKind('saved')).toBe('shops');
    expect(economyKind('wlw')).toBe('shops');
    expect(economyKind('impact')).toBe('impact');
    expect(economyKind('support')).toBe('support');
  });

  it('asks the shop query for WLW-owned only when that chip is on', () => {
    const wlw = ECONOMY_FILTERS.map((f) => f.key).filter(economyWlwOnly);
    expect(wlw).toEqual(['wlw']);
  });

  it('narrows to bookmarks only under Saved', () => {
    const saved = ECONOMY_FILTERS.map((f) => f.key).filter(economySavedOnly);
    expect(saved).toEqual(['saved']);
  });

  // Saved is a client-side narrowing of the same query, so asking the server for
  // WLW-only at the same time would silently drop her non-WLW bookmarks.
  it('never asks for WLW-only and Saved at once', () => {
    for (const f of ECONOMY_FILTERS) {
      expect(economyWlwOnly(f.key) && economySavedOnly(f.key)).toBe(false);
    }
  });
});
