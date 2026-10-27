import { useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { useNearbyStore } from '../../store/nearbyStore';
import { logError } from '../../lib/errorLogger';
import type { ChosenCity } from '../../lib/nearbyPrefs';
import { CityPickerSheet, type CityPickerLocationOffer } from './CityPickerSheet';

/**
 * Shared by Discover's rail and the nearby browser: loads her preferences
 * once, and carries the ways she changes where Nearby looks from (her tap on
 * "Use my location", the city picker, "Use my location instead"). The city
 * picker sheet comes back as an element so each surface mounts its own.
 *
 * After a refusal nothing here asks again (spec › Safety 2). On a phone the
 * picker offers her the app's Settings page instead (`Linking.openSettings`,
 * which asks nothing; react-native-web has no such page, so the web offers
 * nothing). When the app comes back to the foreground the grant is re-read,
 * never requested, so turning location on in Settings brings "Use my
 * location" back without a prompt and without locating her until she taps.
 * src: https://reactnative.dev/docs/0.74/linking#opensettings · react-native 0.74.5 · 2026-10-28
 */
export function useNearbyOrigin() {
  const userId = useAuthStore((s) => s.user?.id);
  const origin = useNearbyStore((s) => s.origin);
  const denied = useNearbyStore((s) => s.denied);
  const locating = useNearbyStore((s) => s.locating);
  const problem = useNearbyStore((s) => s.locationProblem);
  const loadedFor = useNearbyStore((s) => s.loadedFor);
  const [cityOpen, setCityOpen] = useState(false);

  useEffect(() => {
    if (userId) void useNearbyStore.getState().load(userId);
  }, [userId]);

  // Back from Settings (or anywhere): re-read a refusal, never re-ask it.
  useEffect(() => {
    if (!userId || !denied) return undefined;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void useNearbyStore.getState().recheckPermission(userId);
    });
    return () => sub.remove();
  }, [userId, denied]);

  const locateMe = () => { void useNearbyStore.getState().locateMe(userId); };
  const openSettings = () => {
    Linking.openSettings().catch((e: unknown) => logError(e, 'nearby.openSettings'));
  };
  const locationOffer: CityPickerLocationOffer = !denied ? 'ask' : Platform.OS === 'web' ? 'none' : 'settings';

  const cityPicker = (
    <CityPickerSheet
      visible={cityOpen}
      onClose={() => setCityOpen(false)}
      onChoose={(city: ChosenCity) => {
        setCityOpen(false);
        useNearbyStore.getState().chooseCity(userId, city);
      }}
      location={locationOffer}
      onUseLocation={() => {
        setCityOpen(false);
        locateMe();
      }}
      onOpenSettings={openSettings}
    />
  );

  return {
    userId, origin, denied, locating, problem, loadedFor,
    locateMe, openCityPicker: () => setCityOpen(true), cityPicker,
  };
}
