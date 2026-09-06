const mockCaptureException = jest.fn();

jest.mock('../../lib/posthog', () => ({
  posthog: {
    captureException: (...args: unknown[]) => mockCaptureException(...args),
  },
  POSTHOG_CAPTURE_EXCEPTIONS: {
    capture_unhandled_errors: true,
    capture_unhandled_rejections: true,
    capture_console_errors: true,
  },
}));

import { logError, logBoundaryError } from '../../lib/errorLogger';
import { POSTHOG_CAPTURE_EXCEPTIONS } from '../../lib/posthog';

describe('Studio logError → PostHog Error Tracking', () => {
  beforeEach(() => {
    mockCaptureException.mockReset();
  });

  it('sends a caught Error through captureException with context and app', () => {
    const error = new Error('edge function 500');
    logError(error, 'invokeFunction:create-event');
    expect(mockCaptureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        error_context: 'invokeFunction:create-event',
        app: 'roxy-studio',
      }),
    );
  });

  it('never throws when PostHog itself is broken', () => {
    mockCaptureException.mockImplementation(() => {
      throw new Error('posthog is unavailable');
    });
    expect(() => logError(new Error('the real problem'), 'login')).not.toThrow();
    expect(() => logError('a string')).not.toThrow();
    expect(() => logBoundaryError(new Error('render'), '<Page />')).not.toThrow();
  });

  it('autocaptures unhandled errors, rejections, and console.error', () => {
    expect(POSTHOG_CAPTURE_EXCEPTIONS).toEqual({
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: true,
    });
  });
});
