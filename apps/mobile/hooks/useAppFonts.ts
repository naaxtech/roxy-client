import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { Geologica_700Bold, Geologica_800ExtraBold } from '@expo-google-fonts/geologica';
import {
  Commissioner_400Regular,
  Commissioner_500Medium,
  Commissioner_600SemiBold,
} from '@expo-google-fonts/commissioner';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { logError } from '../lib/errorLogger';

/**
 * Loads the v2 faces: Geologica 700/800 (display), Commissioner 400/500/600
 * (text), IBM Plex Mono 500 (codes). The keys are the family names
 * `lib/typography.ts` names — `useFonts` registers each key as a `fontFamily`.
 *
 * v0's Outfit and Figtree are no longer loaded: no caller names them (see
 * `LEGACY_FONT_FAMILIES` in `lib/typography.ts`). Their packages stay
 * installed, so restoring them is a matter of adding the imports back here.
 *
 * `ready` goes true on success *or* failure. A font that will not load is a
 * degraded screen, not a broken one: React Native falls back to the system face
 * for an unknown family, and holding the whole app behind a font is a worse
 * outcome than shipping it in Roboto for one session. The failure is logged so
 * it does not disappear.
 *
 * Per-script Noto families (Arabic, Hebrew, Devanagari, Thai) load on first use
 * once localisation ships; they are not part of this set.
 *
 * src: https://docs.expo.dev/versions/v51.0.0/sdk/font/#usefontsmap · expo-font 12.0.10 · 2026-08-16
 * src: polish/design-direction.md · v2 › Typography · 2026-10-21
 */
export const APP_FONT_MAP = {
  Geologica_700Bold,
  Geologica_800ExtraBold,
  Commissioner_400Regular,
  Commissioner_500Medium,
  Commissioner_600SemiBold,
  IBMPlexMono_500Medium,
};

export function useAppFonts(): { ready: boolean; failed: boolean } {
  const [loaded, error] = useFonts(APP_FONT_MAP);

  useEffect(() => {
    if (error) logError(error, 'app_fonts_load');
  }, [error]);

  return { ready: loaded || !!error, failed: !!error };
}
