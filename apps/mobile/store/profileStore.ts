import { create } from 'zustand';
import { Profile } from '../types';

interface ProfileState {
  profile: Profile | null;
  onboardingStep: number;
  setProfile: (profile: Profile | null) => void;
  setOnboardingStep: (step: number) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  onboardingStep: 1,
  setProfile: (profile) => set({ profile }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),
}));
