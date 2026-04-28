import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import type { Theme } from '../lib/theme';

const STORAGE_KEY = 'roxy_theme';

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => Promise<void>;
  init: (profileTheme: string | null) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',

  setTheme: async (t: Theme) => {
    set({ theme: t });
    await AsyncStorage.setItem(STORAGE_KEY, t);
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

  init: async (profileTheme: string | null) => {
    // Profile value wins over local storage (cross-device sync)
    if (profileTheme === 'light' || profileTheme === 'dark') {
      set({ theme: profileTheme });
      await AsyncStorage.setItem(STORAGE_KEY, profileTheme);
      return;
    }
    // Fall back to locally persisted value
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      set({ theme: stored });
    }
    // Otherwise keep default 'dark'
  },
}));
