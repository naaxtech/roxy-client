import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeStore, THEME_CHOICE_KEY, resolveTheme, phoneSchemeChanged } from '../../store/themeStore';

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

/**
 * "Match phone" (design direction v2 › Settings: Light · Dark · Match phone).
 *
 * `theme` stays the RESOLVED light/dark every screen paints with; `choice` is
 * what she picked. With 'system' the phone's scheme decides, live.
 * `profiles.theme_preference` only allows 'light' | 'dark' (CHECK, migration
 * 050), so Match phone is a per-device choice that never touches the profile.
 */
describe('themeStore — Match phone', () => {
  const Appearance = jest.requireActual('react-native').Appearance as {
    getColorScheme: () => 'light' | 'dark' | null;
  };
  let scheme: 'light' | 'dark' | null = 'light';

  beforeEach(() => {
    useThemeStore.setState({ theme: 'light', choice: 'light' });
    jest.clearAllMocks();
    getItem.mockReset();
    getItem.mockResolvedValue(null);
    scheme = 'light';
    jest.spyOn(Appearance, 'getColorScheme').mockImplementation(() => scheme);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolveTheme: system follows the phone; null (unknown) falls back to light', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', null)).toBe('light');
  });

  it("setTheme('system') paints the phone's scheme and records the choice on this device only", async () => {
    scheme = 'dark';
    await useThemeStore.getState().setTheme('system');
    expect(useThemeStore.getState().choice).toBe('system');
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(THEME_CHOICE_KEY, 'system');
    // 'system' would violate the profile's CHECK: no profile write is attempted.
    const { supabase } = jest.requireMock('../../lib/supabase');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('a light or dark choice still records the choice', async () => {
    await useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().choice).toBe('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('follows the phone live while she has Match phone on', async () => {
    await useThemeStore.getState().setTheme('system');
    expect(useThemeStore.getState().theme).toBe('light');
    phoneSchemeChanged('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
    phoneSchemeChanged('light');
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('ignores the phone once she has picked Light or Dark herself', async () => {
    await useThemeStore.getState().setTheme('light');
    phoneSchemeChanged('dark');
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('init restores Match phone from this device, even over a light profile value', async () => {
    scheme = 'dark';
    stored({ [THEME_CHOICE_KEY]: 'system' });
    await useThemeStore.getState().init('light');
    expect(useThemeStore.getState().choice).toBe('system');
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('init with no choice anywhere is the light default, not Match phone', async () => {
    scheme = 'dark';
    await useThemeStore.getState().init(null);
    expect(useThemeStore.getState().choice).toBe('light');
    expect(useThemeStore.getState().theme).toBe('light');
  });
});
