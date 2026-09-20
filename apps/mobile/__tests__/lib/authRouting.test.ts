import {
  isApplicationRoute,
  shouldRedirectToPending,
  shouldRedirectToApplication,
  isResetPasswordRoute,
} from '../../lib/authRouting';

/**
 * The applicant flow hangs on this rule. An applicant's profile is 'pending' by
 * definition, so a redirect that fires on every 'pending' profile also fires on
 * the one screen built for her — and the "Open application" button on the
 * pending screen bounces straight back to the pending screen.
 */
describe('shouldRedirectToPending — the application screen is reachable', () => {
  // Fails before the fix: the layout redirected on 'pending' with no exemption,
  // so the application screen could never be opened.
  it('does NOT redirect a pending applicant who is on the application screen', () => {
    expect(
      shouldRedirectToPending('pending', ['(auth)', 'application'], '/(auth)/application'),
    ).toBe(false);
  });

  it('does NOT redirect a rejected applicant who is on the application screen', () => {
    expect(
      shouldRedirectToPending('rejected', ['(auth)', 'application'], '/(auth)/application'),
    ).toBe(false);
  });

  /**
   * useSegments() drops the child segment mid Stack-push. If the exemption
   * relied on segments alone the redirect would fire during the transition and
   * the screen would be yanked away as it opened.
   */
  it('does NOT redirect when only pathname has resolved yet', () => {
    expect(shouldRedirectToPending('pending', ['(auth)'], '/(auth)/application')).toBe(false);
  });

  it('does NOT redirect when only segments have resolved yet', () => {
    expect(shouldRedirectToPending('pending', ['(auth)', 'application'], '/(auth)')).toBe(false);
  });
});

describe('shouldRedirectToPending — pending stays in the app; rejected still waits', () => {
  it('does not trap a pending applicant on a wait screen', () => {
    expect(shouldRedirectToPending('pending', ['(tabs)', 'feed'], '/(tabs)/feed')).toBe(false);
    expect(shouldRedirectToPending('pending', ['(tabs)', 'grow'], '/(tabs)/grow')).toBe(false);
  });

  it('redirects a rejected applicant away from the tabs so she can appeal', () => {
    expect(shouldRedirectToPending('rejected', ['(tabs)', 'grow'], '/(tabs)/grow')).toBe(true);
  });

  it('lets a pending applicant finish onboarding', () => {
    expect(
      shouldRedirectToPending(
        'pending',
        ['(auth)', 'onboarding', 'step1-identity'],
        '/(auth)/onboarding/step1-identity',
      ),
    ).toBe(false);
  });

  it('leaves an approved member alone', () => {
    expect(shouldRedirectToPending('approved', ['(tabs)', 'grow'], '/(tabs)/grow')).toBe(false);
  });

  it('leaves an unvetted grandfathered account alone', () => {
    expect(shouldRedirectToPending('unvetted', ['(tabs)', 'grow'], '/(tabs)/grow')).toBe(false);
  });

  it('does not redirect when there is no profile row yet', () => {
    expect(shouldRedirectToPending(undefined, ['(tabs)', 'grow'], '/(tabs)/grow')).toBe(false);
    expect(shouldRedirectToPending(null, ['(tabs)', 'grow'], '/(tabs)/grow')).toBe(false);
  });
});

/**
 * The OAuth hole. Apple and Google complete through a redirect, so the code is
 * still unredeemed when the layout first sees the new session — and a brand-new
 * OAuth account has no profile row, so the pending redirect cannot fire either.
 * Before this rule the next branch sent her to onboarding, which creates the
 * profile at its 'unvetted' DEFAULT: full access, no application, no reviewer.
 */
