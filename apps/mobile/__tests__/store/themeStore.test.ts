import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeStore } from '../../store/themeStore';

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

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' });
    jest.clearAllMocks();
  });

  it('starts with dark theme', () => {
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('setTheme updates state and persists to AsyncStorage', async () => {
    await useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toBe('light');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('roxy_theme', 'light');
  });

  it('init reads profile theme and sets state', async () => {
    await useThemeStore.getState().init('light');
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('init falls back to AsyncStorage when profileTheme is null', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('light');
    await useThemeStore.getState().init(null);
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('init keeps dark if both profileTheme and AsyncStorage are null', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
    await useThemeStore.getState().init(null);
    expect(useThemeStore.getState().theme).toBe('dark');
  });
});
