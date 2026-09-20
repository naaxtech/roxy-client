import { POSTHOG_CAPTURE_EXCEPTIONS } from '@/lib/posthogErrorTracking';

describe('Studio PostHog Error Tracking config', () => {
  it('autocaptures unhandled errors, rejections, and console.error', () => {
    expect(POSTHOG_CAPTURE_EXCEPTIONS).toEqual({
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: true,
    });
  });
});
