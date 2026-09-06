/**
 * Official PostHog Error Tracking autocapture for the client.
 * `console: ['error']` is what sends every `console.error` into the Errors inbox.
 */
export const APP_NAME = 'roxy-client';

export const ERROR_TRACKING_AUTOCAPTURE = {
  uncaughtExceptions: true,
  unhandledRejections: true,
  console: ['error'] as const,
};
