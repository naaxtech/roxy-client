/**
 * Discover's "Near you" rail: every state she can meet.
 *
 *  - not asked yet → a prompt card: "See communities near you", Use my
 *    location, Choose a city (permission is asked only from that tap);
 *  - she said no → Choose a city only, never asked again by the rail;
 *  - loading → the shared skeleton rows;
 *  - results → community rows with a distance band and Join / Ask to join;
 *  - empty → copy that says what to do; error → one sentence and Try again;
 *  - "See all" → the communities browser in nearby mode.
 */
import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));

jest.mock('../../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/nearby', () => {
  const actual = jest.requireActual('../../../lib/nearby');
  return {
    ...actual,
    fetchNearby: jest.fn(),
    fetchInCity: jest.fn(),
    searchCities: jest.fn(),
    getApproxPosition: jest.fn(),
    hasLocationPermission: jest.fn(() => Promise.resolve(false)),
  };
});
jest.mock('../../../lib/analytics', () => ({
  Analytics: {
    nearbyRailViewed: jest.fn(),
    nearbyLocationRequested: jest.fn(),
    nearbyCityChosen: jest.fn(),
    nearbyFiltersChanged: jest.fn(),
  },
}));

jest.mock('../../../store/authStore', () => {
  const state = { user: { id: 'u1' } };
  const useAuthStore = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

const mockJoin = jest.fn();
const mockCommunityState = {
  joinedIds: new Set<string>(),
  requestedIds: new Set<string>(),
  joinCommunity: (...a: unknown[]) => mockJoin(...a),
};
jest.mock('../../../store/communityStore', () => ({
  useCommunityStore: (sel?: (s: unknown) => unknown) => (sel ? sel(mockCommunityState) : mockCommunityState),
}));

import { NearbyRail } from '../../../components/nearby/NearbyRail';
import { useNearbyStore } from '../../../store/nearbyStore';
import { DEFAULT_NEARBY_FILTERS } from '../../../lib/nearbyFilters';

const nearby = jest.requireMock('../../../lib/nearby') as Record<string, jest.Mock>;
const { Analytics } = jest.requireMock('../../../lib/analytics') as { Analytics: Record<string, jest.Mock> };

const ROWS = [
  {
    id: 'c1', name: 'Makati Book Club', slug: 'mbc', description: null, cover_image_url: null, category: 'interest',
    is_private: false, member_count: 12, created_by: 'u9', created_at: '2026-10-01T00:00:00Z',
    city_id: 1, city_name: 'Makati City', meets: 'in_person', distance_band: 'under_10',
  },
  {
    id: 'c2', name: 'Quiet Sapphic Circle', slug: 'qsc', description: null, cover_image_url: null, category: 'support',
    is_private: true, member_count: 40, created_by: 'u8', created_at: '2026-10-01T00:00:00Z',
    city_id: 2, city_name: 'Pasig', meets: 'both', distance_band: 'under_25',
  },
];

const CITY = { id: 1701668, label: 'Makati City, Metro Manila, Philippines' };
const realOS = Platform.OS;

/** Render, then let the rail's first answer land inside act (no stray updates after a test). */
async function mount(ui: React.ReactElement) {
  const v = render(ui);
  await act(async () => { await Promise.resolve(); });
  return v;
}

function setStore(partial: Partial<ReturnType<typeof useNearbyStore.getState>>) {
  useNearbyStore.setState({ ...useNearbyStore.getInitialState(), loadedFor: 'u1', ...partial }, true);
}

beforeEach(() => {
  mockPush.mockReset();
  mockJoin.mockReset().mockResolvedValue('joined');
  mockCommunityState.joinedIds = new Set();
  mockCommunityState.requestedIds = new Set();
  Object.values(nearby).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
  nearby.hasLocationPermission.mockResolvedValue(false);
  nearby.fetchNearby.mockResolvedValue(ROWS);
  nearby.fetchInCity.mockResolvedValue(ROWS);
  Object.values(Analytics).forEach((m) => m.mockReset());
  Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
  setStore({});
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
});

describe('NearbyRail — not asked yet', () => {
  it('shows the prompt card with both ways in, and asks the network nothing', async () => {
    const v = await mount(<NearbyRail />);
    expect(v.getByTestId('nearby-rail')).toBeTruthy();
    expect(v.getByTestId('nearby-prompt')).toBeTruthy();
    expect(v.getByText('See communities near you')).toBeTruthy();
    expect(v.getByTestId('nearby-use-location')).toBeTruthy();
    expect(v.getByTestId('nearby-choose-city')).toBeTruthy();
    expect(nearby.getApproxPosition).not.toHaveBeenCalled();
    expect(nearby.fetchNearby).not.toHaveBeenCalled();
  });

  it('is counted as viewed once, by mode only', async () => {
    const v = await mount(<NearbyRail />);
    v.rerender(<NearbyRail />);
    expect(Analytics.nearbyRailViewed).toHaveBeenCalledTimes(1);
    expect(Analytics.nearbyRailViewed).toHaveBeenCalledWith('prompt');
  });

  it('"Use my location" asks, then lists what is near her rounded position', async () => {
    nearby.getApproxPosition.mockResolvedValue({ ok: true, lat: 14.6, lng: 121 });
    const v = await mount(<NearbyRail />);
    fireEvent.press(v.getByTestId('nearby-use-location'));
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
    expect(nearby.getApproxPosition).toHaveBeenCalledTimes(1);
    expect(nearby.fetchNearby).toHaveBeenCalledWith(expect.objectContaining({ lat: 14.6, lng: 121, limit: 3 }));
  });

  it('"Choose a city" opens the city picker', async () => {
    const v = await mount(<NearbyRail />);
    fireEvent.press(v.getByTestId('nearby-choose-city'));
    expect(v.getByTestId('city-picker')).toBeTruthy();
  });
});

describe('NearbyRail — she said no to location', () => {
  it('offers a city only and never asks again', async () => {
    setStore({ denied: true });
    const v = await mount(<NearbyRail />);
    expect(v.getByTestId('nearby-prompt')).toBeTruthy();
    expect(v.queryByTestId('nearby-use-location')).toBeNull();
    expect(v.getByTestId('nearby-choose-city')).toBeTruthy();
    expect(v.getByText(/Location is off for Roxy/)).toBeTruthy();
    expect(nearby.getApproxPosition).not.toHaveBeenCalled();
  });

  it('the city picker never offers "Use my location" after a refusal; on a phone it offers Settings instead', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    setStore({ denied: true });
    const v = await mount(<NearbyRail />);
    fireEvent.press(v.getByTestId('nearby-choose-city'));
    expect(v.getByTestId('city-picker')).toBeTruthy();
    expect(v.queryByTestId('city-use-location')).toBeNull();
    await act(async () => { fireEvent.press(v.getByTestId('city-open-settings')); });
    expect(openSettings).toHaveBeenCalledTimes(1);
    // Opening Settings is her own trip there: no permission request, no fix.
    expect(nearby.getApproxPosition).not.toHaveBeenCalled();
  });

  it('on the web, after a refusal, the picker offers no location at all (no Settings page to open)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    setStore({ denied: true });
    const v = await mount(<NearbyRail />);
    fireEvent.press(v.getByTestId('nearby-choose-city'));
    expect(v.queryByTestId('city-use-location')).toBeNull();
    expect(v.queryByTestId('city-open-settings')).toBeNull();
  });

  it('back from Settings with location on: "Use my location" returns (read, never asked, nothing located)', async () => {
    let onChange: ((s: AppStateStatus) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      onChange = handler as (s: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    setStore({ denied: true });
    const v = await mount(<NearbyRail />);
    expect(v.queryByTestId('nearby-use-location')).toBeNull();

    nearby.hasLocationPermission.mockResolvedValue(true);
    expect(onChange).not.toBeNull();
    await act(async () => { onChange!('active'); });
    await waitFor(() => expect(v.getByTestId('nearby-use-location')).toBeTruthy());
    expect(useNearbyStore.getState().denied).toBe(false);
    // She has not tapped anything: no position is read until she does.
    expect(nearby.getApproxPosition).not.toHaveBeenCalled();
  });

  it('a timeout explains itself and keeps both ways in', async () => {
    setStore({ locationProblem: 'timeout' });
    const v = await mount(<NearbyRail />);
    expect(v.getByText(/took too long/)).toBeTruthy();
    expect(v.getByTestId('nearby-use-location')).toBeTruthy();
  });
});

describe('NearbyRail — with somewhere to look from', () => {
  it('loading: the shared skeleton rows, not a spinner', async () => {
    nearby.fetchNearby.mockReturnValue(new Promise(() => undefined));
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyRail />);
    expect(v.getByTestId('nearby-rail-loading')).toBeTruthy();
  });

  it('results: rows with the distance band, city and members; Join and Ask to join', async () => {
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyRail />);
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
    expect(v.getByText('Within 10 km · Makati City · 12 members')).toBeTruthy();
    expect(v.getByText('Within 25 km · Pasig · 40 members')).toBeTruthy();
    expect(v.getByTestId('nearby-join-c2')).toHaveTextContent('Ask to join');

    await act(async () => { fireEvent.press(v.getByTestId('nearby-join-c1')); });
    expect(mockJoin).toHaveBeenCalledWith('c1', 'u1');
  });

  it('a failed join says so in one sentence', async () => {
    mockJoin.mockRejectedValue(new Error('offline'));
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyRail />);
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
    await act(async () => { fireEvent.press(v.getByTestId('nearby-join-c1')); });
    expect(v.getByTestId('nearby-join-error')).toBeTruthy();
  });

  it('a chosen city asks the in-city RPC', async () => {
    setStore({ origin: { kind: 'city', city: CITY }, filters: { ...DEFAULT_NEARBY_FILTERS, radiusKm: 25 } });
    const v = await mount(<NearbyRail />);
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
    expect(nearby.fetchInCity).toHaveBeenCalledWith(CITY.id, expect.objectContaining({ limit: 3, filters: expect.objectContaining({ radiusKm: 25 }) }));
    expect(nearby.fetchNearby).not.toHaveBeenCalled();
  });

  it('empty: says what she can do, and both moves are right there (no "start one": members cannot)', async () => {
    nearby.fetchNearby.mockResolvedValue([]);
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyRail />);
    await waitFor(() => expect(v.getByTestId('nearby-rail-empty')).toBeTruthy());
    expect(v.getByText('No communities near you yet. Try a wider distance or another city.')).toBeTruthy();
    expect(v.queryByText(/start one|be the first/i)).toBeNull();

    await act(async () => { fireEvent.press(v.getByTestId('nearby-empty-widen')); });
    expect(useNearbyStore.getState().filters.radiusKm).toBe(100);
    await waitFor(() => expect(nearby.fetchNearby).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ radiusKm: 100 }) }),
    ));

    await waitFor(() => expect(v.getByTestId('nearby-empty-city')).toBeTruthy());
    fireEvent.press(v.getByTestId('nearby-empty-city'));
    expect(v.getByTestId('city-picker')).toBeTruthy();
  });

  it('error: one sentence and Try again, which asks again', async () => {
    nearby.fetchNearby.mockResolvedValueOnce(null);
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyRail />);
    await waitFor(() => expect(v.getByTestId('nearby-rail-error')).toBeTruthy());
    expect(v.getByText('Communities near you didn’t load. Check your connection and try again.')).toBeTruthy();
    await act(async () => { fireEvent.press(v.getByText('Try again')); });
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
    expect(nearby.fetchNearby).toHaveBeenCalledTimes(2);
  });

  it('"See all" opens the communities browser in nearby mode', async () => {
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyRail />);
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
    fireEvent.press(v.getByTestId('nearby-rail-link'));
    expect(mockPush).toHaveBeenCalledWith('/communities?near=1');
  });
});
