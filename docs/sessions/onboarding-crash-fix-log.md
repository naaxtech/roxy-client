# Onboarding Crash Fix — Session Log

## User Requirements

> "I discovered several bugs, a critical bug that needs fixing: when users sign up, the onboarding views automatically goes to the next one and flickers, also users are not able to proceed. Also, users should not be able to click on next at all, or enter the application dashboard. Focus on fixing this critical bug. I need a verbose error and stacktrace tracking for my app."

---

## Root Cause Analysis

### Bug 1 — Auto-advance / redirect loop (CRITICAL)

**File:** `apps/mobile/app/_layout.tsx`

`useSegments()` returns `[]` on the very first render before Expo Router's navigation stack has initialised. The layout effect fires with `segments.length === 0`, which means:
- `inAuth = segments[0] === '(auth)'` → **false** (undefined)
- `inOnboarding = segments[1] === 'onboarding'` → **false** (undefined)

This causes the third block (`user && !inAuth && !profile`) to fire immediately, fetch the user's profile, find `onboarding_completed: false`, and call `router.replace('/(auth)/onboarding/step1-identity')`.

This redirect fires:
- On every cold start for a logged-in user mid-onboarding
- On every navigation inside onboarding (segments change → effect re-fires → segments empty briefly → redirect kicks to step1)

**Consequence:** User taps Next → step2 loads → layout immediately redirects back to step1. Looks like "auto-advance / flicker" and makes onboarding impossible to complete.

### Bug 2 — Dashboard access without completing onboarding

**File:** `apps/mobile/app/_layout.tsx`

The third block only triggers when `!profile` (no profile in the Zustand store). If a profile IS loaded into the store but `onboarding_completed = false`, no guard prevents the user from accessing `/(tabs)`.

### Bug 3 — "Cannot proceed" (downstream of Bug 1)

The inability to proceed is a symptom of Bug 1 — every advance gets undone by the redirect loop.

---

## Implementation Plan

### 1. `apps/mobile/app/_layout.tsx` — 4 targeted changes

| # | Change | Reason |
|---|--------|--------|
| a | Add `if (!segments.length) return;` after `if (loading) return;` | Wait for navigation to initialise before making routing decisions |
| b | `inOnboarding = segments.some(s => s === 'onboarding')` | More robust — not brittle to the exact array index |
| c | Third block: protect `profile.onboarding_completed === false` as redirect | Prevents bypassing dashboard |
| d | Add `logBreadcrumb` on every routing decision | Verbose breadcrumb trail for crash reports |

### 2. Onboarding steps — verbose error tracking

Each step already calls `logError` in catch blocks. Add:
- `logBreadcrumb` at start of each `handleNext` with step name and key state
- Ensure all `.catch()` paths log full error objects (not just strings)

### 3. Button disabled states

Existing disabled logic is correct. No changes needed.

---

## Files Changed

- `apps/mobile/app/_layout.tsx` — routing guards
- `apps/mobile/__tests__/components/ProfileCard.test.tsx` — TypeScript fixture fix (`onboarding_completed: true`)
