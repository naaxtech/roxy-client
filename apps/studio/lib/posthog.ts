import { APP_NAME, POSTHOG_CAPTURE_EXCEPTIONS } from './posthogErrorTracking';

export { APP_NAME, POSTHOG_CAPTURE_EXCEPTIONS };

type CaptureException = (
  error: unknown,
  properties?: Record<string, unknown>,
) => void;

/**
 * Isomorphic facade so `logError` works from a client component, a Server
 * Component, and `instrumentation.ts`. The real SDKs load lazily so importing
 * this file never pulls `posthog-js` onto the server.
 */
export const posthog: { captureException: CaptureException } = {
  captureException(error, properties) {
    if (typeof window !== 'undefined') {
      void import('./posthog-browser')
        .then(({ getBrowserPostHog }) => {
          getBrowserPostHog()?.captureException(error, properties);
        })
        .catch(() => {});
      return;
    }
    void import('./posthog-server')
      .then(({ captureServerException }) => {
        captureServerException(error, properties);
      })
      .catch(() => {});
  },
};