describe('shouldRedirectToApplication — a held code is redeemed, not skipped', () => {
  // Fails before the fix: a new OAuth account went to onboarding instead.
  it('sends a brand-new account holding a code to the application screen', () => {
    expect(
      shouldRedirectToApplication(false, true, ['(auth)', 'welcome'], '/(auth)/welcome'),
    ).toBe(true);
  });

  it('does not bounce her once she is already on the application screen', () => {
    expect(
      shouldRedirectToApplication(false, true, ['(auth)', 'application'], '/(auth)/application'),
    ).toBe(false);
  });

  it('does not fire mid-transition when only pathname has resolved', () => {
    expect(shouldRedirectToApplication(false, true, ['(auth)'], '/(auth)/application')).toBe(false);
  });

  /**
   * The account-takeover guard. An existing member who typed a code and then
   * tapped "I already have an account" still holds a validated code; routing her
   * here would call create_membership_application against a working account and
   * drop it into 'pending'.
   */
  it('leaves an established account alone even while a code is held', () => {
    expect(
      shouldRedirectToApplication(true, true, ['(auth)', 'welcome'], '/(auth)/welcome'),
    ).toBe(false);
  });

  it('does nothing when no code is held', () => {
    expect(
      shouldRedirectToApplication(false, false, ['(auth)', 'welcome'], '/(auth)/welcome'),
    ).toBe(false);
  });
});

describe('isApplicationRoute', () => {
  it('matches on an exact segment', () => {
    expect(isApplicationRoute(['(auth)', 'application'], '/(auth)')).toBe(true);
  });

  it('matches on pathname', () => {
    expect(isApplicationRoute(['(auth)'], '/(auth)/application')).toBe(true);
  });

  it('does not match the pending screen', () => {
    expect(isApplicationRoute(['(auth)', 'pending'], '/(auth)/pending')).toBe(false);
  });

  it('does not match an empty segment list on first render', () => {
    expect(isApplicationRoute([], '/')).toBe(false);
  });
});

/**
 * The trap that makes a "fixed" password reset still fail.
 *
 * Consuming the recovery token creates a real session. The moment it lands, the
 * root layout's cascade (`user && inAuth && !inOnboarding`) fetches her profile
 * and replaces the route with the feed, onboarding, or the pending screen —
 * yanking the reset form away before she can type a new password. The recovery
 * route needs the same exemption the application screen already has.
 */
describe('isResetPasswordRoute', () => {
  it('matches on an exact segment', () => {
    expect(isResetPasswordRoute(['(auth)', 'reset-password'], '/(auth)')).toBe(true);
  });

  it('matches on pathname', () => {
    expect(isResetPasswordRoute(['(auth)'], '/(auth)/reset-password')).toBe(true);
  });

  /**
   * Route groups are invisible in the browser URL, so the deployed web app
   * reports the path as `/reset-password` — the form the emailed link uses.
   */
  it('matches the URL the email actually lands on, with no group in it', () => {
    expect(isResetPasswordRoute(['(auth)', 'reset-password'], '/reset-password')).toBe(true);
  });

  it('does not match the welcome screen', () => {
    expect(isResetPasswordRoute(['(auth)', 'welcome'], '/(auth)/welcome')).toBe(false);
  });

  it('does not match an empty segment list on first render', () => {
    expect(isResetPasswordRoute([], '/')).toBe(false);
  });
});

describe('shouldRedirectToPending — a recovery session is not a routing decision', () => {
  it('leaves a rejected applicant on the reset screen long enough to reset', () => {
    // Her account being rejected does not make the password change illegitimate,
    // and bouncing her to /pending mid-reset loses the one-time token for good.
    expect(
      shouldRedirectToPending('rejected', ['(auth)', 'reset-password'], '/reset-password'),
    ).toBe(false);
  });
});

describe('shouldRedirectToApplication — holding a code does not interrupt a reset', () => {
  it('leaves a code-holder on the reset screen', () => {
    expect(
      shouldRedirectToApplication(false, true, ['(auth)', 'reset-password'], '/reset-password'),
    ).toBe(false);
  });
});
