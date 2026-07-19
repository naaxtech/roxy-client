import { Platform, useWindowDimensions } from 'react-native';

/**
 * Max width of the app column on web. Desktop browsers render Roxy as a
 * centered phone-proportioned column (Instagram/Bumble web pattern); the
 * WebAppFrame in app/_layout.tsx clamps the layout to this same value, so
 * any component sizing against "the screen" must use useAppWidth(), never
 * the raw window width — the window can be far wider than the app column.
 */
export const FRAME_MAX_WIDTH = 500;

/** Reactive width of the app's layout column (= window width on native). */
export function useAppWidth(): number {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' ? Math.min(width, FRAME_MAX_WIDTH) : width;
}
