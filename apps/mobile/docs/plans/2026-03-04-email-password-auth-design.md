# Email + Password Auth Design

## Problem

The current auth uses magic links (OTP) that don't work because:
- Deep link handler (`roxy://auth/callback`) is not wired up in the app
- Supabase client has `detectSessionInUrl: false`
- Deep links don't work on web at all

## Decision

Replace magic link with email + password authentication. Keep Apple/Google OAuth as secondary options.

## Approach: Minimal Replace (Approach A)

Modify 3 existing files. No new screens or routes.

## Files Changed

| File | Change |
|------|--------|
| `hooks/useAuth.ts` | Add `signUp`, `signInWithPassword`, `resetPassword` methods |
| `app/(auth)/welcome.tsx` | Replace magic link UI with email+password + toggle + forgot password |
| `lib/supabase.ts` | No changes needed |
| `store/authStore.ts` | No changes needed |

## Data Flow

```
User enters email + password
        |
Toggle = "Sign Up" -> supabase.auth.signUp({ email, password })
Toggle = "Sign In" -> supabase.auth.signInWithPassword({ email, password })
        |
Supabase returns session (no email verification)
        |
onAuthStateChange fires -> setSession(session) -> Zustand updates
        |
_layout.tsx detects user -> checks for profile -> routes accordingly
```

Everything downstream (onboarding, profile check, tab routing) is unchanged.

## UI: welcome.tsx

### States
1. **Default:** OAuth buttons + "Use email instead" link
2. **Email expanded:** Email field, password field, submit button, Sign Up/Sign In toggle
3. **Forgot password sent:** "Check your email for a reset link" message

### Sign Up / Sign In Toggle
- Default mode: Sign Up (new users)
- Toggle text: "Already have an account? Sign In" / "New here? Sign Up"
- Submit button label changes with mode

### Password Field
- `secureTextEntry` enabled
- Minimum 6 characters (Supabase default)

### Forgot Password
- "Forgot password?" link below password field, only in Sign In mode
- Calls `supabase.auth.resetPasswordForEmail(email)`
- If email empty, prompt user to enter it first
- On success: show confirmation message
- On error: Alert with error
- Reset happens on Supabase's hosted page (no custom screen needed)

### Error Handling
- Alert.alert on auth failures (same pattern as current code)

## useAuth Hook Changes

New methods:
- `signUp(email, password)` -> `supabase.auth.signUp({ email, password })`
- `signInWithPassword(email, password)` -> `supabase.auth.signInWithPassword({ email, password })`
- `resetPassword(email)` -> `supabase.auth.resetPasswordForEmail(email)`

Existing `signIn` (OTP) method removed.

## Supabase Dashboard Config

Required settings under Authentication > Email:
- "Enable Email Signup": ON
- "Confirm email": OFF (immediate access, no verification)

## What Stays the Same

- OAuth buttons (Apple, Google)
- Auth store (Zustand)
- Session persistence (AsyncStorage)
- Root layout auth routing logic
- Onboarding flow
- All downstream screens
