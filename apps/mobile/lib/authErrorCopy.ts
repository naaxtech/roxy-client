/**
 * What to show when sign-in / sign-up fails.
 *
 * supabase-js surfaces a dropped connection (and a throttled request whose 429
 * reply carries no CORS header, which the browser reports as a network failure)
 * as "Failed to fetch" / "Network request failed". Shown raw, that reads like
 * the app is broken or her password is wrong. Neither is true, so name what
 * happened and what to do. Every other server message (wrong password, email
 * not confirmed, weak password) is already written for people and passes through.
 */
export type AuthErrorLike = { message?: string; status?: number; name?: string } | null | undefined;

const NETWORK = /failed to fetch|network request failed|load failed|networkerror/i;
const THROTTLED = /rate limit|too many requests/i;

export function authErrorCopy(error: AuthErrorLike): { title: string; body: string } {
  const message = error?.message ?? '';
  if (error?.status === 429 || THROTTLED.test(message)) {
    return {
      title: 'Slow down a little',
      body: 'Too many tries from this connection. Wait a few minutes, then try again.',
    };
  }
  if (error?.name === 'AuthRetryableFetchError' || NETWORK.test(message)) {
    return {
      title: "Can't reach Roxy",
      body: 'Check your connection and try again. Nothing was changed.',
    };
  }
  return { title: 'Error', body: message || 'Something went wrong. Please try again.' };
}
