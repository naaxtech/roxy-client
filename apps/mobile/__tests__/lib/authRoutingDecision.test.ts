/**
 * The root layout's routing decision as plain data in, plain data out.
 *
 * Two login bugs shipped past a green suite because this decision lived inline
 * in an effect in app/_layout.tsx, where no test could reach it:
 *
 * - Bug A (b2e54f94): a signed-out deep link (/feed, /notifications, /archive,
 *   /user/<id>) redirected before the root navigator existed, expo-router threw
 *   "Attempted to navigate before mounting the Root Layout component", and the
 *   page stayed blank forever.
 * - Bug B (848c7c75): Back right after signing in landed an approved member on
 *   the signed-in code screen ("One more step: your code"), because the code
 *   route was exempt from routing for every signed-in account — not just the
 *   profile-less one it was built for.
 */
import {
  decideRootRoute,
  decideAfterProfileFetch,
  returnToFor,
  mayRedeemCodeForAccount,
  CODE_GATE_HREF,
  MEMBER_HOME_HREF,
  PENDING_HREF,
  APPLICATION_HREF,
  ONBOARDING_START_HREF,
  type RootRouteInput,
  type ProfileRouteInput,
} from '../../lib/authRouting';

const root = (over: Partial<RootRouteInput>): RootRouteInput => ({
  navigatorReady: true,
  authLoading: false,
  signedIn: false,
  hadSession: false,
  segments: [],
  pathname: '/',
  liveProfile: null,
  ...over,
});

const after = (over: Partial<ProfileRouteInput>): ProfileRouteInput => ({
  origin: 'auth',
  profile: null,
  vettingStatus: null,
  hasValidatedCode: false,
  segments: ['(auth)', 'welcome'],
  pathname: '/welcome',
  returnTo: null,
  ...over,
});

const MEMBER = { id: 'u1', vetting_status: 'approved', onboarding_completed: true, deleted_at: null };

describe('decideRootRoute — Bug A: never navigate before the root navigator is mounted', () => {
  const deepLinks: [string[], string][] = [
    [['notifications'], '/notifications'],
    [['(tabs)', 'feed'], '/feed'],
    [['archive'], '/archive'],
    [['user', '[id]'], '/user/183d2c16-5eac-4739-8b7e-707834917663'],
  ];

  it.each(deepLinks)('signed out on %j (%s), navigator NOT ready: waits, no redirect', (segments, pathname) => {
    // The URL hands expo-router its segments before any navigator renders —
    // which is exactly why the old `segments.length` guard did not hold.
    const d = decideRootRoute(root({ navigatorReady: false, segments, pathname }));
    expect(d).toEqual({ kind: 'wait', reason: 'navigator' });
  });

  it.each(deepLinks)('signed out on %j (%s), navigator ready: the code gate', (segments, pathname) => {
    const d = decideRootRoute(root({ segments, pathname }));
    expect(d).toEqual({ kind: 'redirect', href: CODE_GATE_HREF, returnTo: pathname });
  });

  it('signed out on /, before the index redirect resolves: waits on empty segments', () => {
    expect(decideRootRoute(root({ segments: [], pathname: '/' }))).toEqual({ kind: 'wait', reason: 'segments' });
  });

  it('waits while the session is still being read, even with the navigator up', () => {
    expect(decideRootRoute(root({ authLoading: true, segments: ['notifications'], pathname: '/notifications' })))
      .toEqual({ kind: 'wait', reason: 'auth' });
  });

  it('signed out on an auth screen: stays (the code gate, welcome, a reset link)', () => {
    expect(decideRootRoute(root({ segments: ['(auth)', 'code'], pathname: '/code' }))).toEqual({ kind: 'stay' });
    expect(decideRootRoute(root({ segments: ['(auth)', 'welcome'], pathname: '/welcome' }))).toEqual({ kind: 'stay' });
    expect(decideRootRoute(root({ segments: ['(auth)', 'reset-password'], pathname: '/reset-password' })))
      .toEqual({ kind: 'stay' });
  });

  it('signing out is not a deep link: the page she signed out from is not a return-to', () => {
    const d = decideRootRoute(root({ hadSession: true, segments: ['(tabs)', 'you', 'settings'], pathname: '/you/settings' }));
    expect(d).toEqual({ kind: 'redirect', href: CODE_GATE_HREF, returnTo: null });
  });

  it('a signed-in reload on a deep link also waits for the navigator before checking anything', () => {
    const d = decideRootRoute(root({ signedIn: true, navigatorReady: false, segments: ['notifications'], pathname: '/notifications' }));
    expect(d).toEqual({ kind: 'wait', reason: 'navigator' });
  });
});

