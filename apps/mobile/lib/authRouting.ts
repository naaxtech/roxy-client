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
