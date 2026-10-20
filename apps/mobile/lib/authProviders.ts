/**
 * Which sign-in providers this build may offer (G-03).
 *
 * Apple and Google were always on screen, but neither was wired: no callback
 * route, no session exchange, and a web redirect to the native scheme. On
 * native the tap did nothing; on web it dead-ended. A woman's first tap on
 * Roxy should never be a dead button, so a provider shows only when the build
 * says it is configured end to end:
 *
 *   EXPO_PUBLIC_OAUTH_PROVIDERS=apple,google
 *
 * Unset (the default) means email only. Turn a provider on in the same
 * release that ships its callback route and enables it in Supabase Auth —
 * and per App Store guideline 4.8, never Google on iOS without Apple.
 */

export type OAuthProvider = 'apple' | 'google';

const KNOWN: readonly OAuthProvider[] = ['apple', 'google'];

export function enabledOAuthProviders(
  raw: string | undefined = process.env.EXPO_PUBLIC_OAUTH_PROVIDERS,
): OAuthProvider[] {
  if (!raw) return [];
  const wanted = new Set(
    raw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean),
  );
  const enabled = KNOWN.filter((p) => wanted.has(p));
  // App Store 4.8: an app that offers a third-party login on iOS must also
  // offer Sign in with Apple. Google alone is therefore not a valid config;
  // fail closed to email rather than ship a rejectable build.
  if (enabled.includes('google') && !enabled.includes('apple')) return [];
  return enabled;
}
