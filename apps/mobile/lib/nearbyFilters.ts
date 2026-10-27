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

/**
 * Every radius says its number. The widest used to read "Anywhere in the
 * country", which a 1000 km circle is not: it is a distance from where she
 * is, so it runs past the border of a small country and stops short of the
 * far end of a big one.
 */
const RADIUS_WORDS: Record<NearbyRadiusKm, string> = {
  10: '10 km',
  25: '25 km',
  50: '50 km',
  100: '100 km',
  1000: '1,000 km',
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

/** "Within 25 km" … "Within 1,000 km". */
export function radiusLabel(km: NearbyRadiusKm): string {
  return `Within ${RADIUS_WORDS[km]}`;
}

/** The next radius out, or null at the widest. */
export function widerRadius(km: NearbyRadiusKm): NearbyRadiusKm | null {
  const i = NEARBY_RADII_KM.indexOf(km);
  return i >= 0 && i < NEARBY_RADII_KM.length - 1 ? NEARBY_RADII_KM[i + 1] : null;
}

/** "Widen to 100 km". */
export function widenLabel(km: NearbyRadiusKm): string {
  return `Widen to ${RADIUS_WORDS[km]}`;
}

/** A kind, a way of meeting or open-only: what she filtered FOR (distance is where, not what). */
export function hasNarrowingFilters(f: NearbyFilters): boolean {
  return f.categories.length > 0 || f.meets !== 'all' || f.openOnly;
}

/** Clears what she filtered for and keeps her distance, so clearing never pulls her back in. */
export function clearNarrowingFilters(f: NearbyFilters): NearbyFilters {
  return { ...f, categories: [], meets: 'all', openOnly: false };
}

/**
 * What an empty answer says, and which moves it offers besides "Choose a city"
 * (always offered). Members cannot start a community in the app (Studio does
 * that), so the copy only ever names what she can do here: clear her filters,
 * look one distance farther, or look from another city.
 */
export type NearbyEmptyAdvice = {
  body: string;
  /** The next radius out, offered as "Widen to …"; null at the widest or while filters are on. */
  widenTo: NearbyRadiusKm | null;
  /** Category, meets or open-only is on: "Clear filters" comes first. */
  clearFilters: boolean;
};

export function nearbyEmptyAdvice(f: NearbyFilters): NearbyEmptyAdvice {
  if (hasNarrowingFilters(f)) {
    return {
      body: 'Nothing near you matches these filters yet. Clear them, or try another city.',
      widenTo: null,
      clearFilters: true,
    };
  }
  const widenTo = widerRadius(f.radiusKm);
  if (widenTo) {
    return { body: 'No communities near you yet. Try a wider distance or another city.', widenTo, clearFilters: false };
  }
  return { body: `No communities within ${RADIUS_WORDS[f.radiusKm]} yet. Try another city.`, widenTo: null, clearFilters: false };
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
