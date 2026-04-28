export type Theme = 'light' | 'dark';

export type ThemeColors = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceLight: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  success: string;
  warning: string;
  error: string;
  roxy: string;
  devPanel: string;
};

export const THEMES: Record<Theme, ThemeColors> = {
  dark: {
    primary: '#C4476A',
    secondary: '#8B5CF6',
    accent: '#F472B6',
    background: '#1a0a2e',
    surface: '#2d1b4e',
    surfaceLight: '#3d2b5e',
    textPrimary: '#FFFFFF',
    textSecondary: '#C4B5D4',
    textMuted: '#8B7AA8',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    roxy: '#E879A6',
    devPanel: '#FF1493',
  },
  light: {
    primary: '#C4476A',
    secondary: '#8B5CF6',
    accent: '#F472B6',
    background: '#FFF5F7',
    surface: '#FFFFFF',
    surfaceLight: '#FFF0F3',
    textPrimary: '#1A0A2E',
    textSecondary: '#6B4C6B',
    textMuted: '#9B7A9B',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    roxy: '#E879A6',
    devPanel: '#FF1493',
  },
};
