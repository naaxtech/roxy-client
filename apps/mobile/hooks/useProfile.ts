import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';

export function useProfile() {
  const { user } = useAuthStore();
  const { profile, setProfile } = useProfileStore();

  useEffect(() => {
    if (!user || profile) return;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data }) => { if (data) setProfile(data); });
  }, [user, profile, setProfile]);

  return { profile };
}
