/**
 * The root layout's vetting redirect, as a rule that can be tested.
 *
 * It lives here rather than inline in _layout.tsx because it runs inside an
 * effect, behind an async profile fetch, in a branch that only an applicant
 * ever reaches — a bug in it is invisible in development and shows up as a real
 * woman trapped on a screen she cannot leave.
 */

/**
 * Is the user on the application screen?
 *
 * Checks segments AND pathname for the same reason the onboarding exemption in
 * _layout.tsx does: useSegments() emits transient intermediate values during
 * Stack push animations (briefly ['(auth)'] before the child segment resolves),
 * while usePathname() is computed differently and stays stable across the
 * transition. Either one alone can read false mid-navigation and let the
 * redirect through.
 */
export const isApplicationRoute = (
  segments: readonly string[],
  pathname: string,
): boolean => segments.some((s) => s === 'application') || pathname.includes('/application');

/**
 * Is the user on the password-recovery screen?
 *
 * This exists for the same reason `isApplicationRoute` does, and it is load
 * bearing in a way that is easy to miss: consuming a recovery token creates a
 * real, authenticated session. The instant it lands, the root layout's cascade
 * fetches her profile and replaces the route — with the feed, with onboarding,
 * or with the pending screen — and the reset form is gone before she has typed
 * anything. The recovery token is single-use, so that is not a retryable
 * annoyance: the link in her inbox is now spent and she has to start over.
 *
 * Checks segments AND pathname for the dual-read reason documented above, plus
 * one specific to this route: expo-router groups are invisible in a browser
 * URL, so on the deployed web app — where most resets are opened — the path
 * reads `/reset-password`, with no `(auth)` in it at all.
 */
export const isResetPasswordRoute = (
  segments: readonly string[],
  pathname: string,
): boolean =>
  segments.some((s) => s === 'reset-password') || pathname.includes('/reset-password');

/**
 * Should this profile be sent to the pending screen?
 *
 * A rejected applicant belongs on the pending screen so she can appeal.
 * A pending applicant stays in the app — Archive plus a status chip — so this
 * redirect is only for rejection. The application screen is still exempt.
 *
 * The application screen is where an applicant fills in her application, and an
 * applicant is 'pending' by definition. Without the exemption the redirect fires
 * on /(auth)/application too, so the screen can never be opened: the "Open
 * application" button on the pending screen bounces straight back to the
 * pending screen, and the whole applicant flow is unreachable. Onboarding is
 * exempted from the neighbouring guard for the same class of reason.
 *
 * A missing status (no profile row yet) is not a reason to redirect — that case
 * belongs to the onboarding branch.
 */
export const shouldRedirectToPending = (
  vettingStatus: string | null | undefined,
  segments: readonly string[],
  pathname: string,
): boolean => {
  // Pending applicants stay in the app (Archive + a status chip). Only a
  // rejection still needs this full-screen wait so she can appeal.
  if (vettingStatus !== 'rejected') return false;
  // A rejected account can still legitimately change its password, and the
  // recovery token is single-use — see isResetPasswordRoute.
  if (isResetPasswordRoute(segments, pathname)) return false;
  return !isApplicationRoute(segments, pathname);
};

/**
 * Should this user be sent to the application screen to redeem a held code?
 *
 * Apple and Google are a single call that both signs in and signs up, and it
 * completes through a redirect — so welcome.tsx is gone before a session exists
 * to redeem the code against, and it deliberately does not try
 * (welcome.tsx:106). The redemption instead happens inside
 * gateStore.loadApplication, which creates the application when it finds a held
 * code and no application row. That recovery path only runs on a screen that
 * calls it, and the only two are /(auth)/application and /(auth)/pending.
 *
 * Without this rule the layout sent her to onboarding instead: an OAuth signup
 * has no profile row and therefore no vetting_status, so the pending redirect
 * did not fire and the next branch is `!data -> onboarding`. loadApplication
 * never ran, the code was never redeemed, and she completed onboarding — which
 * creates the profile row at its DEFAULT vetting_status of 'unvetted', the
 * grandfather state with full access (migration 079). A woman holding a valid
 * code walked into the entire app without a reviewer ever seeing an
 * application.
 *
 * `profileExists` is what separates a brand-new account from an established
 * one, and it has to be here: an existing member who typed a code and then used
 * "I already have an account" still holds a validated code in the store, and
 * sending HER to the application screen would call
 * create_membership_application against a working account and drop it into
 * 'pending' — locking out a member who did nothing wrong. Nothing creates a
 * profile row before onboarding except the applicant bootstrap in migration
 * 083, so no row means no account yet.
 */
