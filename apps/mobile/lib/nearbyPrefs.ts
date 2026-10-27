import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_NEARBY_FILTERS, sanitizeNearbyFilters, type NearbyFilters } from './nearbyFilters';

/**
 * What Nearby remembers, on her phone only (spec › Filters: "remembered on the
 * device only, never on the server"): her last-used filters, the city she
 * chose, whether her own location was her last source, and whether she said
 * no to location (so the rail never asks again).
 *
 * Never a coordinate: `saveNearbyPrefs` writes only the fields below, whatever
 * it is handed. Keyed by her member id (two women can share a phone) and
 * removed on sign-out (`store/authStore`). Reads never throw: an unreadable or
 * tampered value is the defaults.
 */

export type ChosenCity = { id: number; label: string };

export type NearbyPrefs = {
  filters: NearbyFilters;
  city: ChosenCity | null;
  /** Where she looked from last: her location (re-read only if still granted) or her city. */
  source: 'location' | 'city' | null;
  /** She refused location: offer a city only, and never ask from the rail again. */
  denied: boolean;
};

export const DEFAULT_NEARBY_PREFS: NearbyPrefs = Object.freeze({
  filters: DEFAULT_NEARBY_FILTERS,
  city: null,
  source: null,
  denied: false,
}) as NearbyPrefs;

const VERSION = 1;
/** "City, Region, Country" is short; anything longer did not come from us. */
const CITY_LABEL_MAX = 200;

export const nearbyPrefsKey = (userId: string) => `roxy.nearby.v${VERSION}:${userId}`;

function fresh(): NearbyPrefs {
  return { filters: { ...DEFAULT_NEARBY_FILTERS, categories: [] }, city: null, source: null, denied: false };
}

function sanitizeCity(raw: unknown): ChosenCity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0) return null;
  if (typeof r.label !== 'string') return null;
  const label = r.label.trim();
  if (label.length === 0 || label.length > CITY_LABEL_MAX) return null;
  return { id: r.id, label };
}

function sanitize(raw: unknown): NearbyPrefs {
  if (!raw || typeof raw !== 'object') return fresh();
  const r = raw as Record<string, unknown>;
  if (r.v !== VERSION) return fresh();
  const city = sanitizeCity(r.city);
  let source: NearbyPrefs['source'] = r.source === 'location' || r.source === 'city' ? r.source : null;
  // "Her city" with no city to look from is no source at all.
  if (source === 'city' && !city) source = null;
  return { filters: sanitizeNearbyFilters(r.filters), city, source, denied: r.denied === true };
}

export async function loadNearbyPrefs(userId: string): Promise<NearbyPrefs> {
  try {
    const raw = await AsyncStorage.getItem(nearbyPrefsKey(userId));
    if (!raw) return fresh();
    return sanitize(JSON.parse(raw));
  } catch {
    return fresh();
  }
}

export async function saveNearbyPrefs(userId: string, prefs: NearbyPrefs): Promise<void> {
  // Field by field: a caller can never smuggle a position (or anything else) onto the disk.
  const entry = {
    v: VERSION,
    filters: sanitizeNearbyFilters(prefs.filters),
    city: sanitizeCity(prefs.city),
    source: prefs.source === 'location' || prefs.source === 'city' ? prefs.source : null,
    denied: prefs.denied === true,
  };
  try {
    await AsyncStorage.setItem(nearbyPrefsKey(userId), JSON.stringify(entry));
  } catch {
    // Full or unavailable storage: the choice holds for this session.
  }
}

/** Sign-out: her chosen city and filters leave the phone with her session. */
export async function clearNearbyPrefs(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(nearbyPrefsKey(userId));
  } catch {
    // Nothing more to do.
  }
}
