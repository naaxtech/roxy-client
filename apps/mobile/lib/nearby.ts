import { Platform } from 'react-native';
import { supabase } from './supabase';
import { logError } from './errorLogger';
import { distanceBandLabel, isNearbyRadius, isRoundedCoord, roundCoord } from './nearbyCoords';
import { nearbyRpcFilters, type NearbyFilters } from './nearbyFilters';

/**
 * Nearby communities: her approximate position and the three RPCs of
 * migration 139. A location leak can out a member, so:
 *
 *  - Permission is requested only from `getApproxPosition`, which runs from her
 *    tap on "Use my location" (spec › Safety 2). `hasLocationPermission` reads
 *    the grant without asking.
 *  - The fix is rounded to 0.1° (about 11 km) HERE, before it is returned. The
 *    raw coordinates never leave this file, are never stored and never logged:
 *    failures log an error code, never a value.
 *  - Every RPC goes out as supabase-js `rpc()`'s default POST and never with
 *    `{ get: true }`: the functions refuse GET, because a GET would put her
 *    position (or the city she typed) in a URL the gateway logs. Every call
 *    checks `error`.
 *
 * `expo-location` is loaded on first use through a guarded `require` and typed
 * by the structural subset below (the pattern of `lib/video/DailyProvider.ts`):
 * nothing touches the native module until she asks, a binary without it reads
 * as "unavailable" instead of crashing, and the types do not depend on the
 * package being present in the shared `node_modules`.
 * src: https://github.com/expo/expo/blob/sdk-51/packages/expo-location/src/Location.ts · expo-location 17.0.1 · 2026-10-27
 * src: https://github.com/expo/expo/blob/sdk-51/packages/expo-location/src/ExpoLocation.web.ts · expo-location 17.0.1 · 2026-10-27
 */

export type PositionFailure = 'denied' | 'unavailable' | 'timeout';
export type PositionResult = { ok: true; lat: number; lng: number } | { ok: false; reason: PositionFailure };

/** A coarse fix that has not come in this long is not coming. */
export const POSITION_TIMEOUT_MS = 15_000;
/**
 * Web: expo-location's web module passes `{ maximumAge: Infinity, ...options }`
 * to `navigator.geolocation`, so without this a browser may answer with a
 * position from any time in the past. Five minutes is fresh at 11 km.
 */
export const WEB_POSITION_MAX_AGE_MS = 5 * 60_000;

/** The part of expo-location 17 this file uses (Location.ts / Location.types.ts, sdk-51). */
type PermissionAnswer = { status: string; granted: boolean };
type LocationModule = {
  Accuracy: { Lowest: number };
  requestForegroundPermissionsAsync: () => Promise<PermissionAnswer>;
  getForegroundPermissionsAsync: () => Promise<PermissionAnswer>;
  getCurrentPositionAsync: (options: {
    accuracy: number;
    /** Web only: spread over expo-location's navigator.geolocation defaults. */
    maximumAge?: number;
    enableHighAccuracy?: boolean;
  }) => Promise<{ coords: { latitude: number; longitude: number } }>;
};

function locationModule(): LocationModule | null {
  try {
    const mod = require('expo-location') as Partial<LocationModule> | undefined;
    if (
      typeof mod?.getCurrentPositionAsync !== 'function'
      || typeof mod.requestForegroundPermissionsAsync !== 'function'
      || typeof mod.getForegroundPermissionsAsync !== 'function'
      || typeof mod.Accuracy?.Lowest !== 'number'
    ) {
      return null;
    }
    return mod as LocationModule;
  } catch {
    return null;
  }
}

/** A browser GeolocationPositionError carries a number; expo's native errors a string code. */
function failureOf(e: unknown): PositionFailure {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 1 || (typeof code === 'string' && /UNAUTHORIZED|PERMISSION/i.test(code))) return 'denied';
  if (code === 3 || (typeof code === 'string' && /TIMEOUT/i.test(code))) return 'timeout';
  return 'unavailable';
}

