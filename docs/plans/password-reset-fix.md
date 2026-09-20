# Password reset — make it actually work

Date: 2026-09-20 · Branch: `feature/wlw-archive`

## Symptom

"Password reset does not work. It redirects to localhost."

## Root cause — three layers, all broken

Evidence gathered by generating the real recovery link through the GoTrue admin
API (`POST /auth/v1/admin/generate_link`) against the live project
`ptymtdlysqbpxzlgsshp`:

| # | Layer | Evidence | Effect |
|---|---|---|---|
| A | Client sends no `redirectTo` | `hooks/useAuth.ts:81` calls `resetPasswordForEmail(email)` with no options | GoTrue falls back to the project **Site URL**. Supabase's default Site URL is `http://localhost:3000` — that is the reported localhost redirect. |
| B | Project Site URL is a glob | `site_url = "https://roxy.expo.app/**"`, `uri_allow_list = "https://roxy.expo.app/**"` | `site_url` must be an *exact* URL; the glob belongs only in the allow list. Generated link today carries `redirect_to=https://roxy.expo.app/**` — a literal `/**` path. Also `roxy://auth/callback` is **rejected** by the allow list and silently falls back to site_url. |
| C | Nothing receives the token | No `reset-password` route exists; no `updateUser({password})` call exists anywhere; `lib/supabase.ts` sets `detectSessionInUrl: false`; every `Linking` call in the app is outbound (`openURL`/`createURL`) | Even with A and B fixed the link dead-ends. The token is never consumed and there is no screen to type a new password. |

Fixing only A and B would move the dead end, not remove it. This is the
"does anything read it" failure from `.claude/rules/superpowers-pipeline.md`.

A fourth trap, found by reading `app/_layout.tsx`: the moment the recovery
session lands, the root redirect cascade fires (`user && inAuth &&
!inOnboarding`) and replaces the route with `/(tabs)/feed`, `/(auth)/pending`
or onboarding — **throwing her off the reset screen before she can type**. The
recovery route needs the same exemption `application` already has.

## The slice

One user-visible outcome: *a woman who forgot her password receives an email,
taps it, sets a new password, and lands in the app signed in.*

### Files

| File | Change |
|---|---|
| `lib/passwordReset.ts` | **new** — pure: `RESET_PASSWORD_PATH`, `resetRedirectUrl()`, `parseRecoveryParams(url)` |
| `__tests__/lib/passwordReset.test.ts` | **new** — failing first |
| `lib/authRouting.ts` | add `isResetPasswordRoute()`; recovery exemption rule |
| `__tests__/lib/authRouting.test.ts` | extend |
| `app/_layout.tsx` | exempt the recovery route from both redirect blocks |
| `hooks/useAuth.ts` | `resetPassword` passes `redirectTo`; add `updatePassword` |
| `__tests__/hooks/useAuth.test.ts` | extend |
| `app/(auth)/reset-password.tsx` | **new** — the screen |
| `supabase/config.toml` | local parity for site_url + allow list |
| Supabase project auth config | exact `site_url`, widened `uri_allow_list` |

### Decisions

- **Redirect target is per-platform.** Web uses `window.location.origin +
  '/reset-password'` so dev (`localhost:8083`) and prod (`roxy.expo.app`) each
  produce their own correct URL with no build-time constant to drift. Native
  uses `Linking.createURL('/reset-password')` → `roxy:///reset-password`,
  matching the `archiveShare`/`FeedCellChrome` idiom already in the tree.
- **Implicit flow, not PKCE.** supabase-js 2.105.4 defaults to `flowType:
  'implicit'`; recovery therefore returns tokens in the URL **fragment**.
  Switching the client to PKCE would change the existing OAuth and signup paths
  that work today — out of scope for a bug fix.
- **Parse the URL by hand rather than flipping `detectSessionInUrl: true`.**
  That flag is global and would make every page load try to consume auth params;
  the recovery screen is the only surface that should. Keeping it off also keeps
  the token out of a session on any other route.
- **Read both fragment and query.** GoTrue returns failures as
  `?error=access_denied&error_code=otp_expired`. An expired link is the most
  common real case and must say so, not render blank.
- `site_url` set to `https://roxy.expo.app` (exact). Allow list widened to
  `https://roxy.expo.app/**`, `roxy://**`, `http://localhost:8083/**`,
  `http://localhost:19006/**`.

### Verification

1. Jest: new + extended suites green, and the **whole** suite count unchanged
   otherwise (`green-runner-hides-unrun-files` memory: read the count).
2. `tsc --noEmit` and eslint clean.
3. Regenerate the recovery link through the admin API and assert
   `redirect_to` is the exact https reset URL, and that `roxy:///reset-password`
   is accepted rather than falling back.
4. Browser: load the deployed reset URL with a real recovery fragment, set a
   password, confirm sign-in.
5. Code review subagent on the diff before merge.
