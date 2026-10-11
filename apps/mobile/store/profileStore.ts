import { create } from 'zustand';
import { Profile } from '../types';
import { supabase } from '../lib/supabase';

interface ProfileState {
  profile: Profile | null;
  onboardingStep: number;
  setProfile: (profile: Profile | null) => void;
  setOnboardingStep: (step: number) => void;
  /**
   * Optimistic, serialized write. The change shows at once; writes run one at
   * a time in call order; a refused write puts the touched fields back to what
   * the server last confirmed, and rejects.
   */
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  /** Add or remove one pronoun, computed from the LATEST state (PRO-05). */
  togglePronoun: (pronoun: string) => Promise<void>;
  /** Identity is single-choice: picking one replaces the previous; the same one clears it. */
  toggleIdentity: (label: string) => Promise<void>;
}

/**
 * Pronoun chips used to build the new array from the render's `profile` and
 * then await, so two quick taps both started from the old array and the
 * second overwrote the first; nothing changed on screen until the server
 * answered (PRO-05). Every change is now computed from the current state at
 * tap time, applied at once, and written through one queue so the database
 * sees the taps in order.
 */
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
/** What the server has accepted, for rolling a refused write back. */
let confirmed: Partial<Profile> = {};

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  onboardingStep: 1,
  setProfile: (profile) => set({ profile }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),

  updateProfile: (patch: Partial<Profile>) => {
    const start = get().profile;
    if (!start) return Promise.reject(new Error('No profile loaded'));
    // With nothing in flight, what is on screen is what the server has.
    if (pending === 0) confirmed = { ...start };
    pending += 1;
    set({ profile: { ...start, ...patch } });

    const run = async () => {
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', start.id);
        if (error) {
          const current = get().profile;
          if (current && current.id === start.id) {
            const rollback: Record<string, unknown> = {};
            for (const key of Object.keys(patch)) {
              rollback[key] = (confirmed as Record<string, unknown>)[key];
            }
            set({ profile: { ...current, ...(rollback as Partial<Profile>) } });
          }
          throw new Error(error.message);
        }
        Object.assign(confirmed, patch);
      } finally {
        pending -= 1;
      }
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  },

  togglePronoun: (pronoun) => {
    const current = get().profile?.pronouns ?? [];
    const pronouns = current.includes(pronoun)
      ? current.filter((p) => p !== pronoun)
      : [...current, pronoun];
    return get().updateProfile({ pronouns });
  },

  toggleIdentity: (label) => {
    const current = get().profile?.identity_labels ?? [];
    return get().updateProfile({ identity_labels: current.includes(label) ? [] : [label] });
  },
}));