describe('decideRootRoute — signed in', () => {
  it('Bug B: on /code she is checked like on any other auth screen (was: exempt for everyone)', () => {
    expect(decideRootRoute(root({ signedIn: true, segments: ['(auth)', 'code'], pathname: '/code' })))
      .toEqual({ kind: 'check-profile', origin: 'auth' });
  });

  it('on welcome: checked (the post-sign-in cascade)', () => {
    expect(decideRootRoute(root({ signedIn: true, segments: ['(auth)', 'welcome'], pathname: '/welcome' })))
      .toEqual({ kind: 'check-profile', origin: 'auth' });
  });

  it('onboarding, a reset link and "You\'re in" own their routes', () => {
    for (const [segments, pathname] of [
      [['(auth)', 'onboarding', 'step2-interests'], '/onboarding/step2-interests'],
      [['(auth)', 'reset-password'], '/reset-password'],
      [['(auth)', 'welcome-in'], '/welcome-in'],
    ] as [string[], string][]) {
      expect(decideRootRoute(root({ signedIn: true, segments, pathname }))).toEqual({ kind: 'stay' });
    }
  });

  it('in the app with no stored profile: checked', () => {
    expect(decideRootRoute(root({ signedIn: true, segments: ['notifications'], pathname: '/notifications' })))
      .toEqual({ kind: 'check-profile', origin: 'app' });
  });

  it('in the app with an unfinished profile: checked', () => {
    expect(decideRootRoute(root({
      signedIn: true, segments: ['(tabs)', 'feed'], pathname: '/feed', liveProfile: { onboarding_completed: false },
    }))).toEqual({ kind: 'check-profile', origin: 'app' });
  });

  it('in the app with an onboarded profile: stays', () => {
    expect(decideRootRoute(root({
      signedIn: true, segments: ['(tabs)', 'feed'], pathname: '/feed', liveProfile: { onboarding_completed: true },
    }))).toEqual({ kind: 'stay' });
  });

  it('a recovery path outside the group (web drops groups): stays', () => {
    expect(decideRootRoute(root({ signedIn: true, segments: ['reset-password'], pathname: '/reset-password' })))
      .toEqual({ kind: 'stay' });
  });
});