const TIMED_OUT = Symbol('timeout');

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Her approximate position, rounded on the device, from one coarse fix.
 *
 * `ask` (default true) requests permission: call it that way only from her
 * tap. `{ ask: false }` reads the existing grant instead and can never put a
 * prompt on screen (the store's silent resume); no grant reads as `denied`.
 */
export async function getApproxPosition({ ask = true }: { ask?: boolean } = {}): Promise<PositionResult> {
  const Location = locationModule();
  if (!Location) return { ok: false, reason: 'unavailable' };

  try {
    const permission = ask
      ? await Location.requestForegroundPermissionsAsync()
      : await Location.getForegroundPermissionsAsync();
    if (!permission?.granted) return { ok: false, reason: 'denied' };
  } catch {
    // Web without the Permissions API, or a native module error.
    return { ok: false, reason: 'unavailable' };
  }

  const options = Platform.OS === 'web'
    ? { accuracy: Location.Accuracy.Lowest, maximumAge: WEB_POSITION_MAX_AGE_MS, enableHighAccuracy: false }
    : { accuracy: Location.Accuracy.Lowest };

  let fix: { coords: { latitude: number; longitude: number } } | typeof TIMED_OUT;
  try {
    fix = await withTimeout(Location.getCurrentPositionAsync(options), POSITION_TIMEOUT_MS);
  } catch (e) {
    return { ok: false, reason: failureOf(e) };
  }
  if (fix === TIMED_OUT) return { ok: false, reason: 'timeout' };

  try {
    // Rounded here, before anything else can see it. roundCoord throws on NaN/Infinity.
    const lat = roundCoord(fix.coords.latitude);
    const lng = roundCoord(fix.coords.longitude);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, reason: 'unavailable' };
    return { ok: true, lat, lng };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** Is location already granted? Reads the grant; never shows a prompt. */
export async function hasLocationPermission(): Promise<boolean> {
  const Location = locationModule();
  if (!Location) return false;
  try {
    return (await Location.getForegroundPermissionsAsync())?.granted === true;
  } catch {
    return false;
  }
}

// ─── the RPCs ──────────────────────────────────────────────────────────────

export type NearbyCommunity = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  cover_image_url: string | null;
  category: string;
  is_private: boolean;
  member_count: number;
  created_by: string;
  created_at: string;
  city_id: number | null;
  city_name: string | null;
  meets: string;
  /** under_10 … farther; never kilometres. */
  distance_band: string;
};

export type CityOption = {
  id: number;
  name: string;
  admin1: string | null;
  country_code: string;
  population: number;
};

/** The RPCs' own ceiling (139: limit 1..50). */
export const NEARBY_FETCH_MAX = 50;
export const CITY_QUERY_MIN = 2;
export const CITY_QUERY_MAX = 60;

type FetchParams = { filters: NearbyFilters; limit: number };

function isCommunityRow(r: unknown): r is NearbyCommunity {
  if (!r || typeof r !== 'object') return false;
  const x = r as Record<string, unknown>;
  return typeof x.id === 'string' && typeof x.name === 'string' && typeof x.distance_band === 'string';
}

function rowsOf(data: unknown): NearbyCommunity[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isCommunityRow).map((r) => ({
    ...r,
    is_private: r.is_private === true,
    member_count: typeof r.member_count === 'number' ? r.member_count : 0,
  }));
}

function clampLimit(limit: number): number {
  return Math.min(NEARBY_FETCH_MAX, Math.max(1, Math.floor(limit)));
}

/** Logs that a call failed and its Postgres/PostgREST code. Never a message, never a value. */
function logRpcFailure(context: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  logError(new Error(`${context} failed (${typeof code === 'string' && code ? code : 'no code'})`), context);
}

async function callSuggest(fn: string, args: Record<string, unknown>, context: string): Promise<NearbyCommunity[] | null> {
  try {
    // POST (supabase-js's default). Never pass { get: true }: 139 refuses GET.
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      logRpcFailure(context, error);
      return null;
    }
    return rowsOf(data);
  } catch (e) {
    logRpcFailure(context, e);
    return null;
  }
}

