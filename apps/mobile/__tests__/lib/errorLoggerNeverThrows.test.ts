/**
 * Telemetry must never break the thing it is observing.
 *
 * This file exists because of a real failure: `logError` is called from inside
 * catch blocks and error branches, and its Crashlytics section was unguarded
 * while its PostHog section was already wrapped. When the Crashlytics call
 * threw, it threw *out of the catch block* — so the line that set the visible
 * error state never ran, and a create sheet sat on "Finding your rooms…"
 * forever. The reporter failing turned a handled error into a hang.
 *
 * Every export here is asserted against a Crashlytics binding that throws on
 * every method. None of them may propagate.
 */

const boom = () => { throw new Error('crashlytics is unavailable'); };

jest.mock('@react-native-firebase/crashlytics', () => () => ({
  log: boom,
  setAttribute: boom,
  recordError: boom,
  setUserId: boom,
}));

jest.mock('../../lib/posthog', () => ({
  posthog: { capture: () => { throw new Error('posthog is unavailable'); } },
}));

import {
  logError,
  logBreadcrumb,
  logBoundaryError,
  setCrashlyticsUser,
} from '../../lib/errorLogger';

describe('the logger, when its own backends are broken', () => {
  it('logError swallows the failure instead of rethrowing into the caller', () => {
    expect(() => logError(new Error('the real problem'), 'someScreen.load')).not.toThrow();
  });

  it('logError survives a non-Error being thrown at it', () => {
    expect(() => logError('a string', 'someScreen.load')).not.toThrow();
    expect(() => logError(undefined)).not.toThrow();
  });

  it('logBreadcrumb never interrupts the navigation it is recording', () => {
    expect(() => logBreadcrumb('screen_open', { screen: 'feed' })).not.toThrow();
  });

  it('logBoundaryError never turns a recoverable render error into a crash', () => {
    expect(() => logBoundaryError(new Error('render blew up'), '<Feed />')).not.toThrow();
  });

  it('setCrashlyticsUser never breaks sign-in', () => {
    expect(() => setCrashlyticsUser('11111111-2222-3333-4444-555555555555')).not.toThrow();
    expect(() => setCrashlyticsUser(null)).not.toThrow();
  });
});
