# Email + Password Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace broken magic link auth with email+password signup/signin, keeping OAuth buttons, adding forgot password.

**Architecture:** Modify 3 files: `useAuth` hook (add signUp/signInWithPassword/resetPassword, remove OTP), `welcome.tsx` (email+password form with sign up/in toggle + forgot password), and existing tests (update to match new methods). No new screens, routes, or stores. Supabase `onAuthStateChange` handles session automatically.

**Tech Stack:** React Native (Expo 51), Supabase Auth, Zustand, Jest + React Native Testing Library

---

### Task 1: Update useAuth Hook — Tests

**Files:**
- Modify: `__tests__/hooks/useAuth.test.ts`

**Step 1: Update mocks and rewrite tests for new auth methods**

Replace the existing test file contents. The key changes: remove `mockSignInWithOtp`, add `mockSignUp`, `mockSignInWithPassword`, `mockResetPasswordForEmail`.

```typescript
jest.mock('react-native-url-polyfill/auto', () => {});
jest.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const mockUnsubscribe = jest.fn();
const mockGetSession = jest.fn().mockResolvedValue({ data: { session: null } });
const mockOnAuthStateChange = jest.fn().mockReturnValue({
  data: { subscription: { unsubscribe: mockUnsubscribe } },
});
const mockSignUp = jest.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockSignInWithPassword = jest.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockResetPasswordForEmail = jest.fn().mockResolvedValue({ error: null });
const mockSignOut = jest.fn().mockResolvedValue({ error: null });
const mockSignInWithOAuth = jest.fn().mockResolvedValue({ error: null });

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
      resetPasswordForEmail: mockResetPasswordForEmail,
      signOut: mockSignOut,
      signInWithOAuth: mockSignInWithOAuth,
    },
    functions: { invoke: jest.fn() },
  })),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

import { renderHook, act } from '@testing-library/react-native';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAuth } = require('../../hooks/useAuth') as typeof import('../../hooks/useAuth');

describe('useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    });
  });

  it('exposes signUp, signInWithPassword, resetPassword, signOut, OAuth methods', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.signUp).toBe('function');
    expect(typeof result.current.signInWithPassword).toBe('function');
    expect(typeof result.current.resetPassword).toBe('function');
    expect(typeof result.current.signOut).toBe('function');
    expect(typeof result.current.signInWithApple).toBe('function');
    expect(typeof result.current.signInWithGoogle).toBe('function');
  });

  it('calls getSession on mount', async () => {
    renderHook(() => useAuth());
    await act(async () => {});
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from auth changes on unmount', async () => {
    const { unmount } = renderHook(() => useAuth());
    await act(async () => {});
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('signUp calls supabase.auth.signUp with email and password', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signUp('test@example.com', 'password123');
    });
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    });
  });

  it('signInWithPassword calls supabase.auth.signInWithPassword', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signInWithPassword('test@example.com', 'password123');
    });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    });
  });

  it('resetPassword calls supabase.auth.resetPasswordForEmail', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.resetPassword('test@example.com');
    });
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('test@example.com');
  });

  it('signUp returns error on failure', async () => {
    const authError = { message: 'User already registered' };
    mockSignUp.mockResolvedValueOnce({ data: { session: null }, error: authError });
    const { result } = renderHook(() => useAuth());
    let response: { error: typeof authError | null };
    await act(async () => {
      response = await result.current.signUp('test@example.com', 'password123');
    });
    expect(response!.error).toEqual(authError);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/hooks/useAuth.test.ts --no-coverage`
Expected: FAIL — `result.current.signUp` is not a function (hook still has old methods)

**Step 3: Commit failing tests**

```bash
git add __tests__/hooks/useAuth.test.ts
git commit -m "test: update useAuth tests for email+password auth (red)"
```

---

### Task 2: Update useAuth Hook — Implementation

**Files:**
- Modify: `hooks/useAuth.ts`

**Step 1: Replace OTP signIn with signUp, signInWithPassword, resetPassword**

Replace the entire file:

```typescript
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const { user, session, loading, setSession, setLoading, signOut: storeSignOut } =
    useAuthStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  };

  const signInWithPassword = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error };
  };

  const signInWithApple = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: 'roxy://auth/callback' },
    });
    return { error };
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'roxy://auth/callback' },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    storeSignOut();
  };

  return {
    user,
    session,
    loading,
    signUp,
    signInWithPassword,
    resetPassword,
    signInWithApple,
    signInWithGoogle,
    signOut,
  };
}
```

**Step 2: Run tests to verify they pass**

Run: `npx jest __tests__/hooks/useAuth.test.ts --no-coverage`
Expected: PASS — all 7 tests green

**Step 3: Commit**

```bash
git add hooks/useAuth.ts
git commit -m "feat: replace OTP with email+password auth in useAuth hook"
```

---

