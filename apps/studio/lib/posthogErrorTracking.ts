/**
 * Official PostHog Error Tracking autocapture for Studio.
 * `capture_console_errors` is what sends every `console.error` into the Errors inbox.
 */
export const APP_NAME = 'roxy-studio';

export const POSTHOG_CAPTURE_EXCEPTIONS = {
  capture_unhandled_errors: true,
  capture_unhandled_rejections: true,
  capture_console_errors: true,
};
