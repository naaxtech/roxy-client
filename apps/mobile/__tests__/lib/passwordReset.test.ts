import { Platform } from 'react-native';
import {
  RESET_PASSWORD_PATH,
  resetRedirectUrl,
  parseRecoveryParams,
  isRecoverySessionGone,
} from '../../lib/passwordReset';

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `roxy://${path}`,
}));

/**
 * The bug this file exists for: `resetPasswordForEmail` was called with no
 * `redirectTo`, so GoTrue fell back to the project Site URL — Supabase's
 * default, `http://localhost:3000`. Every reset email pointed at a machine
 * that was not hers.
 */
describe('resetRedirectUrl', () => {
  const origin = 'https://roxy.expo.app';

  afterEach(() => {
    Platform.OS = 'ios';
    // @ts-expect-error — test harness manipulates the jsdom global directly
    delete global.window;
  });

  it('uses the live origin on web, so dev and prod each point at themselves', () => {
    Platform.OS = 'web';
    // @ts-expect-error — minimal window stand-in
    global.window = { location: { origin } };
    expect(resetRedirectUrl()).toBe('https://roxy.expo.app/reset-password');
  });

  it('follows the origin it is actually served from, not a baked-in constant', () => {
    // A hardcoded prod URL would send a developer's reset email to production.
    Platform.OS = 'web';
    // @ts-expect-error — minimal window stand-in
    global.window = { location: { origin: 'http://localhost:8083' } };
    expect(resetRedirectUrl()).toBe('http://localhost:8083/reset-password');
  });

  it('uses the app scheme on native', () => {
    Platform.OS = 'ios';
    expect(resetRedirectUrl()).toBe('roxy:///reset-password');
  });

  it('never returns localhost on native', () => {
    Platform.OS = 'android';
    expect(resetRedirectUrl()).not.toContain('localhost');
  });

  it('targets the route the router actually serves', () => {
    expect(RESET_PASSWORD_PATH).toBe('/reset-password');
  });
});

/**
 * supabase-js 2.105.4 defaults to flowType 'implicit', so a recovery link
 * returns its tokens in the URL FRAGMENT. Failures come back on the QUERY
 * string instead. Reading only one of the two is how an expired link renders
 * as a blank screen.
 */
describe('parseRecoveryParams', () => {
  it('reads the tokens out of the fragment', () => {
    const out = parseRecoveryParams(
      'https://roxy.expo.app/reset-password#access_token=abc&refresh_token=def&type=recovery',
    );
    expect(out).toEqual({
      accessToken: 'abc',
      refreshToken: 'def',
      type: 'recovery',
      errorDescription: null,
    });
  });

  it('reads an expired link from the query string', () => {
    const out = parseRecoveryParams(
      'https://roxy.expo.app/reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(out.accessToken).toBeNull();
    expect(out.errorDescription).toBe('Email link is invalid or has expired');
  });

  it('reads an error delivered on the fragment too', () => {
    // GoTrue is not consistent about which half of the URL carries the error.
    const out = parseRecoveryParams(
      'roxy:///reset-password#error=access_denied&error_description=Token+has+expired',
    );
    expect(out.errorDescription).toBe('Token has expired');
  });

  it('handles the native scheme, whose triple slash breaks a naive URL parse', () => {
    const out = parseRecoveryParams(
      'roxy:///reset-password#access_token=abc&refresh_token=def&type=recovery',
    );
    expect(out.accessToken).toBe('abc');
    expect(out.refreshToken).toBe('def');
  });

  it('returns nulls for a bare visit, so the screen can ask for the email again', () => {
    const out = parseRecoveryParams('https://roxy.expo.app/reset-password');
    expect(out.accessToken).toBeNull();
    expect(out.refreshToken).toBeNull();
    expect(out.errorDescription).toBeNull();
  });

  it('does not treat a signup confirmation as a password recovery', () => {
    // type is what separates them; acting on any token here would let a
    // confirmation link silently open a change-password form.
    const out = parseRecoveryParams(
      'https://roxy.expo.app/reset-password#access_token=abc&refresh_token=def&type=signup',
    );
    expect(out.type).toBe('signup');
  });

  it('survives a malformed URL instead of throwing into a blank screen', () => {
    expect(() => parseRecoveryParams('not a url at all')).not.toThrow();
    expect(parseRecoveryParams('not a url at all').accessToken).toBeNull();
  });

  it('survives an empty string', () => {
    expect(parseRecoveryParams('').accessToken).toBeNull();
  });

  it('requires BOTH tokens — a half-set session cannot refresh', () => {
    // setSession() with an access token and no refresh token produces a session
    // that dies at the first refresh, mid password change.
    const out = parseRecoveryParams(
      'https://roxy.expo.app/reset-password#access_token=abc&type=recovery',
    );
    expect(out.accessToken).toBe('abc');
    expect(out.refreshToken).toBeNull();
  });
});

/**
 * A failed `updateUser` has two completely different meanings and they need
 * two different screens. GoTrue answers both with a plain string.
 */
describe('isRecoverySessionGone', () => {
  it('recognises the typed error supabase-js throws for a missing session', () => {
    expect(isRecoverySessionGone({ name: 'AuthSessionMissingError', message: 'Auth session missing!' }))
      .toBe(true);
  });

  it('recognises an expired JWT and a revoked refresh token', () => {
    // A second reset request revokes the first link's tokens while she is
    // still on the form from the first one.
    expect(isRecoverySessionGone({ message: 'JWT expired' })).toBe(true);
    expect(isRecoverySessionGone({ message: 'Invalid Refresh Token: Already Used' })).toBe(true);
  });

  it('leaves a rejected password on the form where she can type another', () => {
    expect(
      isRecoverySessionGone({ message: 'New password should be different from the old password.' }),
    ).toBe(false);
    expect(isRecoverySessionGone({ message: 'Password should be at least 6 characters' })).toBe(false);
  });

  it('does not throw on an error carrying no message at all', () => {
    expect(() => isRecoverySessionGone({})).not.toThrow();
    expect(isRecoverySessionGone({})).toBe(false);
  });
});
