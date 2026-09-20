import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { isGhostSignupUser, sessionEmailMatches } from '../lib/signupSession';
import { resetRedirectUrl } from '../lib/passwordReset';
import { useAuthStore } from '../store/authStore';
import { useGateStore } from '../store/gateStore';
import { useProfileStore } from '../store/profileStore';
import { useViewAsStore } from '../store/viewAsStore';

const EXISTING_EMAIL = 'That email already has an account. Sign in instead.';
const WRONG_SESSION = 'Sign-up did not open the new account. Sign out and try again.';
const CONFIRM_EMAIL = 'Check your email to confirm this account, then sign in.';
const WRONG_SIGNIN = 'Sign-in opened a different account. Try again.';

function forgetLocalIdentity(resetGate: boolean) {
  useAuthStore.getState().signOut();
  useProfileStore.getState().setProfile(null);
  useViewAsStore.getState().setPreview(null);
  if (resetGate) useGateStore.getState().reset();
}

export function useAuth() {
  const { user, session, loading, setSession, setLoading, signOut: storeSignOut } =
    useAuthStore();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
      })
      .catch(() => {
        setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => data?.subscription?.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    // A leftover session on this device is how a new signup can attach to
    // (or then render as) whoever was here last — see signupSession.ts.
    await supabase.auth.signOut({ scope: 'local' });
    forgetLocalIdentity(false);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };
    if (isGhostSignupUser(data.user)) {
      await supabase.auth.signOut({ scope: 'local' });
      forgetLocalIdentity(false);
      return { error: { message: EXISTING_EMAIL } };
    }
    if (!data.session) {
      await supabase.auth.signOut({ scope: 'local' });
      forgetLocalIdentity(false);
      return { error: { message: CONFIRM_EMAIL } };
    }
    if (!sessionEmailMatches(data.session, email)) {
      await supabase.auth.signOut({ scope: 'local' });
      forgetLocalIdentity(false);
      return { error: { message: WRONG_SESSION } };
    }
    return { error: null };
  };

  const signInWithPassword = async (email: string, password: string) => {
    await supabase.auth.signOut({ scope: 'local' });
    forgetLocalIdentity(false);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error };
    if (!sessionEmailMatches(data.session, email)) {
      await supabase.auth.signOut({ scope: 'local' });
      forgetLocalIdentity(true);
      return { error: { message: WRONG_SIGNIN } };
    }
    return { error: null };
  };

  /**
   * Send the recovery email.
   *
   * `redirectTo` is not optional in practice. Without it GoTrue falls back to
   * the project's Site URL, and a Supabase project ships with that set to
   * `http://localhost:3000` — so every reset email Roxy sent pointed at the
   * recipient's own machine. See lib/passwordReset.ts.
   * src: https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail · supabase-js 2.105.4 · 2026-09-20
   */
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirectUrl(),
    });
    return { error };
  };

  /**
   * Open the session a recovery link carries.
   *
   * The local sign-out first is not ceremony — it is the same opening move as
   * `signUp` and `signInWithPassword`, for the same reason: a leftover session
   * is how this device ends up rendering one woman's state under another
   * woman's login. A recovery link is the one auth entry point most likely to
   * be opened on a device already signed in as somebody else (a shared laptop,
   * a partner's phone), and `setSession` on its own swaps the credential while
   * leaving gateStore, viewAsStore and the rest holding the previous identity.
   */
  const beginRecoverySession = async (accessToken: string, refreshToken: string) => {
    // Deliberately NOT the `signOut({ scope: 'local' })` that signUp and
    // signInWithPassword open with. That call still goes to the network, and on
    // a device with no session it answers 403 while holding supabase-js's auth
    // lock — which deadlocks the setSession below and leaves the screen on its
    // spinner forever (seen in a browser, 2026-09-20). It is also redundant
    // here: setSession replaces the stored credential by itself. What actually
    // needed clearing was never the session, it was the in-memory identity.
    forgetLocalIdentity(false);
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return { error };
  };

  /**
   * Set a new password on the session the recovery link opened.
   *
   * The caller must surface `error` rather than assume success: supabase-js
   * resolves rather than throws, and GoTrue rejects a password identical to the
   * old one. A screen that celebrates over this without checking is the
   * `safetyStore.submitReport` defect again — a confirmation over a write that
   * never happened.
   */
  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
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
    forgetLocalIdentity(true);
  };

  return {
    user,
    session,
    loading,
    signUp,
    signInWithPassword,
    resetPassword,
    beginRecoverySession,
    updatePassword,
    signInWithApple,
    signInWithGoogle,
    signOut,
  };
}