describe('decideAfterProfileFetch — Bug B: a member is never left on the code screen', () => {
  const onCode = { segments: ['(auth)', 'code'], pathname: '/code' };

  it('an approved, onboarded member on /code goes home (Back after sign-in)', () => {
    expect(decideAfterProfileFetch(after({ ...onCode, profile: MEMBER, vettingStatus: 'approved' })))
      .toEqual({ kind: 'redirect', href: MEMBER_HOME_HREF, admit: true });
  });

  it('…even while a code is still held in memory', () => {
    expect(decideAfterProfileFetch(after({ ...onCode, profile: MEMBER, vettingStatus: 'approved', hasValidatedCode: true })))
      .toEqual({ kind: 'redirect', href: MEMBER_HOME_HREF, admit: true });
  });

  it('a pending applicant with an unfinished profile on /code goes on to onboarding, not the code', () => {
    const profile = { ...MEMBER, vetting_status: 'pending', onboarding_completed: false };
    expect(decideAfterProfileFetch(after({ ...onCode, profile, vettingStatus: 'pending' })))
      .toEqual({ kind: 'redirect', href: ONBOARDING_START_HREF, admit: false });
  });

  // The pending screen's "Enter a new code" (pending.tsx) pushes /code once
  // her waiting period is over; the code screen may redeem for her
  // (mayRedeemCodeForAccount) and the server enforces the cooldown. Bouncing
  // her back to /pending made the button do nothing (review, 2026-10-28).
  it('a rejected applicant on /code stays there to re-apply with a new code', () => {
    const profile = { ...MEMBER, vetting_status: 'rejected' };
    expect(decideAfterProfileFetch(after({ ...onCode, profile, vettingStatus: 'rejected' })))
      .toEqual({ kind: 'stay' });
  });

  it('a rejected applicant anywhere else still goes to the pending screen', () => {
    const profile = { ...MEMBER, vetting_status: 'rejected' };
    expect(decideAfterProfileFetch(after({ ...onCode, segments: ['(tabs)', 'feed'], pathname: '/feed', profile, vettingStatus: 'rejected' })))
      .toEqual({ kind: 'redirect', href: PENDING_HREF, admit: false });
  });

  it('G-15 still works: signed in, no profile, no held code — she stays on /code', () => {
    expect(decideAfterProfileFetch(after({ ...onCode }))).toEqual({ kind: 'stay' });
  });

  it('signed in, no profile, a code held on /code: stays (the screen redeems it itself)', () => {
    expect(decideAfterProfileFetch(after({ ...onCode, hasValidatedCode: true }))).toEqual({ kind: 'stay' });
  });

  it('a deleted account is signed out, wherever she is', () => {
    expect(decideAfterProfileFetch(after({ ...onCode, profile: { ...MEMBER, deleted_at: '2026-10-01T00:00:00Z' } })))
      .toEqual({ kind: 'sign-out-deleted' });
  });
});

describe('decideAfterProfileFetch — the cascade, unchanged', () => {
  it('signed in on welcome with no profile and no code: the code screen (G-15)', () => {
    expect(decideAfterProfileFetch(after({}))).toEqual({ kind: 'redirect', href: CODE_GATE_HREF, admit: false });
  });

  it('signed in on welcome with no profile and a held code: the application (OAuth signup)', () => {
    expect(decideAfterProfileFetch(after({ hasValidatedCode: true })))
      .toEqual({ kind: 'redirect', href: APPLICATION_HREF, admit: false });
  });

  it('an onboarded member signing in: the feed', () => {
    expect(decideAfterProfileFetch(after({ profile: MEMBER, vettingStatus: 'approved' })))
      .toEqual({ kind: 'redirect', href: MEMBER_HOME_HREF, admit: true });
  });

  it('an onboarded member signing in from a deep link: the page she asked for', () => {
    expect(decideAfterProfileFetch(after({ profile: MEMBER, vettingStatus: 'approved', returnTo: '/notifications' })))
      .toEqual({ kind: 'redirect', href: '/notifications', admit: true });
  });

  it('the return-to never skips onboarding', () => {
    const profile = { ...MEMBER, onboarding_completed: false };
    expect(decideAfterProfileFetch(after({ profile, vettingStatus: 'approved', returnTo: '/notifications' })))
      .toEqual({ kind: 'redirect', href: ONBOARDING_START_HREF, admit: false });
  });

  it('a pending, onboarded applicant stays in the app (Archive + status chip)', () => {
    const profile = { ...MEMBER, vetting_status: 'pending' };
    expect(decideAfterProfileFetch(after({ profile, vettingStatus: 'pending' })))
      .toEqual({ kind: 'redirect', href: MEMBER_HOME_HREF, admit: true });
  });

  it('in the app, onboarded: admitted where she is', () => {
    expect(decideAfterProfileFetch(after({
      origin: 'app', profile: MEMBER, vettingStatus: 'approved', segments: ['notifications'], pathname: '/notifications',
    }))).toEqual({ kind: 'admit' });
  });

  it('in the app, unfinished: onboarding', () => {
    expect(decideAfterProfileFetch(after({
      origin: 'app', profile: { ...MEMBER, onboarding_completed: false }, vettingStatus: 'approved',
      segments: ['(tabs)', 'feed'], pathname: '/feed',
    }))).toEqual({ kind: 'redirect', href: ONBOARDING_START_HREF, admit: false });
  });

  it('in the app, rejected: the pending screen', () => {
    expect(decideAfterProfileFetch(after({
      origin: 'app', profile: { ...MEMBER, vetting_status: 'rejected' }, vettingStatus: 'rejected',
      segments: ['(tabs)', 'feed'], pathname: '/feed',
    }))).toEqual({ kind: 'redirect', href: PENDING_HREF, admit: false });
  });

  it('in the app with no profile and no code: the code screen', () => {
    expect(decideAfterProfileFetch(after({ origin: 'app', segments: ['(tabs)', 'feed'], pathname: '/feed' })))
      .toEqual({ kind: 'redirect', href: CODE_GATE_HREF, admit: false });
  });
});

