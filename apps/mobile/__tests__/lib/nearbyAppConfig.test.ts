/**
 * Nearby's native permission contract, as configured in app.json (spec ›
 * Safety 2: coarse location only, when in use only).
 *
 *  - iOS: `NSLocationDefaultAccuracyReduced` = true, so the system prompt
 *    offers approximate location with Precise toggled off. Without it iOS 14+
 *    asks for full accuracy by default, and a member who taps "Allow" hands
 *    over a precise fix that this app then has to throw away.
 *    src: https://developer.apple.com/documentation/bundleresources/information-property-list/nslocationdefaultaccuracyreduced · iOS 14.0+ · 2026-10-28
 *    src: https://docs.expo.dev/versions/v51.0.0/config/app/#infoplist · Expo SDK 51 · 2026-10-28
 *  - Android: fine and background location are blocked from the manifest, so
 *    only ACCESS_COARSE_LOCATION can ever be granted.
 *  - The expo-location plugin carries the when-in-use sentence and no
 *    background options.
 */
import appJson from '../../app.json';

type ExpoConfig = {
  ios: { infoPlist: Record<string, unknown> };
  android: { permissions?: string[]; blockedPermissions?: string[] };
  plugins: (string | [string, Record<string, unknown>])[];
};

const expo = (appJson as unknown as { expo: ExpoConfig }).expo;

describe('app.json — location is coarse and in use only', () => {
  it('iOS asks for approximate location by default (Precise off)', () => {
    expect(expo.ios.infoPlist.NSLocationDefaultAccuracyReduced).toBe(true);
  });

  it('iOS asks for nothing beyond when-in-use in infoPlist', () => {
    expect(expo.ios.infoPlist).not.toHaveProperty('NSLocationAlwaysUsageDescription');
    expect(expo.ios.infoPlist).not.toHaveProperty('NSLocationAlwaysAndWhenInUseUsageDescription');
    expect(expo.ios.infoPlist).not.toHaveProperty('UIBackgroundModes');
  });

  it('Android blocks fine and background location, and requests neither', () => {
    expect(expo.android.blockedPermissions).toEqual(expect.arrayContaining([
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    ]));
    expect(expo.android.permissions ?? []).not.toContain('android.permission.ACCESS_FINE_LOCATION');
    expect(expo.android.permissions ?? []).not.toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
  });

  it('the expo-location plugin explains when-in-use and enables no background mode', () => {
    const entry = expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location') as
      | [string, Record<string, unknown>]
      | undefined;
    expect(entry).toBeDefined();
    const options = entry![1];
    expect(typeof options.locationWhenInUsePermission).toBe('string');
    expect(options).not.toHaveProperty('isIosBackgroundLocationEnabled');
    expect(options).not.toHaveProperty('isAndroidBackgroundLocationEnabled');
    expect(options).not.toHaveProperty('locationAlwaysPermission');
    expect(options).not.toHaveProperty('locationAlwaysAndWhenInUsePermission');
  });
});
