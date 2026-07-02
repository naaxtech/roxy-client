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
    primary: '#C4476A',      // design token — deep rose on warm white bg
    secondary: '#8B5CF6',    // violet — from design system
    accent: '#F472B6',       // pink accent
    background: '#FFF5F7',   // warm white-pink — design bg token
    surface: '#FFFFFF',      // white cards on warm bg
    surfaceLight: '#FFF0F3', // warm pink — nested surfaces (card-2)
    textPrimary: '#1A0A2E',  // near-black — design text token
    textSecondary: '#6B4C6B', // muted rose-purple — design text-2
    textMuted: '#8B7AA8',    // soft purple — design text-3 (AA Large ✓)
    success: '#047857',      // darker green — 4.9:1 on white ✓
    warning: '#B45309',      // darker amber — 4.7:1 on white ✓
    error: '#B91C1C',        // darker red — 5.0:1 on white ✓
    roxy: '#C24A85',         // roxy accent — design roxy token
    devPanel: '#FF1493',
  },
};
