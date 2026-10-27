import type { PostgrestError } from '@supabase/supabase-js';
import { isMissingColumn, isMissingFunction, isMissingTable } from '@/lib/schema-availability';

/**
 * Where a community meets, as Studio shows and edits it.
 *
 * The database side is migration 139: `communities.city_id / meets`, written
 * only through `set_community_location(p_community_id, p_city_id, p_meets)`,
 * and the picker `search_cities(p_q)`. Both RPCs refuse GET, and supabase-js
 * `rpc()` POSTs unless `{ get: true }` is passed, so call them plainly.
 * // src: node_modules/@supabase/postgrest-js/dist/index.cjs rpc() · @supabase/postgrest-js 2.102.1 · 2026-10-27
 */

export type Meets = 'online' | 'in_person' | 'both';

/** A city as the picker returns it (search_cities) or as a community embeds it. */
export type CityOption = {
  id: number;
  name: string;
  admin1: string | null;
  country_code: string;
};

export type CommunityLocation = {
  city: CityOption | null;
  meets: Meets;
};

export const MEETS_OPTIONS: ReadonlyArray<{ value: Meets; label: string }> = [
  { value: 'online', label: 'Online' },
  { value: 'in_person', label: 'In person' },
  { value: 'both', label: 'Both' },
];

/** search_cities refuses fewer than 2 characters; the picker never asks. */
export const CITY_SEARCH_MIN_CHARS = 2;
export const CITY_SEARCH_DEBOUNCE_MS = 250;
export const CITY_ATTRIBUTION = 'City data © GeoNames (CC BY 4.0)';

export const NEEDS_CITY_MESSAGE = 'Pick a city for a community that meets in person.';
export const LOCATION_NOT_SAVED_AFTER_CREATE =
  "Community created, but its location wasn't saved — set it from Edit location.";

export function isMeets(value: unknown): value is Meets {
  return value === 'online' || value === 'in_person' || value === 'both';
}

let regionNames: Intl.DisplayNames | null | undefined;

function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "City, Region, Country", skipping a missing part and one that repeats the part before it. */
export function formatCityLabel(city: CityOption): string {
  const parts = [city.name, city.admin1, countryName(city.country_code)];
  const label: string[] = [];
  for (const part of parts) {
    const trimmed = part?.trim();
    if (!trimmed) continue;
    if (label.length > 0 && label[label.length - 1].toLowerCase() === trimmed.toLowerCase()) continue;
    label.push(trimmed);
  }
  return label.join(', ');
}

/** The default (no city, online) is what create_community already stores; anything else needs a second call. */
export function needsLocationCall(city: CityOption | null, meets: Meets): boolean {
  return city !== null || meets !== 'online';
}

/** In person or both without a city is refused by the database; say so before asking it. */
export function missingCityFor(city: CityOption | null, meets: Meets): boolean {
  return meets !== 'online' && city === null;
}

export function describeLocation(location: CommunityLocation): string {
  const place = location.city ? formatCityLabel(location.city) : null;
  if (!place) {
    if (location.meets === 'online') return 'Online only';
    return location.meets === 'both' ? 'Online and in person' : 'In person';
  }
  if (location.meets === 'in_person') return `In person · ${place}`;
  if (location.meets === 'both') return `Online and in person · ${place}`;
  return `Online · based in ${place}`;
}

type EmbeddedCity = {
  id?: unknown;
  name?: unknown;
  admin1?: unknown;
  country_code?: unknown;
};

export type CommunityLocationRow = {
  id: string;
  meets: unknown;
  city_id: unknown;
  cities: EmbeddedCity | EmbeddedCity[] | null;
};

function toCity(raw: EmbeddedCity | null | undefined): CityOption | null {
  if (!raw || typeof raw.id !== 'number' || typeof raw.name !== 'string' || typeof raw.country_code !== 'string') {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    admin1: typeof raw.admin1 === 'string' ? raw.admin1 : null,
    country_code: raw.country_code,
  };
}

/** A `communities` row with `cities(...)` embedded (PostgREST may hand back an object or a one-element array). */
export function toCommunityLocation(row: CommunityLocationRow): CommunityLocation {
  const embedded = Array.isArray(row.cities) ? row.cities[0] : row.cities;
  return {
    city: toCity(embedded),
    meets: isMeets(row.meets) ? row.meets : 'online',
  };
}

/** "Migration 139 is not on this project yet": the columns, the table or the FK relationship are missing. */
export function isLocationSchemaMissing(error: PostgrestError | null | undefined): boolean {
  if (error == null) return false;
  // PGRST200: the relationship (communities.city_id -> cities) is not in the schema cache.
  return isMissingColumn(error) || isMissingTable(error) || error.code === 'PGRST200';
}

/**
 * set_community_location failed: a sentence for the person, never the raw
 * database text (which can carry ids). Codes are the ones migration 139 raises.
 */
export function locationSaveErrorMessage(error: PostgrestError | null | undefined): string {
  if (isMissingFunction(error)) {
    return "Setting where a community meets isn't available yet.";
  }
  switch (error?.code) {
    case '42501':
      return "Only this community's owner, admins, moderators or Roxy staff can change where it meets.";
    case 'P0002':
      return "We couldn't find this community any more. Reload the page.";
    case '22023':
      if (/needs a city/i.test(error.message)) return NEEDS_CITY_MESSAGE;
      if (/unknown city/i.test(error.message)) return "That city isn't in our list any more. Pick it again.";
      return 'That location is not valid. Pick a city and how it meets again.';
    default:
      return "We couldn't save the location. Check your connection and try again.";
  }
}

/** search_cities failed: "not live yet" vs "try again", never the raw text. */
export function citySearchErrorMessage(error: PostgrestError | null | undefined): string {
  if (isMissingFunction(error)) return "City search isn't available yet.";
  return "We couldn't search cities. Try again.";
}
