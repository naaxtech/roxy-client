/**
 * Caught errors must land in PostHog Error Tracking as $exception events.
 * A custom `app_error` event is not enough — that never shows in the
 * Errors inbox startups actually watch.
 */

const mockCaptureException = jest.fn();
const mockCapture = jest.fn();

jest.mock('../../lib/posthog', () => ({
  posthog: {
    capture: (...args: unknown[]) => mockCapture(...args),
    captureException: (...args: unknown[]) => mockCaptureException(...args),
  },
  ERROR_TRACKING_AUTOCAPTURE: {
    uncaughtExceptions: true,
    unhandledRejections: true,
    console: ['error'],
  },
}));

import { logError, logBoundaryError } from '../../lib/errorLogger';
import { ERROR_TRACKING_AUTOCAPTURE } from '../../lib/posthogErrorTracking';

describe('logError → PostHog Error Tracking', () => {
  beforeEach(() => {
    mockCaptureException.mockReset();
    mockCapture.mockReset();
  });

  it('sends a caught Error through captureException with context and app', () => {
    const error = new Error('posts insert failed');
    logError(error, 'createPost_insert');
    expect(mockCaptureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        error_context: 'createPost_insert',
        app: 'roxy-client',
      }),
    );
  });

  it('wraps a non-Error value so PostHog still gets an Error', () => {
    logError('string boom', 'someScreen.load');
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const sent = mockCaptureException.mock.calls[0][0];
    expect(sent).toBeInstanceOf(Error);
    expect(sent.message).toBe('string boom');
  });

  it('sends ErrorBoundary catches as exceptions with the component stack', () => {
    const error = new Error('render blew up');
    logBoundaryError(error, '    in Feed\n    in App');
    expect(mockCaptureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        error_context: 'ErrorBoundary',
        app: 'roxy-client',
        component_stack: expect.stringContaining('in Feed'),
      }),
    );
  });
});

describe('PostHog error autocapture', () => {
  it('captures uncaught, unhandled rejections, and console.error', () => {
    expect(ERROR_TRACKING_AUTOCAPTURE).toEqual({
      uncaughtExceptions: true,
      unhandledRejections: true,
      console: ['error'],
    });
  });
});
