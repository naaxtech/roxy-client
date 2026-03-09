import { create } from 'zustand';
import { Profile } from '../types';
import { supabase } from '../lib/supabase';

interface ProfileState {
  profile: Profile | null;
  onboardingStep: number;
  setProfile: (profile: Profile | null) => void;
  setOnboardingStep: (step: number) => void;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  onboardingStep: 1,
  setProfile: (profile) => set({ profile }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),
  updateProfile: async (patch: Partial<Profile>) => {
    const { profile } = get();
    if (!profile) throw new Error('No profile loaded');
    const { error } = await supabase
      .from('profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', profile.id);
    if (error) throw new Error(error.message);
    set({ profile: { ...profile, ...patch } });
  },
}));