export const shouldRedirectToApplication = (
  profileExists: boolean,
  hasValidatedCode: boolean,
  segments: readonly string[],
  pathname: string,
): boolean => {
  if (!hasValidatedCode) return false;
  if (profileExists) return false;
  // Same exemption, same reason: redeeming a held code can wait until she has
  // a password again, and the token she is spending right now cannot.
  if (isResetPasswordRoute(segments, pathname)) return false;
  return !isApplicationRoute(segments, pathname);
};

/**
 * Is the user on the code screen?
 *
 * Same dual read as the other route predicates. The signed-in variant of
 * /(auth)/code is where a woman whose code failed after signup lands (G-15).
 */
export const isCodeRoute = (
  segments: readonly string[],
  pathname: string,
): boolean => segments.some((s) => s === 'code') || pathname.endsWith('/code');

/**
 * Should a signed-in account with no profile be sent to enter a code?
 *
 * G-15. An account can exist with no profile and no held code: the code was
 * exhausted between validation and signup, the network dropped mid-redeem, or
 * the app was killed (the held code lives in memory). The layout used to send
 * that account to onboarding, and onboarding creates a profile — at the old
 * default of full access. Migration 130 makes that profile 'pending' by force,
 * but onboarding is still the wrong place: she has nothing to be reviewed on.
 * She goes back to the code screen, signed in, with her account intact.
 *
 * Recovery and the application screen keep their exemptions.
 */
export const shouldRedirectToCode = (
  profileExists: boolean,
  hasValidatedCode: boolean,
  segments: readonly string[],
  pathname: string,
): boolean => {
  if (profileExists || hasValidatedCode) return false;
  if (isResetPasswordRoute(segments, pathname)) return false;
  if (isApplicationRoute(segments, pathname)) return false;
  return !isCodeRoute(segments, pathname);
};

/**
 * Is this account being deleted? (G-16)
 *
 * gdpr-delete soft-deletes the profile (deleted_at) and the server refuses a
 * deleted account everything (130: is_approved_member is false, profiles RLS
 * shows nobody). The client must agree, or a deleted woman who signs back in
 * lands on an onboarded-member shell that RLS has emptied. She is signed out
 * and told why.
 */
export const isDeletedProfile = (
  profile: { deleted_at?: string | null } | null | undefined,
): boolean => !!profile?.deleted_at;

// ---------------------------------------------------------------------------
// The root layout's routing decision (hooks/useRootRedirect.ts applies it).
//
// It lived inline in an effect in app/_layout.tsx, where no test could reach
// it, and two login bugs shipped past a green suite because of that:
//
// - b2e54f94 (Bug A): a signed-out deep link redirected before the root
//   navigator had mounted. expo-router throws "Attempted to navigate before
//   mounting the Root Layout component" from router.replace in that window and
//   the page stayed blank. The URL hands useSegments() real segments before
//   any navigator renders, so the `segments.length` guard did not hold; only
//   `navigatorReady` does (hooks/useRootNavigatorReady.ts).
// - 848c7c75 (Bug B): /code was exempt from routing for EVERY signed-in
//   account, so Back right after signing in left an approved member on the
//   applicant code screen. The exemption is now for the account it was built
//   for: signed in, no profile row (G-15).
// ---------------------------------------------------------------------------

export const CODE_GATE_HREF = '/(auth)/code';
export const PENDING_HREF = '/(auth)/pending';
export const APPLICATION_HREF = '/(auth)/application';
export const ONBOARDING_START_HREF = '/(auth)/onboarding/step1-identity';
/**
 * The feed is the front door in 3.0 (and app/index.tsx must agree with it).
 * Grow was a dashboard you read; the feed is something to be in.
 */
export const MEMBER_HOME_HREF = '/(tabs)/feed';

const isOnboardingRoute = (segments: readonly string[], pathname: string): boolean =>
  segments.some((s) => s === 'onboarding') || pathname.includes('/onboarding');

/**
 * The page a signed-out deep link asked for, if it is safe to return to.
 *
 * Only an in-app path, never the root (the default home covers it), never an
 * auth screen (she is about to leave those), and never anything that could
 * resolve outside the app: expo-router hands an href with a scheme to
 * Linking.openURL, and `//host` is protocol-relative on the web. The query
 * and fragment are dropped — a fragment left on a path makes the route
 * unknown to every predicate here.
 */