### Task 3: Update Welcome Screen

**Files:**
- Modify: `app/(auth)/welcome.tsx`

**Step 1: Replace welcome.tsx with email+password form**

Replace the entire file:

```typescript
import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { COLORS } from '../../lib/constants';

export default function WelcomeScreen() {
  const [showEmail, setShowEmail] = useState(false);
  const [isSignIn, setIsSignIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const { signUp, signInWithPassword, resetPassword, signInWithApple, signInWithGoogle } = useAuth();

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) return;
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    const { error } = isSignIn
      ? await signInWithPassword(email.trim(), password)
      : await signUp(email.trim(), password);
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Enter your email', 'Please enter your email address first.');
      return;
    }
    setLoading(true);
    const { error } = await resetPassword(email.trim());
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setResetSent(true);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.logo}>Roxy</Text>
        <Text style={styles.tagline}>Your community. Your story.</Text>
      </View>

      <View style={styles.content}>
        {resetSent ? (
          <>
            <Text style={styles.sentTitle}>Check your email</Text>
            <Text style={styles.sentBody}>
              We sent a password reset link to {email}
            </Text>
            <TouchableOpacity onPress={() => setResetSent(false)}>
              <Text style={styles.emailLink}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.btn} onPress={signInWithApple}>
              <Text style={styles.btnText}> Continue with Apple</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={signInWithGoogle}
            >
              <Text style={styles.btnText}>Continue with Google</Text>
            </TouchableOpacity>

            {!showEmail ? (
              <TouchableOpacity onPress={() => setShowEmail(true)}>
                <Text style={styles.emailLink}>Use email instead</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="your@email.com"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  value={email}
                  onChangeText={setEmail}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={COLORS.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete={isSignIn ? 'password' : 'new-password'}
                  value={password}
                  onChangeText={setPassword}
                />
                {isSignIn && (
                  <TouchableOpacity onPress={handleForgotPassword}>
                    <Text style={styles.forgotLink}>Forgot password?</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.btn, loading && styles.btnDisabled]}
                  onPress={handleSubmit}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>
                    {loading ? 'Please wait...' : isSignIn ? 'Sign In' : 'Sign Up'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setIsSignIn(!isSignIn)}>
                  <Text style={styles.emailLink}>
                    {isSignIn ? 'New here? Sign Up' : 'Already have an account? Sign In'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.privacy}>
              We never share your data with third parties.
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { fontSize: 64, fontWeight: '800', color: COLORS.roxy },
  tagline: { fontSize: 18, color: COLORS.textSecondary, marginTop: 8 },
  content: { padding: 24, gap: 12 },
  btn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  btnSecondary: { backgroundColor: COLORS.surface },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 16 },
  emailLink: {
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    paddingVertical: 8,
  },
  forgotLink: {
    color: COLORS.accent,
    textAlign: 'right',
    fontSize: 14,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    color: COLORS.textPrimary,
    fontSize: 16,
  },
  sentTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  sentBody: {
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  privacy: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
```

**Step 2: Run all tests to verify nothing is broken**

Run: `npx jest --no-coverage`
Expected: All tests pass

**Step 3: Commit**

```bash
git add app/(auth)/welcome.tsx
git commit -m "feat: replace magic link with email+password form on welcome screen"
```

---

### Task 4: Supabase Dashboard Config

**This is a manual step — no code.**

**Step 1: Configure Supabase email auth**

1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/ptymtdlysqbpxzlgsshp
2. Navigate to **Authentication** > **Providers** > **Email**
3. Ensure:
   - "Enable Email Signup" is **ON**
   - "Confirm email" is **OFF**
   - "Secure email change" can stay on default
4. Save

**Step 2: Verify by testing sign up in the app**

Run: `npx expo start --web`
- Open in browser
- Click "Use email instead"
- Enter a test email and password (6+ chars)
- Click "Sign Up"
- Should create user and redirect to onboarding

**Step 3: Commit a note (optional)**

No code to commit for this step.

---

### Task 5: Manual Smoke Test

**Step 1: Test sign up flow**
- Start app: `npx expo start --web`
- Click "Use email instead"
- Enter new email + password (6+ chars)
- Click "Sign Up"
- Expected: Redirects to onboarding step 1

**Step 2: Test sign in flow**
- Sign out from the app
- On welcome screen, click "Use email instead"
- Toggle to "Sign In"
- Enter the email + password from step 1
- Click "Sign In"
- Expected: Redirects to main app (tabs)

**Step 3: Test forgot password**
- Toggle to "Sign In" mode
- Enter email
- Tap "Forgot password?"
- Expected: Shows "Check your email" message

**Step 4: Test error cases**
- Try signing in with wrong password -> should show error alert
- Try signing up with existing email -> should show error alert
- Try submitting with empty fields -> should do nothing
- Try password under 6 chars -> should show error alert
