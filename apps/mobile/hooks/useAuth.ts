import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

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