export const returnToFor = (pathname: string): string | null => {
  const path = pathname.split(/[?#]/)[0] ?? '';
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.includes('\\') || path.includes(':')) return null;
  if (path === '/') return null;
  if (
    isCodeRoute([], path) ||
    isApplicationRoute([], path) ||
    isResetPasswordRoute([], path) ||
    isWelcomeInRoute([], path) ||
    isOnboardingRoute([], path) ||
    path === '/welcome' ||
    path === '/pending'
  ) {
    return null;
  }
  return path;
};

export interface RootRouteInput {
  /** The root navigator has mounted (useRootNavigatorReady: the container ref's isReady()). */
  navigatorReady: boolean;
  /** The stored session is still being read. */
  authLoading: boolean;
  signedIn: boolean;
  /**
   * A session existed earlier in this launch. Then a signed-out redirect is a
   * sign-out, not a deep link, and the page she left is not a return-to.
   */
  hadSession: boolean;
  segments: readonly string[];
  pathname: string;
  /** The stored profile, only when it belongs to the signed-in user. */
  liveProfile: { onboarding_completed?: boolean | null } | null;
}

export type RootRouteDecision =
  /** Not yet: nothing may navigate, and nothing is decided. */
  | { kind: 'wait'; reason: 'auth' | 'navigator' | 'segments' }
  | { kind: 'stay' }
  | { kind: 'redirect'; href: string; returnTo: string | null }
  /** Fetch her profile, then apply decideAfterProfileFetch. */
  | { kind: 'check-profile'; origin: 'auth' | 'app' };

/**
 * What the root layout does on this render, before any profile is fetched.
 *
 * Order matters and each step is a test in __tests__/lib/authRoutingDecision:
 * the session first, then the navigator, then segments. Every branch that can
 * navigate — directly, or after the profile fetch — sits below the navigator
 * check, so no path through this function can reach router.replace before a
 * navigator exists.
 */
export const decideRootRoute = (input: RootRouteInput): RootRouteDecision => {
  const { navigatorReady, authLoading, signedIn, hadSession, segments, pathname, liveProfile } = input;
  if (authLoading) return { kind: 'wait', reason: 'auth' };
  if (!navigatorReady) return { kind: 'wait', reason: 'navigator' };
  // segments is [] on `/` until the index route's <Redirect> resolves. Acting
  // on empty segments reads as "not in auth, not onboarding" and would bounce
  // a mid-onboarding user back to step 1 on every navigation.
  if (!segments.length) return { kind: 'wait', reason: 'segments' };

  const inAuth = segments[0] === '(auth)';
  // Both reads: useSegments() emits transient values during Stack push
  // animations (['(auth)'] before the child resolves); usePathname() does not.
  const inOnboarding = isOnboardingRoute(segments, pathname);
  // Recovery owns the route until she has typed a new password: the emailed
  // token opens a real session and is single-use (see isResetPasswordRoute).
  const inRecovery = isResetPasswordRoute(segments, pathname);

  if (!signedIn) {
    if (inAuth) return { kind: 'stay' };
    // The code gate, not welcome. Roxy is invite-only: an account cannot be
    // created without a code a community issued, so code entry is the first
    // screen and sign-in is reached from it.
    return { kind: 'redirect', href: CODE_GATE_HREF, returnTo: hadSession ? null : returnToFor(pathname) };
  }

  if (inAuth) {
    // "You're in" (G-11) sits in the auth group but belongs to an approved
    // member; the cascade would send her straight to the feed.
    if (inOnboarding || inRecovery || isWelcomeInRoute(segments, pathname)) return { kind: 'stay' };
    // /code included: whether she belongs there is decided by her profile.
    return { kind: 'check-profile', origin: 'auth' };
  }

  if (inRecovery) return { kind: 'stay' };
  // A partially-onboarded user must not reach the app on a stale store.
  if (!liveProfile || !liveProfile.onboarding_completed) return { kind: 'check-profile', origin: 'app' };
  return { kind: 'stay' };
};

export interface ProfileRouteInput {
  /** Where the check started: an auth-group screen, or inside the app. */
  origin: 'auth' | 'app';
  /**
   * Her my_profile row; null when she has none. Its own vetting_status is not
   * read here — `vettingStatus` below is, after the view-as preview.
   */
  profile: {
    deleted_at?: string | null;
    onboarding_completed?: boolean | null;
    vetting_status?: string | null;
  } | null;
  /** Her vetting status after the core view-as preview (effectiveVettingStatus). */
  vettingStatus: string | null | undefined;
  /** gateStore holds a validated, unredeemed code. */
  hasValidatedCode: boolean;
  segments: readonly string[];
  pathname: string;
  /** The page a signed-out deep link asked for (returnToFor), if any. */
  returnTo: string | null;
}

export type ProfileRouteDecision =
  | { kind: 'sign-out-deleted' }
  /** `admit`: store the profile (and its theme) before navigating. */
  | { kind: 'redirect'; href: string; admit: boolean }
  /** Store the profile; she stays where she is. */
  | { kind: 'admit' }
  | { kind: 'stay' };

/**
 * Where she goes once her profile row is in hand. The precedence is the one
 * the layout has always had; the only new rule is the G-15 stay on /code.
 */
export const decideAfterProfileFetch = (input: ProfileRouteInput): ProfileRouteDecision => {
  const { origin, profile, vettingStatus, hasValidatedCode, segments, pathname, returnTo } = input;
  // G-16: a deleted account has no access anywhere (the server agrees:
  // is_approved_member() is false and profiles RLS shows nobody).
  if (isDeletedProfile(profile)) return { kind: 'sign-out-deleted' };
  // The signed-in code screen is a destination exactly for the accounts it may
  // redeem for: no profile row (G-15) and a rejected applicant re-applying
  // ("Enter a new code" on the pending screen; the server enforces her
  // cooldown). It sits above the pending check, which would otherwise send
  // the rejected applicant straight back to /pending. Anyone else with a
  // profile is already through the gate and the cascade takes her home.
  if (isCodeRoute(segments, pathname) && mayRedeemCodeForAccount(profile)) return { kind: 'stay' };
  // The gate outranks onboarding (see shouldRedirectToPending).
  if (shouldRedirectToPending(vettingStatus, segments, pathname)) {
    return { kind: 'redirect', href: PENDING_HREF, admit: false };
  }
  const profileExists = !!profile;
  // A held code outranks onboarding (OAuth signs up through a redirect).
  if (shouldRedirectToApplication(profileExists, hasValidatedCode, segments, pathname)) {
    return { kind: 'redirect', href: APPLICATION_HREF, admit: false };
  }
  if (shouldRedirectToCode(profileExists, hasValidatedCode, segments, pathname)) {
    return { kind: 'redirect', href: CODE_GATE_HREF, admit: false };
  }
  const onboarded = !!profile?.onboarding_completed;
  if (origin === 'auth') {
    if (!onboarded) return { kind: 'redirect', href: ONBOARDING_START_HREF, admit: false };
    return { kind: 'redirect', href: returnTo ?? MEMBER_HOME_HREF, admit: true };
  }
  if (onboarded) return { kind: 'admit' };
  return { kind: 'redirect', href: ONBOARDING_START_HREF, admit: false };
};

/**
 * May the signed-in code screen redeem a code for this account?
 *
 * redeem_invite_code (134_gate_followups.sql) refuses only an APPROVED row;
 * for any other existing row it upserts the application and sets
 * vetting_status = 'pending'. So the client must refuse first: the code
 * screen exists for an account with no profile row (G-15). A rejected
 * applicant may re-apply (the server enforces her cooldown). Everything else —
 * approved, pending, a grandfathered 'unvetted' row, a missing status, a
 * deleted account — fails closed.
 */
export const mayRedeemCodeForAccount = (
  profile: { vetting_status?: string | null; deleted_at?: string | null } | null,
): boolean => {
  if (!profile) return true;
  if (profile.deleted_at) return false;
  return profile.vetting_status === 'rejected';
};

/** Is the user on the "You're in" screen? Same dual read as the others. */
export const isWelcomeInRoute = (
  segments: readonly string[],
  pathname: string,
): boolean => segments.some((s) => s === 'welcome-in') || pathname.includes('/welcome-in');

/**
 * May a just-approved member be interrupted by "You're in" here? (G-11)
 *
 * Only an approved member who has finished onboarding, and only once she is
 * inside the app. Never from an auth-group screen — onboarding, pending,
 * application, the welcome itself — and never on a recovery link (the token
 * is single-use; see isResetPasswordRoute). Whether the greeting is actually
 * due (fresh approval, not yet seen on this device) is lib/welcomeIn's call.
 */
export const canGreetNewMemberHere = (
  vettingStatus: string | null | undefined,
  onboardingCompleted: boolean,
  segments: readonly string[],
  pathname: string,
): boolean => {
  if (vettingStatus !== 'approved' || !onboardingCompleted) return false;
  if (!segments.length) return false;
  if (segments[0] === '(auth)') return false;
  if (isResetPasswordRoute(segments, pathname)) return false;
  return !isWelcomeInRoute(segments, pathname);
};
