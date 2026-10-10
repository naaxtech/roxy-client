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
      // Her own row, every column. profiles.* is no longer readable (130 /
      // PRO-01): other members' private columns are column-revoked, and that
      // grant cannot tell her row from theirs.
      .from('my_profile')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data }) => { if (data) setProfile(data); });
  }, [user, profile, setProfile]);

  return { profile };
}
