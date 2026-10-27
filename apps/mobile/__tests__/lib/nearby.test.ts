/**
 * lib/nearby — the device half of "communities near her" (migration 139).
 *
 * What these tests hold, because a location leak can out a member:
 *  - her position is rounded to 0.1° INSIDE the module, before it is returned;
 *    nothing finer ever leaves it, and nothing is logged;
 *  - permission is requested only by `getApproxPosition` (her tap), never at
 *    import and never by `hasLocationPermission`;
 *  - every RPC goes out as supabase-js's default POST, never `{ get: true }`
 *    (139 refuses GET so a position never lands in a logged URL), and every
 *    `error` is checked.
 */
import { Platform } from 'react-native';

jest.mock(
  'expo-location',
  () => ({
    Accuracy: { Lowest: 1, Low: 2, Balanced: 3 },
    requestForegroundPermissionsAsync: jest.fn(),
    getForegroundPermissionsAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
  }),
  // The shared node_modules may not hold the package yet: the mock stands alone.
  { virtual: true },
);
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import {
  CITY_QUERY_MAX,
  POSITION_TIMEOUT_MS,
  WEB_PERMISSION_TIMEOUT_MS,
  WEB_POSITION_MAX_AGE_MS,
  GEONAMES_ATTRIBUTION,
  cityLabel,
  fetchInCity,
  fetchNearby,
  getApproxPosition,
  hasLocationPermission,
  nearbyRowMeta,
  searchCities,
  type NearbyCommunity,
} from '../../lib/nearby';
import { DEFAULT_NEARBY_FILTERS } from '../../lib/nearbyFilters';

const Location = jest.requireMock('expo-location') as {
  requestForegroundPermissionsAsync: jest.Mock;
  getForegroundPermissionsAsync: jest.Mock;
  getCurrentPositionAsync: jest.Mock;
};
const { supabase } = jest.requireMock('../../lib/supabase') as { supabase: { rpc: jest.Mock } };
const { logError } = jest.requireMock('../../lib/errorLogger') as { logError: jest.Mock };

/** A raw fix with far more precision than the server will accept. */
const RAW = { latitude: 14.65471234, longitude: 121.04938765 };
const realOS = Platform.OS;

function grant() {
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true, expires: 'never' });
}

beforeEach(() => {
  jest.useRealTimers();
  Location.requestForegroundPermissionsAsync.mockReset();
  Location.getForegroundPermissionsAsync.mockReset();
  Location.getCurrentPositionAsync.mockReset();
  supabase.rpc.mockReset();
  logError.mockReset();
  Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
});

/** Lets every already-settled promise chain run (fake timers do not touch microtasks). */
async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/** Nothing the module logged may carry a coordinate digit string. */
function expectNoCoordinatesLogged() {
  const logged = JSON.stringify(logError.mock.calls.map((c) => [String(c[0]?.message ?? c[0]), c[1]]));
  expect(logged).not.toMatch(/14\.6|121\.0|14\.7|121\.04/);
}

