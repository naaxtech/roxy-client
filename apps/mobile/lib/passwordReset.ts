import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

/**
 * Where a recovery email lands.
 *
 * `resetPasswordForEmail` used to be called with no options at all, and a
 * GoTrue recovery link with no `redirect_to` falls back to the project's Site
 * URL. Supabase ships a new project with that set to `http://localhost:3000`,
 * so every reset email Roxy ever sent pointed at the recipient's own machine —
 * at nothing. The redirect has to be stated by the caller; there is no correct
 * default for it to inherit.
 */
export const RESET_PASSWORD_PATH = '/reset-password';

/**
 * The absolute URL the emailed link should return her to.
 *
 * Web reads the live origin rather than a build-time constant on purpose: the
 * same bundle serves `localhost:8083` in development and `roxy.expo.app` in
 * production, and a hardcoded production URL would quietly send a developer's
 * test reset to the live site. Whatever origin served the app is the origin
 * that should get her back.
 *
 * Native has no origin, so it uses the app's own scheme — the same
 * `Linking.createURL` idiom as `archiveShare` and `FeedCellChrome`. A path with
 * a leading slash yields `roxy:///reset-password`; the empty authority is
 * legal and Supabase's allow list is configured with `roxy://**` to match it
 * either way.
 * src: https://github.com/expo/expo/blob/sdk-51/packages/expo-linking/src/createURL.ts · expo-linking 6.3.1 · 2026-09-20
 */
export function resetRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${RESET_PASSWORD_PATH}`;
  }
  return Linking.createURL(RESET_PASSWORD_PATH);
}

/**
 * The URL the browser was opened on, snapshotted before anything can rewrite it.
 *
 * This runs at module evaluation — which happens while the bundle loads, before
 * expo-router mounts and takes over the history. Reading `window.location.href`
 * from inside a `useEffect` is too late: effects run after the first paint, by
 * which point the router has normalised the address bar and the `#access_token=…`
 * fragment is gone. The screen then sees a bare URL and tells a woman holding a
 * perfectly good link that it has expired.
 *
 * Found in a browser, not in jest: the unit tests pass a URL string straight to
 * `parseRecoveryParams`, so they can never observe who owns the address bar.
 * The same blind spot as `accessibilityState` on react-native-web.
 */
const initialWebUrl: string | null =
  typeof window !== 'undefined' && window.location ? window.location.href : null;

/** The landing URL as it arrived, fragment intact. Null on native. */
export function initialRecoveryUrl(): string | null {
  return initialWebUrl;
}

export interface RecoveryParams {
  accessToken: string | null;
  refreshToken: string | null;
  type: string | null;
  errorDescription: string | null;
}

const EMPTY: RecoveryParams = {
  accessToken: null,
  refreshToken: null,
  type: null,
  errorDescription: null,
};

/**
 * Pull the recovery tokens (or the failure) out of the URL she arrived on.
 *
 * Two things make this fiddlier than a `new URL()` call:
 *
 * 1. **The tokens are in the fragment, the errors are usually in the query.**
 *    supabase-js 2.105.4 defaults to `flowType: 'implicit'`, so a successful
 *    recovery comes back as `#access_token=…&refresh_token=…&type=recovery`
 *    while an expired one comes back as `?error=access_denied&
 *    error_code=otp_expired&error_description=…`. GoTrue is not consistent
 *    about which half carries an error, so both are read. Reading only the
 *    fragment is how an expired link renders as a blank screen — and an expired
 *    link is the single most common real case, because she reads her email an
 *    hour later.
 * 2. **The native URL is `roxy:///reset-password`.** A parser that assumes an
 *    http authority mangles it, so the string is split by hand.
 *
 * `type` is returned rather than asserted here: a signup-confirmation link also
 * carries an access token, and the screen — not the parser — decides that only
 * `recovery` may open a change-password form.
 */
export function parseRecoveryParams(url: string): RecoveryParams {
  if (!url) return { ...EMPTY };

  const hashAt = url.indexOf('#');
  const fragment = hashAt === -1 ? '' : url.slice(hashAt + 1);

  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

  const fragmentParams = decodePairs(fragment);
  const queryParams = decodePairs(query);

  // Fragment first, query as the fallback — see the note above about GoTrue
  // splitting success and failure across the two.
  const read = (key: string): string | null =>
    fragmentParams[key] ?? queryParams[key] ?? null;

  return {
    accessToken: read('access_token'),
    refreshToken: read('refresh_token'),
    type: read('type'),
    errorDescription: read('error_description') ?? read('error') ?? null,
  };
}

/**
 * Split an `a=b&c=d` string by hand.
 *
 * Deliberately not `URLSearchParams`. React Native 0.74's built-in version
 * ignores a string constructor argument entirely and its `get()` throws
 * "not implemented", so this file would only work where something else had
 * already installed `react-native-url-polyfill` — an import-order accident
 * rather than a dependency, and one jest cannot see, because Node's
 * URLSearchParams is complete. Importing the polyfill here to fix that turned
 * out to break the web build's module evaluation instead. Twenty lines of
 * splitting owes nothing to either.
 */
function decodePairs(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  for (const pair of input.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    const key = decodeComponent(rawKey);
    if (!key || key in out) continue;
    out[key] = decodeComponent(rawValue);
  }
  return out;
}

/** `+` is a space in form encoding, and a stray `%` must not throw. */
function decodeComponent(value: string): string {
  const plusless = value.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(plusless);
  } catch {
    return plusless;
  }
}

/**
 * Is this failure "the recovery session is gone" rather than "that password
 * was no good"?
 *
 * They need different screens. A rejected password belongs on the form, where
 * she can type another one. A dead session means the form itself is useless —
 * she has to be sent back for a fresh link, and showing her GoTrue's literal
 * `Auth session missing!` on a password field tells her to fix the one thing
 * that was never wrong.
 */
export function isRecoverySessionGone(error: { name?: string; message?: string }): boolean {
  if (error.name === 'AuthSessionMissingError') return true;
  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('session missing') ||
    message.includes('session not found') ||
    message.includes('session_not_found') ||
    message.includes('jwt expired') ||
    message.includes('invalid refresh token')
  );
}