describe('returnToFor — only an in-app, non-auth path survives', () => {
  it('keeps an ordinary in-app path', () => {
    expect(returnToFor('/notifications')).toBe('/notifications');
    expect(returnToFor('/user/183d2c16-5eac-4739-8b7e-707834917663')).toBe('/user/183d2c16-5eac-4739-8b7e-707834917663');
  });
  it('drops the root (the default home already covers it)', () => {
    expect(returnToFor('/')).toBeNull();
    expect(returnToFor('')).toBeNull();
  });
  it('never anything that could leave the app', () => {
    expect(returnToFor('//evil.example')).toBeNull();
    expect(returnToFor('https://evil.example/x')).toBeNull();
    expect(returnToFor('/\\evil.example')).toBeNull();
    expect(returnToFor('notifications')).toBeNull();
  });
  it('never an auth screen', () => {
    for (const p of ['/code', '/welcome', '/welcome-in', '/pending', '/application', '/reset-password', '/onboarding/step1-identity']) {
      expect(returnToFor(p)).toBeNull();
    }
  });
  it('strips a query and a fragment', () => {
    expect(returnToFor('/archive?tab=movies')).toBe('/archive');
    expect(returnToFor('/archive#top')).toBe('/archive');
  });
});

describe('mayRedeemCodeForAccount — the code screen never downgrades a member', () => {
  it('an account with no profile row may redeem (G-15)', () => {
    expect(mayRedeemCodeForAccount(null)).toBe(true);
  });
  it('an approved member may not (redeeming would reset her to pending)', () => {
    expect(mayRedeemCodeForAccount({ vetting_status: 'approved', deleted_at: null })).toBe(false);
  });
  it('a pending applicant may not (she already has an application)', () => {
    expect(mayRedeemCodeForAccount({ vetting_status: 'pending', deleted_at: null })).toBe(false);
  });
  it('a grandfathered or unknown status may not (fail closed)', () => {
    expect(mayRedeemCodeForAccount({ vetting_status: 'unvetted', deleted_at: null })).toBe(false);
    expect(mayRedeemCodeForAccount({ vetting_status: null, deleted_at: null })).toBe(false);
  });
  it('a rejected applicant may (the server enforces her cooldown)', () => {
    expect(mayRedeemCodeForAccount({ vetting_status: 'rejected', deleted_at: null })).toBe(true);
  });
  it('a deleted account may not', () => {
    expect(mayRedeemCodeForAccount({ vetting_status: 'rejected', deleted_at: '2026-10-01T00:00:00Z' })).toBe(false);
  });
});
