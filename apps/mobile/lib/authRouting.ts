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
 * Should this profile be sent to the pending screen?
 *
 * 'pending' and 'rejected' both mean a human has not admitted her, so she can
 * read nothing and belongs on the pending screen — with one exception, which is
 * the entire point of this function.
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
  if (vettingStatus !== 'pending' && vettingStatus !== 'rejected') return false;
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
  return !isApplicationRoute(segments, pathname);
};
