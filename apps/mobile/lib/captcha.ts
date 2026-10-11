/**
 * Bot protection on sign-up / sign-in / reset (gate wave 3): Cloudflare
 * Turnstile, switched on by EXPO_PUBLIC_TURNSTILE_SITE_KEY (a public key).
 *
 * Web only for now: components/auth/TurnstileWidget renders the challenge in
 * the browser build (roxy.expo.app). Native has no widget yet (it needs a
 * WebView-hosted challenge), so the native app sends no token.
 *
 * ORDER MATTERS when switching it on: Supabase's captcha setting is project
 * wide. Turning on "Enable Captcha protection" in Auth settings while the
 * native app sends no token would lock every phone out of sign-in. Ship the
 * native widget first (docs/ops/store-review-account.md lists the order).
 */

// Read once: babel-preset-expo inlines EXPO_PUBLIC_* at build time, so this is
// a constant in every build. Tests pass the key in instead.
const BUILD_SITE_KEY: string | undefined = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;

export function captchaSiteKey(raw: string | undefined = BUILD_SITE_KEY): string | null {
  const key = (raw ?? '').trim();
  return key.length > 0 ? key : null;
}

/** Whether this platform must show the challenge before an auth call. */
export function captchaRequired(platformOS: string, raw: string | undefined = BUILD_SITE_KEY): boolean {
  return platformOS === 'web' && captchaSiteKey(raw) !== null;
}
