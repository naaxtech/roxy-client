import { create } from 'zustand';
import { getApproxPosition, hasLocationPermission, type PositionFailure, type PositionResult } from '../lib/nearby';
import { DEFAULT_NEARBY_FILTERS, sameNearbyFilters, type NearbyFilters } from '../lib/nearbyFilters';
import { loadNearbyPrefs, saveNearbyPrefs, type ChosenCity, type NearbyPrefs } from '../lib/nearbyPrefs';
import { Analytics } from '../lib/analytics';

/**
 * Nearby, for this session: where she is looking from, whether she said no to
 * location, and her filters. Shared by Discover's rail and the nearby browser
 * so "See all" opens on the same answer without asking again.
 *
 * Her position here is already rounded to 0.1° (lib/nearby) and lives in
 * memory only: it goes into the suggestion RPC and nowhere else. What persists
 * (lib/nearbyPrefs, on the phone) is the source, the city, the filters and the
 * refusal, never a coordinate. Reset on sign-out (store/resetAllStores).
 */

export type NearbyOrigin =
  | { kind: 'location'; lat: number; lng: number }
  | { kind: 'city'; city: ChosenCity };

type NearbyState = {
  /** The member whose preferences are loaded (null = not yet). */
  loadedFor: string | null;
  origin: NearbyOrigin | null;
  /** The last city she chose, kept while her location is the origin. */
  city: ChosenCity | null;
  denied: boolean;
  locating: boolean;
  /** Why the last attempt to locate her failed, when it was not a refusal. */
  locationProblem: Exclude<PositionFailure, 'denied'> | null;
  filters: NearbyFilters;
  /** Reads her preferences; re-locates without asking only if her location was her source and is still granted. */
  load: (userId: string) => Promise<void>;
  /** Her tap on "Use my location": asks, locates, remembers the source. */
  locateMe: (userId: string | null | undefined) => Promise<PositionResult>;
  chooseCity: (userId: string | null | undefined, city: ChosenCity) => void;
  setFilters: (userId: string | null | undefined, filters: NearbyFilters) => void;
};

/** One read of the phone per member, however many surfaces ask at once. */
let loading: { userId: string; promise: Promise<void> } | null = null;
/** One fix at a time: a second tap while locating joins the first (one prompt at most). */
let locatingNow: Promise<PositionResult> | null = null;

export const useNearbyStore = create<NearbyState>((set, get) => {
  const persist = (userId: string | null | undefined) => {
    if (!userId) return;
    const { filters, city, origin, denied } = get();
    const prefs: NearbyPrefs = {
      filters,
      city,
      source: origin ? origin.kind : null,
      denied,
    };
    void saveNearbyPrefs(userId, prefs);
  };

  const applyPosition = (result: PositionResult) => {
    if (result.ok) {
      set({
        origin: { kind: 'location', lat: result.lat, lng: result.lng },
        denied: false,
        locating: false,
        locationProblem: null,
      });
    } else if (result.reason === 'denied') {
      set({ denied: true, locating: false, locationProblem: null });
    } else {
      set({ locating: false, locationProblem: result.reason });
    }
  };

  return {
    loadedFor: null,
    origin: null,
    city: null,
    denied: false,
    locating: false,
    locationProblem: null,
    filters: { ...DEFAULT_NEARBY_FILTERS, categories: [] },

    load: async (userId) => {
      if (get().loadedFor === userId) return;
      if (loading?.userId === userId) return loading.promise;
      const promise = (async () => {
        const prefs = await loadNearbyPrefs(userId);
        // A different member on this phone starts from her own preferences only.
        set({
          loadedFor: userId,
          filters: prefs.filters,
          city: prefs.city,
          denied: prefs.denied,
          origin: prefs.source === 'city' && prefs.city ? { kind: 'city', city: prefs.city } : null,
          locating: false,
          locationProblem: null,
        });
        if (prefs.source === 'location' && !prefs.denied && (await hasLocationPermission())) {
          // Already granted: re-reading is not asking, and not counted as her
          // request. A silent miss explains nothing (she did not ask): the
          // prompt simply comes back.
          set({ locating: true });
          const result = await getApproxPosition({ ask: false });
          if (get().loadedFor !== userId) return;
          if (result.ok) applyPosition(result);
          else set({ locating: false });
        }
      })();
      loading = { userId, promise };
      try {
        await promise;
      } finally {
        if (loading?.promise === promise) loading = null;
      }
    },

    locateMe: (userId) => {
      if (locatingNow) return locatingNow;
      const run = (async () => {
        const forMember = get().loadedFor;
        set({ locating: true, locationProblem: null });
        const result = await getApproxPosition();
        // Signed out (or another member signed in) during the fix: it is not theirs.
        if (get().loadedFor !== forMember) return result;
        applyPosition(result);
        Analytics.nearbyLocationRequested(result.ok ? 'granted' : result.reason);
        persist(userId);
        return result;
      })();
      locatingNow = run;
      // Cleared once settled, whichever way: the next tap asks again.
      void run.then(
        () => { if (locatingNow === run) locatingNow = null; },
        () => { if (locatingNow === run) locatingNow = null; },
      );
      return run;
    },

    chooseCity: (userId, city) => {
      set({ origin: { kind: 'city', city }, city, locating: false, locationProblem: null });
      Analytics.nearbyCityChosen();
      persist(userId);
    },

    setFilters: (userId, filters) => {
      const changed = !sameNearbyFilters(get().filters, filters);
      set({ filters: { ...filters, categories: [...filters.categories] } });
      if (changed) Analytics.nearbyFiltersChanged(filters.radiusKm, filters.categories.length);
      persist(userId);
    },
  };
});
