import { NEARBY_RADII_KM, isNearbyRadius, type NearbyRadiusKm } from './nearbyCoords';

/**
 * Nearby filters as arithmetic: no React, no I/O.
 *
 * The RPCs (migration 139) accept radius 10 / 25 / 50 / 100 / 1000 km, the four
 * community categories, and `p_meets` ⊆ {in_person, both}. Online-only
 * communities are never nearby, so "meets" here chooses between in person,
 * in person AND online, or either of those; no choice can send `online`.
 */

export type NearbyCategory = 'identity' | 'interest' | 'location' | 'support';
export const NEARBY_CATEGORIES: readonly NearbyCategory[] = ['identity', 'interest', 'location', 'support'];

/** `all` = in person or in person and online (the server's own default). */
export type NearbyMeets = 'all' | 'in_person' | 'both';
export type NearbyJoin = 'all' | 'open';

export type NearbyFilters = {
  radiusKm: NearbyRadiusKm;
  categories: NearbyCategory[];
  meets: NearbyMeets;
  /** Only communities she can join at once (not private ones that take a request). */
  openOnly: boolean;
};

export const DEFAULT_NEARBY_FILTERS: NearbyFilters = Object.freeze({
  radiusKm: 50,
  categories: [],
  meets: 'all',
  openOnly: false,
}) as NearbyFilters;

/** A chip choice: the key the code uses, the words she reads. */
export type NearbyChoice<K extends string> = { key: K; label: string };

export type RadiusKey = `${NearbyRadiusKm}`;

/** The widest radius the RPC allows is offered in the owner's words (spec › Filters). */
const RADIUS_WORDS: Record<NearbyRadiusKm, string> = {
  10: '10 km',
  25: '25 km',
  50: '50 km',
  100: '100 km',
  1000: 'Anywhere in the country',
};

export const RADIUS_CHIPS: NearbyChoice<RadiusKey>[] = NEARBY_RADII_KM.map((km) => ({
  key: String(km) as RadiusKey,
  label: RADIUS_WORDS[km],
}));

/** Same words as Studio's create-community form, so owners and members share them. */
const CATEGORY_WORDS: Record<NearbyCategory, string> = {
  identity: 'Identity',
  interest: 'Interest',
  location: 'Location',
  support: 'Support',
};

export const CATEGORY_CHIPS: NearbyChoice<NearbyCategory>[] = NEARBY_CATEGORIES.map((c) => ({
  key: c,
  label: CATEGORY_WORDS[c],
}));

const MEETS_WORDS: Record<NearbyMeets, string> = {
  all: 'All',
  in_person: 'In person',
  // The words Discover's event posters already use for a hybrid event.
  both: 'In person and online',
};

export const MEETS_CHIPS: NearbyChoice<NearbyMeets>[] = (['all', 'in_person', 'both'] as const).map((m) => ({
  key: m,
  label: MEETS_WORDS[m],
}));

export const JOIN_CHIPS: NearbyChoice<NearbyJoin>[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open to join' },
];

/** "Within 25 km", or "Anywhere in the country" for the widest. */
export function radiusLabel(km: NearbyRadiusKm): string {
  return km === 1000 ? RADIUS_WORDS[1000] : `Within ${RADIUS_WORDS[km]}`;
}

/** The RPC's filter arguments. Defaults go as null so the server applies its own. */
export function nearbyRpcFilters(f: NearbyFilters): {
  p_radius_km: NearbyRadiusKm;
  p_categories: NearbyCategory[] | null;
  p_meets: ('in_person' | 'both')[] | null;
  p_open_only: boolean;
} {
  return {
    p_radius_km: f.radiusKm,
    p_categories: f.categories.length > 0 ? [...f.categories] : null,
    p_meets: f.meets === 'all' ? null : [f.meets],
    p_open_only: f.openOnly,
  };
}

/** Keeps the categories in the sheet's order, so equal choices compare equal. */
function ordered(categories: readonly NearbyCategory[]): NearbyCategory[] {
  return NEARBY_CATEGORIES.filter((c) => categories.includes(c));
}

export function toggleCategory(f: NearbyFilters, c: NearbyCategory): NearbyFilters {
  const next = f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c];
  return { ...f, categories: ordered(next) };
}

export type ActiveNearbyFilter = { key: string; label: string };

/** One removable chip per choice that differs from the defaults, in the sheet's order. */
export function activeNearbyFilters(f: NearbyFilters): ActiveNearbyFilter[] {
  const out: ActiveNearbyFilter[] = [];
  if (f.radiusKm !== DEFAULT_NEARBY_FILTERS.radiusKm) out.push({ key: 'radius', label: radiusLabel(f.radiusKm) });
  for (const c of ordered(f.categories)) out.push({ key: `category:${c}`, label: CATEGORY_WORDS[c] });
  if (f.meets !== 'all') out.push({ key: 'meets', label: MEETS_WORDS[f.meets] });
  if (f.openOnly) out.push({ key: 'open', label: 'Open to join' });
  return out;
}

/** Resets the one choice a chip stands for; an unknown key changes nothing. */
export function removeNearbyFilter(f: NearbyFilters, key: string): NearbyFilters {
  if (key === 'radius') return { ...f, radiusKm: DEFAULT_NEARBY_FILTERS.radiusKm };
  if (key === 'meets') return { ...f, meets: 'all' };
  if (key === 'open') return { ...f, openOnly: false };
  if (key.startsWith('category:')) {
    const c = key.slice('category:'.length);
    return { ...f, categories: f.categories.filter((x) => x !== c) };
  }
  return f;
}

export function sameNearbyFilters(a: NearbyFilters, b: NearbyFilters): boolean {
  const ca = ordered(a.categories);
  const cb = ordered(b.categories);
  return a.radiusKm === b.radiusKm
    && a.meets === b.meets
    && a.openOnly === b.openOnly
    && ca.length === cb.length
    && ca.every((c, i) => c === cb[i]);
}

function isCategory(v: unknown): v is NearbyCategory {
  return typeof v === 'string' && (NEARBY_CATEGORIES as readonly string[]).includes(v);
}

/** Whatever is on disk (it is not trusted): the valid parts kept, the rest defaulted. */
export function sanitizeNearbyFilters(raw: unknown): NearbyFilters {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NEARBY_FILTERS, categories: [] };
  const r = raw as Record<string, unknown>;
  const radiusKm = typeof r.radiusKm === 'number' && isNearbyRadius(r.radiusKm)
    ? r.radiusKm
    : DEFAULT_NEARBY_FILTERS.radiusKm;
  const categories = Array.isArray(r.categories) ? ordered(r.categories.filter(isCategory)) : [];
  const meets: NearbyMeets = r.meets === 'in_person' || r.meets === 'both' ? r.meets : 'all';
  const openOnly = r.openOnly === true;
  return { radiusKm, categories, meets, openOnly };
}
