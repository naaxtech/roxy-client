import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { isGhostSignupUser, sessionEmailMatches } from '../lib/signupSession';
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
    forgetLocalIdentity(true);
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
