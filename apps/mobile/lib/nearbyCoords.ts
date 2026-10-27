/**
 * Nearby communities: the device half of the location contract (migration 139).
 *
 * A location leak can out a member, so her position is rounded to 0.1° (about
 * 11 km) here, on the phone, before it goes anywhere. The rounded pair is sent
 * only as arguments to `suggest_nearby_communities`, which refuses anything
 * finer and stores nothing. What comes back is a distance BAND, never
 * kilometres. Pure: no geolocation calls live in this file.
 */

/** Round one coordinate to one decimal place, half away from zero (Postgres round()). */
export function roundCoord(n: number): number {
  if (!Number.isFinite(n)) {
    throw new RangeError('coordinate is not a finite number');
  }
  const r = (Math.sign(n) * Math.round(Math.abs(n) * 10)) / 10;
  // -0 would serialise as "0" anyway; normalise so equality checks stay honest.
  return r === 0 ? 0 : r;
}

/** True when the server will accept it: finite and already at one decimal place. */
export function isRoundedCoord(n: number): boolean {
  return Number.isFinite(n) && roundCoord(n) === n;
}

/** The bands the RPCs return, nearest first. */
export const DISTANCE_BANDS = ['under_10', 'under_25', 'under_50', 'under_100', 'farther'] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

const BAND_LABELS: Record<DistanceBand, string> = {
  under_10: 'Within 10 km',
  under_25: 'Within 25 km',
  under_50: 'Within 50 km',
  under_100: 'Within 100 km',
  farther: 'More than 100 km away',
};

export function isDistanceBand(value: string): value is DistanceBand {
  return (DISTANCE_BANDS as readonly string[]).includes(value);
}

/** "Within 10 km" for a band; null for anything else, so drift renders nothing. */
export function distanceBandLabel(band: string): string | null {
  return isDistanceBand(band) ? BAND_LABELS[band] : null;
}

/** The only radii `suggest_nearby_communities` accepts, nearest first (1000 = the widest). */
export const NEARBY_RADII_KM = [10, 25, 50, 100, 1000] as const;
export type NearbyRadiusKm = (typeof NEARBY_RADII_KM)[number];

export function isNearbyRadius(km: number): km is NearbyRadiusKm {
  return (NEARBY_RADII_KM as readonly number[]).includes(km);
}
