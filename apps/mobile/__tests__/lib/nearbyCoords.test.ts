import {
  roundCoord,
  isRoundedCoord,
  DISTANCE_BANDS,
  distanceBandLabel,
  isDistanceBand,
  NEARBY_RADII_KM,
  isNearbyRadius,
} from '../../lib/nearbyCoords';

/**
 * Her position leaves the phone rounded to 0.1° (about 11 km) and only as an
 * argument to suggest_nearby_communities, which REFUSES anything finer
 * (migration 139). These tests pin the device half of that contract.
 */
describe('roundCoord — 0.1° on the device', () => {
  it('rounds to one decimal place', () => {
    expect(roundCoord(14.6123)).toBe(14.6);
    expect(roundCoord(121.0456)).toBe(121);
    expect(roundCoord(14.66)).toBe(14.7);
  });

  it('rounds negative coordinates by magnitude, like Postgres round()', () => {
    expect(roundCoord(-33.8688)).toBe(-33.9);
    expect(roundCoord(-0.04)).toBe(0);
    expect(Object.is(roundCoord(-0.04), -0)).toBe(false);
  });

  it('leaves an already-rounded value exactly as it is', () => {
    for (const v of [0, 0.1, 14.6, -179.9, 89.9, 180, -90]) {
      expect(roundCoord(v)).toBe(v);
    }
  });

  it('never returns more than one decimal for any reading', () => {
    for (let i = 0; i < 2000; i += 1) {
      const v = -180 + (i * 360.123457) / 2000;
      const r = roundCoord(v);
      expect(String(r)).toMatch(/^-?\d+(\.\d)?$/);
      expect(Math.abs(r - v)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it('throws on a reading that is not a number', () => {
    expect(() => roundCoord(Number.NaN)).toThrow(RangeError);
    expect(() => roundCoord(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('isRoundedCoord — what the server accepts', () => {
  it('accepts one decimal place', () => {
    expect(isRoundedCoord(14.6)).toBe(true);
    expect(isRoundedCoord(-179.9)).toBe(true);
    expect(isRoundedCoord(121)).toBe(true);
  });

  it('refuses anything finer, which the RPC would reject', () => {
    expect(isRoundedCoord(14.61)).toBe(false);
    expect(isRoundedCoord(121.05)).toBe(false);
    expect(isRoundedCoord(14.6000001)).toBe(false);
  });

  it('refuses non-numbers', () => {
    expect(isRoundedCoord(Number.NaN)).toBe(false);
    expect(isRoundedCoord(Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

describe('distance bands — never kilometres', () => {
  it('lists the five bands the server returns, nearest first', () => {
    expect(DISTANCE_BANDS).toEqual(['under_10', 'under_25', 'under_50', 'under_100', 'farther']);
  });

  it('labels each band', () => {
    expect(distanceBandLabel('under_10')).toBe('Within 10 km');
    expect(distanceBandLabel('under_25')).toBe('Within 25 km');
    expect(distanceBandLabel('under_50')).toBe('Within 50 km');
    expect(distanceBandLabel('under_100')).toBe('Within 100 km');
    expect(distanceBandLabel('farther')).toBe('More than 100 km away');
  });

  it('renders nothing for a band it does not know', () => {
    expect(distanceBandLabel('12.3')).toBeNull();
    expect(distanceBandLabel('')).toBeNull();
    expect(isDistanceBand('under_10')).toBe(true);
    expect(isDistanceBand('under_5')).toBe(false);
  });
});

describe('radius — the only values the RPC accepts', () => {
  it('matches the server list', () => {
    expect(NEARBY_RADII_KM).toEqual([10, 25, 50, 100, 1000]);
    expect(isNearbyRadius(25)).toBe(true);
    expect(isNearbyRadius(30)).toBe(false);
    expect(isNearbyRadius(Number.NaN)).toBe(false);
  });
});
