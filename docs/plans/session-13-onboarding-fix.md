# Session 13 — Onboarding Bug Fix + Verbose Error Tracking

**Date:** 2026-04-09
**Branch:** session-13-onboarding-fix
**Status:** In Progress

---

## User Instructions

> "I discovered several bugs, a critical bug that needs fixing: when users sign up, the onboarding views automatically goes to the next one and flickers, also users are not able to proceed. Also, users should not be able to click on next at all, or enter the application dashboard. Focus on fixing this critical bug. I need a verbose error and stacktrace tracking for my app."

> "Also make sure you have all MCPs, skills loaded, and that you know all the MDs in this folder"

---

## Root Cause Analysis

### Bug 1 — Can't Proceed / Step 4 Fails (CRITICAL)
**Root cause:** `supabase/migrations/023_onboarding_completed.sql` is untracked (`??` in git) and has NOT been pushed to the remote database.

- The `onboarding_completed` column does not exist in the `profiles` table.
- Step 4's `update({ onboarding_completed: true })` fails with a Postgres 400 error (column does not exist).
- The root layout's check `!data.onboarding_completed` is always `undefined` → always falsy → always redirects back to step1.
- Users literally cannot complete onboarding.

### Bug 2 — Auto-advance / Flickering
**Root cause:** `_layout.tsx` navigation guard `useEffect` depends on the full `user` object (reference equality) instead of `user?.id`.

- `onAuthStateChange` fires on `TOKEN_REFRESHED` events, creating a new `user` object reference even when the user ID hasn't changed.
- Every token refresh re-triggers the layout effect.
- During step transitions or initial mount, segments may briefly be in an intermediate state, causing the `inOnboarding` check to fail for one render cycle.
- Concurrent profile fetches can issue conflicting `router.replace()` calls, causing the flicker.

### Bug 3 — No Guard Against Direct Navigation to Dashboard
**Root cause:** `apps/mobile/app/(tabs)/_layout.tsx` has no check for `onboarding_completed`.

- A user with a partial profile can navigate directly to `/(tabs)/grow` if they know the URL.
- No secondary protection layer exists below the root layout.

### Bug 4 — Missing Verbose Error + Breadcrumb Logging in Onboarding Steps
**Root cause:** `logError` and `logBreadcrumb` are not called in any of the 4 onboarding steps.

- Errors are shown via `Alert.alert` but not sent to Crashlytics/PostHog.
- No breadcrumb trail exists in crash reports for onboarding failures.

---

## Implementation Plan

### Step 1 — Push Migration 023
```bash
npx supabase db push
```
Adds `onboarding_completed boolean NOT NULL DEFAULT false` to `profiles`.
Marks existing complete profiles as `onboarding_completed = true`.

### Step 2 — Fix `apps/mobile/app/_layout.tsx`
- Change `useEffect` dep array from `[user, loading, segments]` → `[user?.id, loading, segments]`
- Add `fetchingForUserRef` (`useRef<string | null>(null)`) to prevent concurrent profile fetches
- Reset the ref in `.catch()` handlers as well

### Step 3 — Add Onboarding Guard to `apps/mobile/app/(tabs)/_layout.tsx`
- Import `useProfileStore` and `useRouter`
- Add `useEffect` that redirects to step1 if `profile !== null && !profile.onboarding_completed`

### Step 4 — Add `logBreadcrumb` + `logError` to All 4 Onboarding Steps
- `step1-identity.tsx`: breadcrumb on submit, logError on DB error
- `step2-interests.tsx`: breadcrumb on submit, logError on DB error
- `step3-photo.tsx`: breadcrumb on submit, logError on upload/DB error
- `step4-status.tsx`: breadcrumb on finish, logError on both DB + edge function errors

---

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/023_onboarding_completed.sql` | Pushed to DB (already exists locally) |
| `apps/mobile/app/_layout.tsx` | Fix dep array, add `fetchingForUserRef` |
| `apps/mobile/app/(tabs)/_layout.tsx` | Add `onboarding_completed` guard |
| `apps/mobile/app/(auth)/onboarding/step1-identity.tsx` | Add `logBreadcrumb` + `logError` |
| `apps/mobile/app/(auth)/onboarding/step2-interests.tsx` | Add `logBreadcrumb` + `logError` |
| `apps/mobile/app/(auth)/onboarding/step3-photo.tsx` | Add `logBreadcrumb` + `logError` |
| `apps/mobile/app/(auth)/onboarding/step4-status.tsx` | Add `logBreadcrumb` + `logError` |

---

## Acceptance Criteria

- [ ] `onboarding_completed` column exists in `profiles` table
- [ ] Users can complete all 4 onboarding steps without being kicked back to step 1
- [ ] No flickering or auto-advance during onboarding transitions
- [ ] Navigating directly to `/(tabs)/grow` without completing onboarding redirects to step 1
- [ ] Next buttons remain disabled until required fields are filled (already implemented)
- [ ] All onboarding errors appear in Crashlytics + PostHog with full stacktrace and breadcrumbs
