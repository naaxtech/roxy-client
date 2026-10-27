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
  nearbyRpcFilters,
  removeNearbyFilter,
  sameNearbyFilters,
  sanitizeNearbyFilters,
  toggleCategory,
  type NearbyFilters,
} from '../../lib/nearbyFilters';
import { NEARBY_RADII_KM } from '../../lib/nearbyCoords';

describe('the choices', () => {
  it('distance offers exactly the radii the RPC accepts, the widest as "Anywhere in the country"', () => {
    expect(RADIUS_CHIPS.map((c) => Number(c.key))).toEqual([...NEARBY_RADII_KM]);
    expect(RADIUS_CHIPS[RADIUS_CHIPS.length - 1].label).toBe('Anywhere in the country');
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

  it('the widest radius reads "Anywhere in the country"', () => {
    expect(activeNearbyFilters({ ...DEFAULT_NEARBY_FILTERS, radiusKm: 1000 })[0].label).toBe('Anywhere in the country');
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
