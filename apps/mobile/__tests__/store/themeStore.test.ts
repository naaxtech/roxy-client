import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeStore, THEME_CHOICE_KEY } from '../../store/themeStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
    from: jest.fn(() => ({
      update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({}) })),
    })),
  },
}));

const getItem = AsyncStorage.getItem as jest.Mock;

/** Answers getItem per key, so the test says which key held what. */
function stored(values: Record<string, string | null>) {
  getItem.mockImplementation(async (key: string) => values[key] ?? null);
}

describe('themeStore', () => {
  beforeEach(() => {
    // Start each case from the OTHER theme, so "ends light" proves init chose it.
    useThemeStore.setState({ theme: 'dark' });
    jest.clearAllMocks();
    getItem.mockReset();
    getItem.mockResolvedValue(null);
  });

  // Nicole, 2026-10-21 (polish/decisions.md): light mode is the default theme.
  it('starts light on a fresh install, before anything is loaded', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fresh = require('../../store/themeStore') as typeof import('../../store/themeStore');
      expect(fresh.useThemeStore.getState().theme).toBe('light');
    });
  });

  it('setTheme updates state, persists it, and records it as her explicit choice', async () => {
    await useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toBe('light');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('roxy_theme', 'light');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(THEME_CHOICE_KEY, 'light');
  });

  it('init reads a light profile theme (only a choice can produce it) and sets state', async () => {
    await useThemeStore.getState().init('light');
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('init falls back to her stored choice when profileTheme is null', async () => {
    useThemeStore.setState({ theme: 'light' });
    stored({ [THEME_CHOICE_KEY]: 'dark' });
    await useThemeStore.getState().init(null);
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('init is light when neither the profile nor this device holds a choice', async () => {
    await useThemeStore.getState().init(null);
    expect(useThemeStore.getState().theme).toBe('light');
  });

  // profiles.theme_preference is NOT NULL DEFAULT 'dark' (migration 050), so a
  // 'dark' profile value is what every member has unless she chose — it is not
  // evidence of a choice and must not override the light default.
  it("treats the profile's column default 'dark' as no choice: light wins", async () => {
    await useThemeStore.getState().init('dark');
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('a dark choice she made on this device survives the default profile value', async () => {
    useThemeStore.setState({ theme: 'light' });
    stored({ [THEME_CHOICE_KEY]: 'dark' });
    await useThemeStore.getState().init('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it("the v0 'roxy_theme' key alone is not a choice (init used to copy the profile default into it)", async () => {
    stored({ roxy_theme: 'dark' });
    await useThemeStore.getState().init(null);
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('ignores a corrupt stored value', async () => {
    stored({ [THEME_CHOICE_KEY]: 'purple' });
    await useThemeStore.getState().init(null);
    expect(useThemeStore.getState().theme).toBe('light');
  });
});
