/**
 * Official PostHog Error Tracking autocapture for the client.
 * `console: ['error']` is what sends every `console.error` into the Errors inbox.
 */
export const APP_NAME = 'roxy-client';

export const ERROR_TRACKING_AUTOCAPTURE = {
  uncaughtExceptions: true,
  unhandledRejections: true,
  // `['error'] as const` types this readonly, which the SDK's
  // AutocaptureOptions rejects; a plain `['error']` widens to string[], which
  // is too loose for its literal union. A mutable array of the literal is the
  // one spelling that satisfies both.
  console: ['error' as const],
};
