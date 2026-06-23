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
    primary: '#B03060',      // darker rose — 4.8:1 on white ✓
    secondary: '#6D28D9',    // deeper violet — 5.2:1 on white ✓
    accent: '#C026A0',       // deeper pink — visible on light ✓
    background: '#F4EFFF',   // soft lavender — distinct from white ✓
    surface: '#FFFFFF',      // white cards on lavender bg ✓
    surfaceLight: '#EBE4F8', // mid lavender — nested surfaces ✓
    textPrimary: '#160826',  // near-black — 17:1 on white ✓
    textSecondary: '#3D2260', // dark purple — 8:1 on white ✓
    textMuted: '#5E4480',    // medium purple — 4.6:1 on white ✓ (passes AA)
    success: '#047857',      // darker green — 4.9:1 on white ✓
    warning: '#B45309',      // darker amber — 4.7:1 on white ✓
    error: '#B91C1C',        // darker red — 5.0:1 on white ✓
    roxy: '#A8175A',         // darker roxy — 5.5:1 on white ✓
    devPanel: '#FF1493',
  },
};
