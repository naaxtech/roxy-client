import { useRef } from 'react';
import { useRail, type RailData } from '../discover/useRail';
import { fetchInCity, fetchNearby, type NearbyCommunity } from '../../lib/nearby';
import { useNearbyStore, type NearbyOrigin } from '../../store/nearbyStore';
import type { NearbyFilters } from '../../lib/nearbyFilters';

/** Re-run whenever where she looks from, or what she filters for, changes. */
function keyOf(origin: NearbyOrigin | null, filters: NearbyFilters, limit: number): string {
  const from = !origin ? 'none' : origin.kind === 'city' ? `city:${origin.city.id}` : `here:${origin.lat},${origin.lng}`;
  return `${from}|${filters.radiusKm}|${filters.categories.join(',')}|${filters.meets}|${filters.openOnly}|${limit}`;
}

/**
 * The suggestions for the current origin and filters, through Discover's own
 * `useRail` (one status, Try again, superseded answers dropped). No cache
 * scope: what is near her is never written to the phone. With no origin
 * there is nothing to ask, and the caller shows the prompt instead.
 *
 * The status reads `loading` from the very render in which the origin or the
 * filters change: `useRail` only starts the new run in its effect, and the
 * render between would otherwise show the old answer, or "No communities near
 * you yet" for one frame after she taps Use my location.
 */
export function useNearbyResults(limit: number): RailData<NearbyCommunity> {
  const origin = useNearbyStore((s) => s.origin);
  const filters = useNearbyStore((s) => s.filters);
  const key = keyOf(origin, filters, limit);
  const started = useRef<string | null>(null);
  const rail = useRail<NearbyCommunity>(async () => {
    started.current = key;
    if (!origin) return [];
    if (origin.kind === 'city') return fetchInCity(origin.city.id, { filters, limit });
    return fetchNearby({ lat: origin.lat, lng: origin.lng, filters, limit });
  }, [key]);
  return started.current === key ? rail : { ...rail, status: 'loading' };
}
