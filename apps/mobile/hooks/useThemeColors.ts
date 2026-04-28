import { useThemeStore } from '../store/themeStore';
import { THEMES, type ThemeColors } from '../lib/theme';

export function useThemeColors(): ThemeColors {
  const { theme } = useThemeStore();
  return THEMES[theme];
}
