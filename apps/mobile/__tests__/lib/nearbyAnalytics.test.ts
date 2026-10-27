import { Analytics } from '../../lib/analytics';

/**
 * Nearby's four events. Each answers a funnel question (does the rail get seen,
 * does she say yes to location, does she pick a city, which filters does she
 * reach for) and none carries anything that locates her: no coordinates, no
 * city, no community id (CLAUDE.md §10: location city/country is never logged).
 */

const mockPh = jest.fn();
const mockLogEvent = jest.fn().mockResolvedValue(undefined);

jest.mock('../../lib/posthog', () => ({
  posthog: { capture: (...a: unknown[]) => mockPh(...a) },
}));

jest.mock('@react-native-firebase/analytics', () => () => ({
  logEvent: (...a: unknown[]) => mockLogEvent(...a),
  logScreenView: jest.fn().mockResolvedValue(undefined),
  setUserId: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockPh.mockClear();
  mockLogEvent.mockClear();
});

describe('nearby analytics', () => {
  it('names the four events and sends only safe properties', () => {
    Analytics.nearbyRailViewed('prompt');
    Analytics.nearbyLocationRequested('denied');
    Analytics.nearbyCityChosen();
    Analytics.nearbyFiltersChanged(25, 2);

    expect(mockPh.mock.calls).toEqual([
      ['nearby_rail_viewed', { mode: 'prompt' }],
      ['nearby_location_requested', { result: 'denied' }],
      ['nearby_city_chosen', undefined],
      ['nearby_filters_changed', { radius: 25, categories_count: 2 }],
    ]);
    expect(mockLogEvent.mock.calls.map((c) => c[0])).toEqual([
      'nearby_rail_viewed', 'nearby_location_requested', 'nearby_city_chosen', 'nearby_filters_changed',
    ]);
  });

  it('no property could locate her', () => {
    Analytics.nearbyRailViewed('city');
    Analytics.nearbyLocationRequested('granted');
    Analytics.nearbyCityChosen();
    Analytics.nearbyFiltersChanged(1000, 0);
    const sent = JSON.stringify([...mockPh.mock.calls, ...mockLogEvent.mock.calls]);
    expect(sent).not.toMatch(/lat|lng|city_id|city_name|coords|label/);
  });

  it('a broken analytics vendor never throws into her tap', () => {
    mockPh.mockImplementationOnce(() => { throw new Error('vendor down'); });
    expect(() => Analytics.nearbyCityChosen()).not.toThrow();
  });
});
