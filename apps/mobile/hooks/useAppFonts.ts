import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import {
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';
import { logError } from '../lib/errorLogger';

/**
 * Loads the two 3.0 families. The keys are the family names components name in
 * `lib/typography.ts` — `useFonts` registers each key as a usable `fontFamily`.
 *
 * `ready` goes true on success *or* failure. A font that will not load is a
 * degraded screen, not a broken one: React Native falls back to the system face
 * for an unknown family, and holding the whole app behind a font is a worse
 * outcome than shipping it in Roboto for one session. The failure is logged so
 * it does not disappear.
 *
 * src: https://docs.expo.dev/versions/v51.0.0/sdk/font/#usefontsmap · expo-font 12.0.10 · 2026-08-16
 */
export function useAppFonts(): { ready: boolean; failed: boolean } {
  const [loaded, error] = useFonts({
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  useEffect(() => {
    if (error) logError(error, 'app_fonts_load');
  }, [error]);

  return { ready: loaded || !!error, failed: !!error };
}
