/**
 * Nearby filters as arithmetic: what the sheet offers, what goes to the RPC,
 * which filters show as removable chips, and how a stored value is cleaned.
 * The RPC (139) accepts radius 10/25/50/100/1000, the four categories, and
 * meets ⊆ {in_person, both}: online-only is never nearby, so no choice here
 * may ever send 'online'.
 */
import {
  DEFAULT_NEARBY_FILTERS,
  JOIN_CHIPS,
  MEETS_CHIPS,
  RADIUS_CHIPS,
  CATEGORY_CHIPS,
  activeNearbyFilters,
  clearNarrowingFilters,
  nearbyEmptyAdvice,
  nearbyRpcFilters,
  radiusLabel,
  removeNearbyFilter,
  sameNearbyFilters,
  sanitizeNearbyFilters,
  toggleCategory,
  widenLabel,
  widerRadius,
  type NearbyFilters,
} from '../../lib/nearbyFilters';
import { NEARBY_RADII_KM } from '../../lib/nearbyCoords';

describe('the choices', () => {
  it('distance offers exactly the radii the RPC accepts, the widest named for what it is: 1,000 km', () => {
    expect(RADIUS_CHIPS.map((c) => Number(c.key))).toEqual([...NEARBY_RADII_KM]);
    // A 1000 km circle is not "anywhere in the country" (it is a distance from
    // her, not a border): the label says the number.
    expect(RADIUS_CHIPS.map((c) => c.label)).toEqual(['10 km', '25 km', '50 km', '100 km', '1,000 km']);
    expect(RADIUS_CHIPS.some((c) => /anywhere|country/i.test(c.label))).toBe(false);
  });

  it('the four categories, in the Studio form\'s words', () => {
    expect(CATEGORY_CHIPS.map((c) => c.key)).toEqual(['identity', 'interest', 'location', 'support']);
    expect(CATEGORY_CHIPS.map((c) => c.label)).toEqual(['Identity', 'Interest', 'Location', 'Support']);
  });

  it('meets and who-can-join', () => {
    expect(MEETS_CHIPS.map((c) => c.key)).toEqual(['all', 'in_person', 'both']);
    expect(JOIN_CHIPS.map((c) => c.key)).toEqual(['all', 'open']);
  });

  it('defaults: 50 km, every kind, any way of meeting, open or by request', () => {
    expect(DEFAULT_NEARBY_FILTERS).toEqual({ radiusKm: 50, categories: [], meets: 'all', openOnly: false });
  });
});

describe('nearbyRpcFilters — the RPC\'s arguments', () => {
  it('defaults send nulls so the server applies its own defaults', () => {
    expect(nearbyRpcFilters(DEFAULT_NEARBY_FILTERS)).toEqual({
      p_radius_km: 50, p_categories: null, p_meets: null, p_open_only: false,
    });
  });

  it('never sends "online"', () => {
    for (const chip of MEETS_CHIPS) {
      const f: NearbyFilters = { ...DEFAULT_NEARBY_FILTERS, meets: chip.key };
      expect(JSON.stringify(nearbyRpcFilters(f).p_meets)).not.toContain('online');
    }
    expect(nearbyRpcFilters({ ...DEFAULT_NEARBY_FILTERS, meets: 'in_person' }).p_meets).toEqual(['in_person']);
    expect(nearbyRpcFilters({ ...DEFAULT_NEARBY_FILTERS, meets: 'both' }).p_meets).toEqual(['both']);
  });

  it('categories and open-only pass through', () => {
    expect(nearbyRpcFilters({ radiusKm: 1000, categories: ['support'], meets: 'all', openOnly: true })).toEqual({
      p_radius_km: 1000, p_categories: ['support'], p_meets: null, p_open_only: true,
    });
  });
});

describe('toggleCategory', () => {
  it('adds and removes, keeping the sheet\'s order', () => {
    let f = toggleCategory(DEFAULT_NEARBY_FILTERS, 'support');
    f = toggleCategory(f, 'identity');
    expect(f.categories).toEqual(['identity', 'support']);
    expect(toggleCategory(f, 'support').categories).toEqual(['identity']);
    expect(DEFAULT_NEARBY_FILTERS.categories).toEqual([]);
  });
});

