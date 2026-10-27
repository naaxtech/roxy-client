import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useNearbyStore } from '../../store/nearbyStore';
import type { ChosenCity } from '../../lib/nearbyPrefs';
import { CityPickerSheet } from './CityPickerSheet';

/**
 * Shared by Discover's rail and the nearby browser: loads her preferences
 * once, and carries the ways she changes where Nearby looks from (her tap on
 * "Use my location", the city picker, "Use my location instead"). The city
 * picker sheet comes back as an element so each surface mounts its own.
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

  const locateMe = () => { void useNearbyStore.getState().locateMe(userId); };
  const cityPicker = (
    <CityPickerSheet
      visible={cityOpen}
      onClose={() => setCityOpen(false)}
      onChoose={(city: ChosenCity) => {
        setCityOpen(false);
        useNearbyStore.getState().chooseCity(userId, city);
      }}
      onUseLocation={() => {
        setCityOpen(false);
        locateMe();
      }}
    />
  );

  return {
    userId, origin, denied, locating, problem, loadedFor,
    locateMe, openCityPicker: () => setCityOpen(true), cityPicker,
  };
}
