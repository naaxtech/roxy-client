/**
 * The communities browser in nearby mode (`/communities?near=1`): where she
 * is looking from with Change, Filters, her active filters as removable chips,
 * and the same states as the rail with room for 50 rows. Changing a filter is
 * remembered on her phone, never sent anywhere but the RPC.
 */
import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
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
const mockCommunityState = { joinedIds: new Set<string>(), requestedIds: new Set<string>(), joinCommunity: jest.fn() };
jest.mock('../../../store/communityStore', () => ({
  useCommunityStore: (sel?: (s: unknown) => unknown) => (sel ? sel(mockCommunityState) : mockCommunityState),
}));

import { NearbyBrowser } from '../../../components/nearby/NearbyBrowser';
import { useNearbyStore } from '../../../store/nearbyStore';
import { DEFAULT_NEARBY_FILTERS } from '../../../lib/nearbyFilters';
import { loadNearbyPrefs } from '../../../lib/nearbyPrefs';

const nearby = jest.requireMock('../../../lib/nearby') as Record<string, jest.Mock>;

const ROW = {
  id: 'c1', name: 'Makati Book Club', slug: 'mbc', description: null, cover_image_url: null, category: 'interest',
  is_private: false, member_count: 12, created_by: 'u9', created_at: '2026-10-01T00:00:00Z',
  city_id: 1, city_name: 'Makati City', meets: 'in_person', distance_band: 'under_10',
};
const CITY = { id: 1701668, label: 'Makati City, Metro Manila, Philippines' };
const BUSY = { radiusKm: 25 as const, categories: ['identity' as const], meets: 'all' as const, openOnly: false };

/** Render, then let the rail's first answer land inside act (no stray updates after a test). */
async function mount(ui: React.ReactElement) {
  const v = render(ui);
  await act(async () => { await Promise.resolve(); });
  return v;
}

function setStore(partial: Partial<ReturnType<typeof useNearbyStore.getState>>) {
  useNearbyStore.setState({ ...useNearbyStore.getInitialState(), loadedFor: 'u1', ...partial }, true);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  Object.values(nearby).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
  nearby.hasLocationPermission.mockResolvedValue(false);
  nearby.fetchNearby.mockResolvedValue([ROW]);
  nearby.fetchInCity.mockResolvedValue([ROW]);
  setStore({});
});

describe('NearbyBrowser', () => {
  it('no origin yet: the same prompt as the rail', async () => {
    const v = await mount(<NearbyBrowser />);
    expect(v.getByTestId('nearby-browser')).toBeTruthy();
    expect(v.getByTestId('nearby-prompt')).toBeTruthy();
    expect(nearby.fetchNearby).not.toHaveBeenCalled();
  });

  it('says where it is looking from, asks for up to 50, and lists rows', async () => {
    setStore({ origin: { kind: 'city', city: CITY } });
    const v = await mount(<NearbyBrowser />);
    expect(v.getByText(`Near ${CITY.label}`)).toBeTruthy();
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
    expect(nearby.fetchInCity).toHaveBeenCalledWith(CITY.id, expect.objectContaining({ limit: 50 }));
  });

  it('her own location reads as "Near your location", never as coordinates', async () => {
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyBrowser />);
    expect(v.getByText('Near your location')).toBeTruthy();
    expect(v.queryByText(/14\.6|121/)).toBeNull();
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
  });

  it('active filters show as chips; removing one refetches and is remembered on the phone', async () => {
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 }, filters: BUSY });
    const v = await mount(<NearbyBrowser />);
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
    expect(v.getByTestId('nearby-active-radius')).toHaveTextContent('Within 25 km');
    expect(v.getByLabelText('Remove filter: Identity')).toBeTruthy();

    await act(async () => { fireEvent.press(v.getByTestId('nearby-active-category:identity')); });
    expect(useNearbyStore.getState().filters.categories).toEqual([]);
    await waitFor(() => expect(nearby.fetchNearby).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ categories: [] }) }),
    ));
    await waitFor(async () => expect((await loadNearbyPrefs('u1')).filters.categories).toEqual([]));
  });

  it('Filters opens the sheet; applying it changes what is asked for', async () => {
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyBrowser />);
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
    fireEvent.press(v.getByTestId('nearby-filters-button'));
    expect(v.getByTestId('nearby-filters')).toBeTruthy();
    fireEvent.press(v.getByTestId('nearby-filter-radius-100'));
    await act(async () => { fireEvent.press(v.getByTestId('nearby-filters-apply')); });
    expect(useNearbyStore.getState().filters.radiusKm).toBe(100);
    await waitFor(() => expect(nearby.fetchNearby).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ radiusKm: 100 }) }),
    ));
  });

  it('Change opens the city picker', async () => {
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyBrowser />);
    fireEvent.press(v.getByTestId('nearby-change-origin'));
    expect(v.getByTestId('city-picker')).toBeTruthy();
  });

  it('empty with filters on: Clear filters puts the defaults back', async () => {
    nearby.fetchNearby.mockResolvedValue([]);
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 }, filters: BUSY });
    const v = await mount(<NearbyBrowser />);
    await waitFor(() => expect(v.getByTestId('nearby-browser-empty')).toBeTruthy());
    await act(async () => { fireEvent.press(v.getByText('Clear filters')); });
    expect(useNearbyStore.getState().filters).toEqual(DEFAULT_NEARBY_FILTERS);
  });

  it('empty with no filters: Look farther widens to the whole country', async () => {
    nearby.fetchNearby.mockResolvedValue([]);
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyBrowser />);
    await waitFor(() => expect(v.getByTestId('nearby-browser-empty')).toBeTruthy());
    await act(async () => { fireEvent.press(v.getByText('Look farther')); });
    expect(useNearbyStore.getState().filters.radiusKm).toBe(1000);
  });

  it('error: one sentence and Try again', async () => {
    nearby.fetchNearby.mockResolvedValueOnce(null);
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyBrowser />);
    await waitFor(() => expect(v.getByTestId('nearby-browser-error')).toBeTruthy());
    await act(async () => { fireEvent.press(v.getByText('Try again')); });
    await waitFor(() => expect(v.getByTestId('nearby-row-c1')).toBeTruthy());
  });

  it('loading: skeleton rows', async () => {
    nearby.fetchNearby.mockReturnValue(new Promise(() => undefined));
    setStore({ origin: { kind: 'location', lat: 14.6, lng: 121 } });
    const v = await mount(<NearbyBrowser />);
    expect(v.getByTestId('nearby-browser-loading')).toBeTruthy();
  });
});
