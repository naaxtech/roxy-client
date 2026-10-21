import { create } from 'zustand';
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
 */
export const THEME_CHOICE_KEY = 'roxy_theme_choice_v2';

/** Light is the default theme (Nicole, 2026-10-21; polish/decisions.md). */
export const DEFAULT_THEME: Theme = 'light';

function asTheme(value: string | null | undefined): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => Promise<void>;
  init: (profileTheme: string | null) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: DEFAULT_THEME,

  setTheme: async (t: Theme) => {
    set({ theme: t });
    await AsyncStorage.setItem(STORAGE_KEY, t);
    await AsyncStorage.setItem(THEME_CHOICE_KEY, t);
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
   * choice, so it wins (cross-device sync). Otherwise the explicit choice
   * recorded on this device wins, and with neither she gets light.
   *
   * Cost, stated: a dark choice made on another device arrives as the
   * ambiguous 'dark' and shows light here until she picks dark once on this
   * device. Making the column nullable (or defaulting it to 'light') would let
   * every choice round-trip; that is a migration, out of this slice's scope.
   */
  init: async (profileTheme: string | null) => {
    if (asTheme(profileTheme) === 'light') {
      set({ theme: 'light' });
      return;
    }
    const choice = asTheme(await AsyncStorage.getItem(THEME_CHOICE_KEY));
    set({ theme: choice ?? DEFAULT_THEME });
  },
}));
