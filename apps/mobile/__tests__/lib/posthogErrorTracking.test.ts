import { ERROR_TRACKING_AUTOCAPTURE } from '../../lib/posthogErrorTracking';

describe('client PostHog Error Tracking config', () => {
  it('captures uncaught, unhandled rejections, and console.error', () => {
    expect(ERROR_TRACKING_AUTOCAPTURE).toEqual({
      uncaughtExceptions: true,
      unhandledRejections: true,
      console: ['error'],
    });
  });
});