describe('active filters as removable chips', () => {
  const busy: NearbyFilters = { radiusKm: 25, categories: ['identity', 'support'], meets: 'in_person', openOnly: true };

  it('defaults show no chips', () => {
    expect(activeNearbyFilters(DEFAULT_NEARBY_FILTERS)).toEqual([]);
  });

  it('one chip per non-default choice, in words', () => {
    expect(activeNearbyFilters(busy)).toEqual([
      { key: 'radius', label: 'Within 25 km' },
      { key: 'category:identity', label: 'Identity' },
      { key: 'category:support', label: 'Support' },
      { key: 'meets', label: 'In person' },
      { key: 'open', label: 'Open to join' },
    ]);
  });

  it('removing a chip resets only that choice', () => {
    expect(removeNearbyFilter(busy, 'radius').radiusKm).toBe(50);
    expect(removeNearbyFilter(busy, 'category:identity').categories).toEqual(['support']);
    expect(removeNearbyFilter(busy, 'meets')).toEqual({ ...busy, meets: 'all' });
    expect(removeNearbyFilter(busy, 'open')).toEqual({ ...busy, openOnly: false });
    expect(removeNearbyFilter(busy, 'nonsense')).toEqual(busy);
  });

  it('the widest radius reads "Within 1,000 km", like every other radius', () => {
    expect(activeNearbyFilters({ ...DEFAULT_NEARBY_FILTERS, radiusKm: 1000 })[0].label).toBe('Within 1,000 km');
    expect(radiusLabel(1000)).toBe('Within 1,000 km');
    expect(radiusLabel(25)).toBe('Within 25 km');
  });
});

describe('nothing nearby — what she can do instead (members cannot start a community in the app)', () => {
  it('widerRadius steps out one radius at a time and stops at the widest', () => {
    expect(widerRadius(10)).toBe(25);
    expect(widerRadius(25)).toBe(50);
    expect(widerRadius(50)).toBe(100);
    expect(widerRadius(100)).toBe(1000);
    expect(widerRadius(1000)).toBeNull();
    expect(widenLabel(100)).toBe('Widen to 100 km');
    expect(widenLabel(1000)).toBe('Widen to 1,000 km');
  });

  it('no filters on: try a wider distance or another city, and the next distance out', () => {
    expect(nearbyEmptyAdvice(DEFAULT_NEARBY_FILTERS)).toEqual({
      body: 'No communities near you yet. Try a wider distance or another city.',
      widenTo: 100,
      clearFilters: false,
    });
  });

  it('already at the widest: another city is the only move left', () => {
    expect(nearbyEmptyAdvice({ ...DEFAULT_NEARBY_FILTERS, radiusKm: 1000 })).toEqual({
      body: 'No communities within 1,000 km yet. Try another city.',
      widenTo: null,
      clearFilters: false,
    });
  });

  it('a kind, a way of meeting or open-only is on: clearing those comes first', () => {
    for (const f of [
      { ...DEFAULT_NEARBY_FILTERS, categories: ['support' as const] },
      { ...DEFAULT_NEARBY_FILTERS, meets: 'both' as const },
      { ...DEFAULT_NEARBY_FILTERS, openOnly: true },
    ]) {
      expect(nearbyEmptyAdvice(f)).toEqual({
        body: 'Nothing near you matches these filters yet. Clear them, or try another city.',
        widenTo: null,
        clearFilters: true,
      });
    }
  });

  it('a distance she widened to is not a "filter" to clear: clearing never pulls her back in', () => {
    // She tapped Widen to 100 km and still found nothing: the next move is
    // farther again, not "Clear filters", which used to reset her to 50 km.
    expect(nearbyEmptyAdvice({ ...DEFAULT_NEARBY_FILTERS, radiusKm: 100 }).widenTo).toBe(1000);
    const busy: NearbyFilters = { radiusKm: 1000, categories: ['identity'], meets: 'in_person', openOnly: true };
    expect(clearNarrowingFilters(busy)).toEqual({ radiusKm: 1000, categories: [], meets: 'all', openOnly: false });
  });
});

describe('sameNearbyFilters', () => {
  it('compares by value; category order does not matter', () => {
    expect(sameNearbyFilters(
      { ...DEFAULT_NEARBY_FILTERS, categories: ['support', 'identity'] },
      { ...DEFAULT_NEARBY_FILTERS, categories: ['identity', 'support'] },
    )).toBe(true);
    expect(sameNearbyFilters(DEFAULT_NEARBY_FILTERS, { ...DEFAULT_NEARBY_FILTERS, radiusKm: 10 })).toBe(false);
  });
});

describe('sanitizeNearbyFilters — whatever is on disk', () => {
  it('garbage is the defaults', () => {
    expect(sanitizeNearbyFilters(null)).toEqual(DEFAULT_NEARBY_FILTERS);
    expect(sanitizeNearbyFilters('x')).toEqual(DEFAULT_NEARBY_FILTERS);
  });

  it('keeps the valid parts and drops the rest', () => {
    expect(sanitizeNearbyFilters({ radiusKm: 33, categories: ['support', 'dating', 'support'], meets: 'online', openOnly: 'yes' }))
      .toEqual({ radiusKm: 50, categories: ['support'], meets: 'all', openOnly: false });
    expect(sanitizeNearbyFilters({ radiusKm: 100, categories: [], meets: 'both', openOnly: true }))
      .toEqual({ radiusKm: 100, categories: [], meets: 'both', openOnly: true });
  });
});