/** Communities near her rounded position, nearest first. Null = it failed (show Try again). */
export async function fetchNearby(params: { lat: number; lng: number } & FetchParams): Promise<NearbyCommunity[] | null> {
  const { lat, lng, filters, limit } = params;
  // Defence in depth: the server refuses anything finer, but it should never be sent.
  if (!isRoundedCoord(lat) || !isRoundedCoord(lng) || !isNearbyRadius(filters.radiusKm)) return null;
  return callSuggest('suggest_nearby_communities', {
    p_lat: lat,
    p_lng: lng,
    ...nearbyRpcFilters(filters),
    p_limit: clampLimit(limit),
  }, 'nearby.fetchNearby');
}

/** Communities near a city she chose. Null = it failed. */
export async function fetchInCity(cityId: number, params: FetchParams): Promise<NearbyCommunity[] | null> {
  const { filters, limit } = params;
  if (!Number.isInteger(cityId) || cityId <= 0 || !isNearbyRadius(filters.radiusKm)) return null;
  return callSuggest('suggest_communities_in_city', {
    p_city_id: cityId,
    ...nearbyRpcFilters(filters),
    p_limit: clampLimit(limit),
  }, 'nearby.fetchInCity');
}

function isCityRow(r: unknown): r is CityOption {
  if (!r || typeof r !== 'object') return false;
  const x = r as Record<string, unknown>;
  return typeof x.id === 'number' && typeof x.name === 'string' && typeof x.country_code === 'string';
}

/**
 * The city picker: top 10 by population whose name starts with `q`. Under two
 * characters asks nothing (the server refuses it). Null = it failed. What she
 * typed is never logged.
 */
export async function searchCities(q: string): Promise<CityOption[] | null> {
  const query = q.trim().slice(0, CITY_QUERY_MAX);
  if (query.length < CITY_QUERY_MIN) return [];
  try {
    const { data, error } = await supabase.rpc('search_cities', { p_q: query });
    if (error) {
      logRpcFailure('nearby.searchCities', error);
      return null;
    }
    return Array.isArray(data)
      ? data.filter(isCityRow).map((c) => ({
        id: c.id,
        name: c.name,
        admin1: typeof c.admin1 === 'string' ? c.admin1 : null,
        country_code: c.country_code,
        population: typeof c.population === 'number' ? c.population : 0,
      }))
      : [];
  } catch (e) {
    logRpcFailure('nearby.searchCities', e);
    return null;
  }
}

// ─── words ─────────────────────────────────────────────────────────────────

type DisplayNamesCtor = new (locales: string[] | undefined, options: { type: 'region' }) => { of: (code: string) => string | undefined };

/** "Philippines" for "PH" where the platform can say it (Hermes may not), else the code. */
function countryName(code: string): string {
  try {
    const Ctor = (Intl as unknown as { DisplayNames?: DisplayNamesCtor }).DisplayNames;
    if (typeof Ctor !== 'function') return code;
    return new Ctor(undefined, { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * "City, Region, Country". A bare GeoNames admin1 code ("07") is not a region
 * name, so it is dropped; a part that repeats the one before it is dropped.
 */
export function cityLabel(city: Pick<CityOption, 'name' | 'admin1' | 'country_code'>): string {
  const region = city.admin1 && !/^[0-9]+$/.test(city.admin1.trim()) ? city.admin1.trim() : null;
  const parts = [city.name.trim(), region, countryName(city.country_code)].filter((p): p is string => !!p);
  return parts.filter((p, i) => i === 0 || p !== parts[i - 1]).join(', ');
}

/** "Within 10 km · Makati City · 12 members". An unknown band shows nothing for it. */
export function nearbyRowMeta(c: Pick<NearbyCommunity, 'distance_band' | 'city_name' | 'member_count'>): string {
  const n = Math.max(0, c.member_count ?? 0);
  const members = `${n.toLocaleString()} ${n === 1 ? 'member' : 'members'}`;
  return [distanceBandLabel(c.distance_band), c.city_name, members].filter(Boolean).join(' · ');
}