describe('getApproxPosition — rounded on the device before it goes anywhere', () => {
  it('importing the module asks for nothing', () => {
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('returns only the rounded pair: the raw fix never leaves the module', async () => {
    grant();
    Location.getCurrentPositionAsync.mockResolvedValue({ coords: { ...RAW, accuracy: 3000, altitude: 12 }, timestamp: 1 });

    const result = await getApproxPosition();

    expect(result).toEqual({ ok: true, lat: 14.7, lng: 121 });
    expect(Object.keys(result).sort()).toEqual(['lat', 'lng', 'ok']);
    expectNoCoordinatesLogged();
  });

  it('asks for the lowest accuracy (coarse; no GPS warm-up)', async () => {
    grant();
    Location.getCurrentPositionAsync.mockResolvedValue({ coords: RAW, timestamp: 1 });
    await getApproxPosition();
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith(expect.objectContaining({ accuracy: 1 }));
  });

  it('on web, passes a finite maximumAge (expo-location web defaults it to Infinity) and low accuracy', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    grant();
    Location.getCurrentPositionAsync.mockResolvedValue({ coords: RAW, timestamp: 1 });
    await getApproxPosition();
    const options = Location.getCurrentPositionAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(options.maximumAge).toBe(WEB_POSITION_MAX_AGE_MS);
    expect(Number.isFinite(options.maximumAge)).toBe(true);
    expect(options.enableHighAccuracy).toBe(false);
  });

  it('{ ask: false } (the silent resume) reads the grant and can never show a prompt', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Location.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted', granted: true });
    Location.getCurrentPositionAsync.mockResolvedValue({ coords: RAW, timestamp: 1 });
    await expect(getApproxPosition({ ask: false })).resolves.toEqual({ ok: true, lat: 14.7, lng: 121 });
    // Android: expo-location 17 defaults mayShowUserSettingsDialog to true, which
    // opens the system "turn on device location" dialog when the network
    // provider is off. A resume she did not tap must never put that on screen.
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mayShowUserSettingsDialog: false }),
    );

    Location.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined', granted: false });
    await expect(getApproxPosition({ ask: false })).resolves.toEqual({ ok: false, reason: 'denied' });
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('her tap may show Android\'s "turn on location" dialog: she asked for her location', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    grant();
    Location.getCurrentPositionAsync.mockResolvedValue({ coords: RAW, timestamp: 1 });
    await getApproxPosition();
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mayShowUserSettingsDialog: true }),
    );
  });

  it('web: a browser prompt she ignores ends as a timeout, never a rail that loads forever', async () => {
    jest.useFakeTimers();
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    // expo-location's web request waits on navigator.geolocation with no
    // timeout of its own: an ignored prompt never settles.
    Location.requestForegroundPermissionsAsync.mockReturnValue(new Promise(() => undefined));
    let settled: unknown = 'pending';
    const pending = getApproxPosition();
    void pending.then((r) => { settled = r; });
    jest.advanceTimersByTime(WEB_PERMISSION_TIMEOUT_MS - 1);
    await flushMicrotasks();
    expect(settled).toBe('pending');
    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('native: the OS permission dialog is not raced (she may read it as long as she likes)', async () => {
    jest.useFakeTimers();
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    Location.requestForegroundPermissionsAsync.mockReturnValue(new Promise(() => undefined));
    let settled: unknown = 'pending';
    void getApproxPosition().then((r) => { settled = r; });
    jest.advanceTimersByTime(WEB_PERMISSION_TIMEOUT_MS * 4);
    await flushMicrotasks();
    expect(settled).toBe('pending');
  });

  it('denied: says so and never reads a position', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', granted: false, canAskAgain: false, expires: 'never' });
    await expect(getApproxPosition()).resolves.toEqual({ ok: false, reason: 'denied' });
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('a browser PERMISSION_DENIED (code 1) is a refusal, code 3 is a timeout', async () => {
    grant();
    Location.getCurrentPositionAsync.mockRejectedValueOnce({ code: 1, message: 'User denied Geolocation' });
    await expect(getApproxPosition()).resolves.toEqual({ ok: false, reason: 'denied' });
    Location.getCurrentPositionAsync.mockRejectedValueOnce({ code: 3, message: 'Timeout expired' });
    await expect(getApproxPosition()).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('location services off, or the permission call failing, is "unavailable"', async () => {
    grant();
    Location.getCurrentPositionAsync.mockRejectedValueOnce(
      Object.assign(new Error('Location services are disabled'), { code: 'E_LOCATION_SERVICES_DISABLED' }),
    );
    await expect(getApproxPosition()).resolves.toEqual({ ok: false, reason: 'unavailable' });

    Location.requestForegroundPermissionsAsync.mockRejectedValueOnce(new Error('UnavailabilityError'));
    await expect(getApproxPosition()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('a fix that never comes is a timeout, not a hang', async () => {
    jest.useFakeTimers();
    grant();
    Location.getCurrentPositionAsync.mockReturnValue(new Promise(() => undefined));
    const pending = getApproxPosition();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(POSITION_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('a nonsense fix is "unavailable", never NaN sent onward', async () => {
    grant();
    Location.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: Number.NaN, longitude: 121 }, timestamp: 1 });
    await expect(getApproxPosition()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('no usable native module (an old binary, a web shim): "unavailable", never a crash', async () => {
    const mod = Location as unknown as Record<string, unknown>;
    const real = mod.getCurrentPositionAsync;
    mod.getCurrentPositionAsync = undefined;
    try {
      grant();
      await expect(getApproxPosition()).resolves.toEqual({ ok: false, reason: 'unavailable' });
      await expect(hasLocationPermission()).resolves.toBe(false);
      expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    } finally {
      mod.getCurrentPositionAsync = real;
    }
  });
});

describe('hasLocationPermission — reads the grant, never asks', () => {
  it('true only when already granted', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted', granted: true });
    await expect(hasLocationPermission()).resolves.toBe(true);
    Location.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined', granted: false });
    await expect(hasLocationPermission()).resolves.toBe(false);
    Location.getForegroundPermissionsAsync.mockRejectedValueOnce(new Error('no permissions API'));
    await expect(hasLocationPermission()).resolves.toBe(false);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

const ROW = {
  id: 'c1', name: 'Makati Book Club', slug: 'makati-book-club', description: null, cover_image_url: null,
  category: 'interest', is_private: false, member_count: 12, created_by: 'u9', created_at: '2026-10-01T00:00:00Z',
  city_id: 1701668, city_name: 'Makati City', meets: 'in_person', distance_band: 'under_10',
};

describe('fetchNearby — suggest_nearby_communities, POST only', () => {
  it('sends the rounded pair and the filters, with no { get: true }', async () => {
    supabase.rpc.mockResolvedValue({ data: [ROW], error: null });
    const rows = await fetchNearby({ lat: 14.6, lng: 121, filters: DEFAULT_NEARBY_FILTERS, limit: 3 });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    const [fn, args, options] = supabase.rpc.mock.calls[0];
    expect(fn).toBe('suggest_nearby_communities');
    expect(args).toEqual({
      p_lat: 14.6, p_lng: 121, p_radius_km: 50, p_categories: null, p_meets: null, p_open_only: false, p_limit: 3,
    });
    expect(options).toBeUndefined();
    expect(rows).toEqual([ROW]);
  });

  it('refuses an unrounded pair before the network', async () => {
    await expect(fetchNearby({ lat: 14.65, lng: 121, filters: DEFAULT_NEARBY_FILTERS, limit: 3 })).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('an error is a null (the rail shows Try again), logged by code with no position', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'radius must be…', details: null, hint: null } });
    await expect(fetchNearby({ lat: 14.6, lng: 121, filters: DEFAULT_NEARBY_FILTERS, limit: 3 })).resolves.toBeNull();
    expect(logError).toHaveBeenCalledTimes(1);
    expectNoCoordinatesLogged();
  });

  it('a thrown network failure is a null too', async () => {
    supabase.rpc.mockRejectedValue(new TypeError('Network request failed'));
    await expect(fetchNearby({ lat: 14.6, lng: 121, filters: DEFAULT_NEARBY_FILTERS, limit: 3 })).resolves.toBeNull();
  });

  it('drops malformed rows instead of rendering them', async () => {
    supabase.rpc.mockResolvedValue({ data: [ROW, { name: 'no id' }, null], error: null });
    await expect(fetchNearby({ lat: 14.6, lng: 121, filters: DEFAULT_NEARBY_FILTERS, limit: 3 })).resolves.toEqual([ROW]);
  });
});

describe('fetchInCity — suggest_communities_in_city, POST only', () => {
  it('sends the city and the filters, never a position', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });
    await fetchInCity(1701668, {
      filters: { radiusKm: 25, categories: ['identity', 'support'], meets: 'both', openOnly: true }, limit: 50,
    });
    const [fn, args, options] = supabase.rpc.mock.calls[0];
    expect(fn).toBe('suggest_communities_in_city');
    expect(args).toEqual({
      p_city_id: 1701668, p_radius_km: 25, p_categories: ['identity', 'support'], p_meets: ['both'], p_open_only: true, p_limit: 50,
    });
    expect(args).not.toHaveProperty('p_lat');
    expect(options).toBeUndefined();
  });

  it('an error is a null', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'city not found' } });
    await expect(fetchInCity(1, { filters: DEFAULT_NEARBY_FILTERS, limit: 3 })).resolves.toBeNull();
  });
});

describe('searchCities — search_cities, POST only, 2+ characters', () => {
  it('under two characters asks nothing', async () => {
    await expect(searchCities(' q ')).resolves.toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('trims, caps at the server limit, and never uses GET', async () => {
    supabase.rpc.mockResolvedValue({ data: [{ id: 1, name: 'Quezon City', admin1: 'Metro Manila', country_code: 'PH', population: 2_761_720 }], error: null });
    const rows = await searchCities('  Quezon  ');
    expect(supabase.rpc).toHaveBeenCalledWith('search_cities', { p_q: 'Quezon' });
    expect(supabase.rpc.mock.calls[0][2]).toBeUndefined();
    expect(rows).toHaveLength(1);

    await searchCities('x'.repeat(CITY_QUERY_MAX + 10));
    expect((supabase.rpc.mock.calls[1][1] as { p_q: string }).p_q).toHaveLength(CITY_QUERY_MAX);
  });

  it('an error is a null; what she typed is never logged', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'search needs 2 to 60 characters' } });
    await expect(searchCities('Quezon')).resolves.toBeNull();
    expect(JSON.stringify(logError.mock.calls.map((c) => String(c[0]?.message ?? c[0])))).not.toContain('Quezon');
  });
});

describe('cityLabel — "City, Region, Country"', () => {
  it('names the country from its code', () => {
    const label = cityLabel({ name: 'Quezon City', admin1: 'Metro Manila', country_code: 'PH' });
    expect(label.startsWith('Quezon City, Metro Manila, ')).toBe(true);
    expect(label).not.toContain('undefined');
  });

  it('drops a bare GeoNames admin1 code and repeated parts', () => {
    expect(cityLabel({ name: 'Cebu City', admin1: '07', country_code: 'PH' })).not.toContain('07');
    expect(cityLabel({ name: 'Singapore', admin1: null, country_code: 'SG' })).toBe('Singapore');
  });

  it('falls back to the code where the platform has no Intl.DisplayNames', () => {
    const intl = Intl as unknown as { DisplayNames?: unknown };
    const real = intl.DisplayNames;
    intl.DisplayNames = undefined;
    try {
      expect(cityLabel({ name: 'Lagos', admin1: 'Lagos', country_code: 'NG' })).toBe('Lagos, NG');
    } finally {
      intl.DisplayNames = real;
    }
  });
});

describe('GEONAMES_ATTRIBUTION — the CC BY 4.0 credit the city data needs', () => {
  it('names GeoNames and the licence', () => {
    expect(GEONAMES_ATTRIBUTION).toBe('City data © GeoNames (CC BY 4.0)');
  });
});

describe('nearbyRowMeta — band, city, members', () => {
  it('"Within 10 km · Makati City · 12 members"', () => {
    expect(nearbyRowMeta(ROW as NearbyCommunity)).toBe('Within 10 km · Makati City · 12 members');
  });

  it('an unknown band renders nothing for the band, and one member is singular', () => {
    expect(nearbyRowMeta({ ...ROW, distance_band: 'mystery', member_count: 1 } as NearbyCommunity)).toBe('Makati City · 1 member');
  });
});
