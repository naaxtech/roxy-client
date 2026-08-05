import {
  isApplicationRoute,
  shouldRedirectToPending,
  shouldRedirectToApplication,
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

describe('shouldRedirectToPending — the gate still holds everywhere else', () => {
  it('redirects a pending applicant away from the tabs', () => {
    expect(shouldRedirectToPending('pending', ['(tabs)', 'grow'], '/(tabs)/grow')).toBe(true);
  });

  it('redirects a rejected applicant away from the tabs', () => {
    expect(shouldRedirectToPending('rejected', ['(tabs)', 'grow'], '/(tabs)/grow')).toBe(true);
  });

  it('redirects a pending applicant away from onboarding', () => {
    expect(
      shouldRedirectToPending(
        'pending',
        ['(auth)', 'onboarding', 'step1-identity'],
        '/(auth)/onboarding/step1-identity',
      ),
    ).toBe(true);
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
