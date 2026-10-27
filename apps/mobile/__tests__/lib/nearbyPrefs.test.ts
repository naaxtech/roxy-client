/**
 * Nearby preferences live on her phone only: last-used filters, the city she
 * chose, whether her own location was her last source, and whether she said
 * no to location. Never a coordinate. Keyed by her member id (two women can
 * share a phone) and removed when she signs out.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_NEARBY_PREFS,
  clearNearbyPrefs,
  loadNearbyPrefs,
  nearbyPrefsKey,
  saveNearbyPrefs,
  type NearbyPrefs,
} from '../../lib/nearbyPrefs';

const PREFS: NearbyPrefs = {
  filters: { radiusKm: 25, categories: ['support'], meets: 'in_person', openOnly: true },
  city: { id: 1701668, label: 'Makati City, Metro Manila, Philippines' },
  source: 'city',
  denied: true,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('nearbyPrefs', () => {
  it('nothing stored: the defaults', async () => {
    await expect(loadNearbyPrefs('u1')).resolves.toEqual(DEFAULT_NEARBY_PREFS);
    expect(DEFAULT_NEARBY_PREFS).toEqual({
      filters: { radiusKm: 50, categories: [], meets: 'all', openOnly: false },
      city: null,
      source: null,
      denied: false,
    });
  });

  it('round-trips, per member', async () => {
    await saveNearbyPrefs('u1', PREFS);
    await expect(loadNearbyPrefs('u1')).resolves.toEqual(PREFS);
    await expect(loadNearbyPrefs('u2')).resolves.toEqual(DEFAULT_NEARBY_PREFS);
  });

  it('never writes a coordinate, even if a caller hands one over', async () => {
    const sneaky = { ...PREFS, source: 'location', lat: 14.6, lng: 121, coords: { latitude: 14.65 } } as unknown as NearbyPrefs;
    await saveNearbyPrefs('u1', sneaky);
    const raw = await AsyncStorage.getItem(nearbyPrefsKey('u1'));
    expect(raw).not.toBeNull();
    expect(raw).not.toMatch(/lat|lng|coords|14\.6|121/);
  });

  it('a corrupted or tampered value is cleaned, never a crash', async () => {
    await AsyncStorage.setItem(nearbyPrefsKey('u1'), '{not json');
    await expect(loadNearbyPrefs('u1')).resolves.toEqual(DEFAULT_NEARBY_PREFS);

    await AsyncStorage.setItem(nearbyPrefsKey('u1'), JSON.stringify({
      v: 1,
      filters: { radiusKm: 7 },
      city: { id: 'abc', label: 'x' },
      source: 'gps',
      denied: 'maybe',
    }));
    await expect(loadNearbyPrefs('u1')).resolves.toEqual(DEFAULT_NEARBY_PREFS);
  });

  it('a city without a label, or a label too long to be ours, is dropped', async () => {
    await AsyncStorage.setItem(nearbyPrefsKey('u1'), JSON.stringify({ v: 1, city: { id: 5, label: '' }, source: 'city' }));
    await expect(loadNearbyPrefs('u1')).resolves.toMatchObject({ city: null, source: null });
    await AsyncStorage.setItem(nearbyPrefsKey('u1'), JSON.stringify({ v: 1, city: { id: 5, label: 'x'.repeat(500) }, source: 'city' }));
    await expect(loadNearbyPrefs('u1')).resolves.toMatchObject({ city: null });
  });

  it('clear removes hers and only hers', async () => {
    await saveNearbyPrefs('u1', PREFS);
    await saveNearbyPrefs('u2', PREFS);
    await clearNearbyPrefs('u1');
    await expect(loadNearbyPrefs('u1')).resolves.toEqual(DEFAULT_NEARBY_PREFS);
    await expect(loadNearbyPrefs('u2')).resolves.toEqual(PREFS);
  });

  it('storage trouble never throws', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(loadNearbyPrefs('u1')).resolves.toEqual(DEFAULT_NEARBY_PREFS);
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('full'));
    await expect(saveNearbyPrefs('u1', PREFS)).resolves.toBeUndefined();
    jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('disk'));
    await expect(clearNearbyPrefs('u1')).resolves.toBeUndefined();
  });
});
