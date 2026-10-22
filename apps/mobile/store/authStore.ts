import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { clearThreadCache } from '../components/chat/threadCache';
import { clearChannelCache } from '../components/channels/channelCache';
import { clearEventCache } from '../components/events/eventCache';

/**
 * The in-session memory behind F7's instant revisits (DMs, channels, events) is
 * hers alone and never outlives her session (decision P2): it is dropped the
 * moment no one is signed in, not only when the next member signs in.
 */
function forgetSessionMemory(): void {
  clearThreadCache();
  clearChannelCache();
  clearEventCache();
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  setSession: (session) => {
    if (!session?.user) forgetSessionMemory();
    set({ session, user: session?.user ?? null, loading: false });
  },
  setLoading: (loading) => set({ loading }),
  signOut: () => {
    forgetSessionMemory();
    set({ user: null, session: null, loading: false });
  },
}));
