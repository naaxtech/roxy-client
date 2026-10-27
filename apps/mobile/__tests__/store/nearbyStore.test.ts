/**
 * The nearby session state: where she is looking from (her rounded position,
 * in memory only, or a city she chose), whether she said no to location, and
 * her filters. Preferences persist on the phone; coordinates never do.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../../lib/nearby', () => ({
  getApproxPosition: jest.fn(),
  hasLocationPermission: jest.fn(),
}));
jest.mock('../../lib/analytics', () => ({
  Analytics: {
    nearbyRailViewed: jest.fn(),
    nearbyLocationRequested: jest.fn(),
    nearbyCityChosen: jest.fn(),
    nearbyFiltersChanged: jest.fn(),
  },
}));

import { useNearbyStore } from '../../store/nearbyStore';
import { loadNearbyPrefs, nearbyPrefsKey, saveNearbyPrefs } from '../../lib/nearbyPrefs';
import { DEFAULT_NEARBY_FILTERS } from '../../lib/nearbyFilters';

const nearby = jest.requireMock('../../lib/nearby') as { getApproxPosition: jest.Mock; hasLocationPermission: jest.Mock };
const { Analytics } = jest.requireMock('../../lib/analytics') as { Analytics: Record<string, jest.Mock> };

const CITY = { id: 1701668, label: 'Makati City, Metro Manila, Philippines' };

beforeEach(async () => {
  await AsyncStorage.clear();
  useNearbyStore.setState(useNearbyStore.getInitialState(), true);
  nearby.getApproxPosition.mockReset();
  nearby.hasLocationPermission.mockReset().mockResolvedValue(false);
  Object.values(Analytics).forEach((m) => m.mockReset());
});

describe('load — her phone remembers, the network is never asked', () => {
  it('nothing stored: no origin, not refused, default filters', async () => {
    await useNearbyStore.getState().load('u1');
    const s = useNearbyStore.getState();
    expect(s.loadedFor).toBe('u1');
    expect(s.origin).toBeNull();
    expect(s.denied).toBe(false);
    expect(s.filters).toEqual(DEFAULT_NEARBY_FILTERS);
    expect(nearby.getApproxPosition).not.toHaveBeenCalled();
  });

  it('a city she chose last time is where she looks from', async () => {
    await saveNearbyPrefs('u1', { filters: { ...DEFAULT_NEARBY_FILTERS, radiusKm: 25 }, city: CITY, source: 'city', denied: false });
    await useNearbyStore.getState().load('u1');
    expect(useNearbyStore.getState().origin).toEqual({ kind: 'city', city: CITY });
    expect(useNearbyStore.getState().filters.radiusKm).toBe(25);
  });

  it('her location last time, still granted: located again without asking', async () => {
    await saveNearbyPrefs('u1', { filters: DEFAULT_NEARBY_FILTERS, city: null, source: 'location', denied: false });
    nearby.hasLocationPermission.mockResolvedValue(true);
    nearby.getApproxPosition.mockResolvedValue({ ok: true, lat: 14.6, lng: 121 });
    await useNearbyStore.getState().load('u1');
    expect(useNearbyStore.getState().origin).toEqual({ kind: 'location', lat: 14.6, lng: 121 });
    // Read-only permission path: a resume can never put a prompt on screen.
    expect(nearby.getApproxPosition).toHaveBeenCalledWith({ ask: false });
    // A silent resume is not her tap: it is not counted as a request.
    expect(Analytics.nearbyLocationRequested).not.toHaveBeenCalled();
  });

  it('her location last time but the grant is gone: nothing is read, nothing asked', async () => {
    await saveNearbyPrefs('u1', { filters: DEFAULT_NEARBY_FILTERS, city: null, source: 'location', denied: false });
    nearby.hasLocationPermission.mockResolvedValue(false);
    await useNearbyStore.getState().load('u1');
    expect(nearby.getApproxPosition).not.toHaveBeenCalled();
    expect(useNearbyStore.getState().origin).toBeNull();
  });

  it('a second member on the same phone starts clean', async () => {
    await saveNearbyPrefs('u1', { filters: DEFAULT_NEARBY_FILTERS, city: CITY, source: 'city', denied: true });
    await useNearbyStore.getState().load('u1');
    await useNearbyStore.getState().load('u2');
    const s = useNearbyStore.getState();
    expect(s.loadedFor).toBe('u2');
    expect(s.origin).toBeNull();
    expect(s.denied).toBe(false);
  });

  it('two callers at once read the phone once', async () => {
    // getItem is already the async-storage mock's jest.fn: clear its history first.
    const spy = jest.spyOn(AsyncStorage, 'getItem');
    spy.mockClear();
    await Promise.all([useNearbyStore.getState().load('u1'), useNearbyStore.getState().load('u1')]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('locateMe — her tap', () => {
  beforeEach(async () => { await useNearbyStore.getState().load('u1'); });

  it('granted: looks from her rounded position, remembers the SOURCE (never the coordinates)', async () => {
    nearby.getApproxPosition.mockResolvedValue({ ok: true, lat: 14.6, lng: 121 });
    await useNearbyStore.getState().locateMe('u1');
    expect(useNearbyStore.getState().origin).toEqual({ kind: 'location', lat: 14.6, lng: 121 });
    expect(useNearbyStore.getState().locating).toBe(false);
    expect((await loadNearbyPrefs('u1')).source).toBe('location');
    const raw = await AsyncStorage.getItem(nearbyPrefsKey('u1'));
    expect(raw).not.toMatch(/14\.6|121|lat|lng/);
    expect(Analytics.nearbyLocationRequested).toHaveBeenCalledWith('granted');
  });

  it('refused: remembered so the rail never asks again; a chosen city stays', async () => {
    useNearbyStore.getState().chooseCity('u1', CITY);
    nearby.getApproxPosition.mockResolvedValue({ ok: false, reason: 'denied' });
    await useNearbyStore.getState().locateMe('u1');
    const s = useNearbyStore.getState();
    expect(s.denied).toBe(true);
    expect(s.origin).toEqual({ kind: 'city', city: CITY });
    expect((await loadNearbyPrefs('u1')).denied).toBe(true);
    expect(Analytics.nearbyLocationRequested).toHaveBeenCalledWith('denied');
  });

  it('a timeout is a problem to explain, not a refusal', async () => {
    nearby.getApproxPosition.mockResolvedValue({ ok: false, reason: 'timeout' });
    await useNearbyStore.getState().locateMe('u1');
    const s = useNearbyStore.getState();
    expect(s.denied).toBe(false);
    expect(s.locationProblem).toBe('timeout');
    expect(Analytics.nearbyLocationRequested).toHaveBeenCalledWith('timeout');
  });

  it('a second tap while locating joins the first: one fix, one prompt at most, one event', async () => {
    let resolve: (r: unknown) => void = () => undefined;
    nearby.getApproxPosition.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const first = useNearbyStore.getState().locateMe('u1');
    const second = useNearbyStore.getState().locateMe('u1');
    resolve({ ok: true, lat: 14.6, lng: 121 });
    await expect(first).resolves.toEqual({ ok: true, lat: 14.6, lng: 121 });
    await expect(second).resolves.toEqual({ ok: true, lat: 14.6, lng: 121 });
    expect(nearby.getApproxPosition).toHaveBeenCalledTimes(1);
    expect(Analytics.nearbyLocationRequested).toHaveBeenCalledTimes(1);
  });

  it('a fix that lands after she signs out is dropped, not handed to the next member', async () => {
    let resolve: (r: unknown) => void = () => undefined;
    nearby.getApproxPosition.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const pending = useNearbyStore.getState().locateMe('u1');
    useNearbyStore.setState(useNearbyStore.getInitialState(), true);
    await useNearbyStore.getState().load('u2');
    resolve({ ok: true, lat: 14.6, lng: 121 });
    await pending;
    expect(useNearbyStore.getState().origin).toBeNull();
    expect(await AsyncStorage.getItem(nearbyPrefsKey('u2'))).toBeNull();
  });

  it('a later success clears the refusal and the problem', async () => {
    nearby.getApproxPosition.mockResolvedValueOnce({ ok: false, reason: 'denied' });
    await useNearbyStore.getState().locateMe('u1');
    nearby.getApproxPosition.mockResolvedValueOnce({ ok: true, lat: 1.3, lng: 103.8 });
    await useNearbyStore.getState().locateMe('u1');
    expect(useNearbyStore.getState().denied).toBe(false);
    expect(useNearbyStore.getState().locationProblem).toBeNull();
  });
});

describe('chooseCity and setFilters', () => {
  beforeEach(async () => { await useNearbyStore.getState().load('u1'); });

  it('a chosen city is the origin and is remembered; analytics never names it', async () => {
    useNearbyStore.getState().chooseCity('u1', CITY);
    expect(useNearbyStore.getState().origin).toEqual({ kind: 'city', city: CITY });
    await new Promise((r) => setImmediate(r));
    expect(await loadNearbyPrefs('u1')).toMatchObject({ city: CITY, source: 'city' });
    expect(Analytics.nearbyCityChosen).toHaveBeenCalledWith();
  });

  it('filters are remembered, and a change is counted by radius and category count only', async () => {
    const next = { radiusKm: 25 as const, categories: ['identity' as const, 'support' as const], meets: 'all' as const, openOnly: false };
    useNearbyStore.getState().setFilters('u1', next);
    expect(useNearbyStore.getState().filters).toEqual(next);
    await new Promise((r) => setImmediate(r));
    expect((await loadNearbyPrefs('u1')).filters).toEqual(next);
    expect(Analytics.nearbyFiltersChanged).toHaveBeenCalledWith(25, 2);

    Analytics.nearbyFiltersChanged.mockReset();
    useNearbyStore.getState().setFilters('u1', { ...next });
    expect(Analytics.nearbyFiltersChanged).not.toHaveBeenCalled();
  });

  it('signed out: nothing is written to the phone', async () => {
    useNearbyStore.getState().setFilters(null, { ...DEFAULT_NEARBY_FILTERS, radiusKm: 10 });
    await new Promise((r) => setImmediate(r));
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });
});
