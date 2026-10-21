import { create } from 'zustand';
import { Appearance, type ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import type { Theme } from '../lib/theme';

/**
 * v0 key. Still written by `setTheme` so the value round-trips for anything
 * that reads it, but NOT trusted as a choice: v0's `init` copied the profile's
 * column default ('dark') into it on every sign-in, so it cannot tell a member
 * who chose dark from one who never chose.
 */
const STORAGE_KEY = 'roxy_theme';

/**
 * Her explicit choice on this device, written only by `setTheme` (the theme
 * control). The v2 key exists so a choice can be told apart from a default.
 * Holds 'light', 'dark' or 'system' (Match phone).
 */
export const THEME_CHOICE_KEY = 'roxy_theme_choice_v2';

/** Light is the default theme (Nicole, 2026-10-21; polish/decisions.md). */
export const DEFAULT_THEME: Theme = 'light';

/**
 * What she picked in Settings: Light · Dark · Match phone (design direction
 * v2 › Settings). `'system'` follows the phone's own scheme, live.
 */
export type ThemeChoice = Theme | 'system';

function asTheme(value: string | null | undefined): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

function asChoice(value: string | null | undefined): ThemeChoice | null {
  return value === 'system' ? 'system' : asTheme(value);
}

/**
 * The theme a choice paints with. Match phone follows the phone's scheme; a
 * phone that does not say (null) gets the light default.
 */
export function resolveTheme(choice: ThemeChoice, phone: ColorSchemeName): Theme {
  if (choice !== 'system') return choice;
  return phone === 'dark' ? 'dark' : DEFAULT_THEME;
}

function phoneScheme(): ColorSchemeName {
  try {
    return Appearance.getColorScheme();
  } catch {
    return null;
  }
}

interface ThemeState {
  /** The RESOLVED theme every screen paints with. */
  theme: Theme;
  /** What she picked; 'system' = Match phone. */
  choice: ThemeChoice;
  setTheme: (t: ThemeChoice) => Promise<void>;
  init: (profileTheme: string | null) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: DEFAULT_THEME,
  choice: DEFAULT_THEME,

  setTheme: async (t: ThemeChoice) => {
    const theme = resolveTheme(t, phoneScheme());
    set({ theme, choice: t });
    await AsyncStorage.setItem(STORAGE_KEY, theme);
    await AsyncStorage.setItem(THEME_CHOICE_KEY, t);
    // Match phone is per device: `profiles.theme_preference` only allows
    // 'light' | 'dark' (CHECK, migration 050), and the phone's scheme is not a
    // choice another device should copy. Nothing to sync.
    if (t === 'system') return;
    // Sync to profile — best-effort, no throw on failure
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      await supabase
        .from('profiles')
        .update({ theme_preference: t })
        .eq('id', user.id)
        .then(() => {});
    }
  },

  /**
   * Which theme a signed-in member sees. Her choice wins; the default is light.
   *
   * `profiles.theme_preference` is `NOT NULL DEFAULT 'dark'` (migration 050),
   * so a 'dark' profile value is what EVERY member has until she chooses — it
   * is not evidence of a choice. A 'light' profile value can only come from a
   * choice, so it wins (cross-device sync) — except over Match phone chosen on
   * THIS device, a per-device choice the profile cannot hold. Otherwise the
   * explicit choice recorded on this device wins, and with neither she gets
   * light.
   *
   * Cost, stated: a dark choice made on another device arrives as the
   * ambiguous 'dark' and shows light here until she picks dark once on this
   * device. Making the column nullable (or defaulting it to 'light') would let
   * every choice round-trip; that is a migration, out of this slice's scope.
   */
  init: async (profileTheme: string | null) => {
    const choice = asChoice(await AsyncStorage.getItem(THEME_CHOICE_KEY));
    if (choice === 'system') {
      set({ choice: 'system', theme: resolveTheme('system', phoneScheme()) });
      return;
    }
    if (asTheme(profileTheme) === 'light') {
      set({ theme: 'light', choice: 'light' });
      return;
    }
    const picked: Theme = choice ?? DEFAULT_THEME;
    set({ theme: picked, choice: picked });
  },
}));

/**
 * The phone's scheme changed (Appearance listener below). Repaints only while
 * she has Match phone on; a Light or Dark choice ignores the phone.
 */
export function phoneSchemeChanged(scheme: ColorSchemeName): void {
  const { choice, theme } = useThemeStore.getState();
  if (choice !== 'system') return;
  const next = resolveTheme('system', scheme);
  if (next !== theme) useThemeStore.setState({ theme: next });
}

// One listener for the app's lifetime. Guarded: a test renderer or an old web
// build may lack the API, and a theme must never crash the app.
try {
  Appearance.addChangeListener?.(({ colorScheme }) => phoneSchemeChanged(colorScheme));
} catch {
  // No Appearance events here: Match phone resolves at choice and at launch.
}
